import { describe, expect, it } from "vitest";
import { buildImagegenPlan, ContinuitySchema, ImagegenReceiptSchema, ImagegenUnavailableSchema,
  lineartSha256, validateImagegenReceipt, type ImagegenScene } from "./imagegen-contract.js";
import { whiteboardTimelineMs, tileScenes } from "./srt.js";

const continuity = ContinuitySchema.parse({
  references: [{ id: "master", role: "style", description: "固定纸底与项目图标", sha256: "a".repeat(64) }],
  lockedElements: [{ id: "project", referenceId: "master", description: "保持图标外形、比例及橙色点缀" }],
});
const scenes: ImagegenScene[] = [1, 2, 3].map(n => ({ id: `scene-${n}`, scene_no: n,
  core_idea: `第${n}幕：比较不同方案`, subtitle_srt: `${n}\n00:00:00,000 --> 00:00:05,000\n保留有效改进。\n`,
  cue_start_ms: (n - 1) * 10_000, cue_end_ms: n * 10_000, duration_ms: 10_000 }));
const input = { workspaceId: "ws-one", filmId: "WF-ONE", projectId: "VP-ONE", scenes, continuity };
const receipt = (plan = buildImagegenPlan(input), index = 0) => ImagegenReceiptSchema.parse({
  schemaVersion: "workloom.whiteboard-imagegen-receipt/v1", planHash: plan.planHash,
  sceneHash: plan.scenes[index]!.sceneHash, imageSha256: lineartSha256("actual-test-bytes"),
  referencedHashes: plan.continuity.references.map(ref => ref.sha256),
  visualReview: { status: "passed", reviewer: "fixture", note: "单测声明，不是生产模型或视觉验收" },
});

describe("imagegen 跨幕内容合同", () => {
  it("同一输入摘要稳定，每幕携带同一主参考和不变核心描述", () => {
    const plan = buildImagegenPlan(input);
    expect(plan).toEqual(buildImagegenPlan(structuredClone(input)));
    expect(plan.needsStyleReference).toBe(false);
    expect(new Set(plan.scenes.map(scene => scene.sceneHash)).size).toBe(3);
    for (const scene of plan.scenes) {
      expect(scene.prompt).toContain("参考图 1（master，style）");
      expect(scene.prompt).toContain("保持图标外形、比例及橙色点缀");
      expect(scene.prompt).toContain("像素级不变的元素应复用原素材");
      expect(scene.promptHash).toBe(lineartSha256(scene.prompt));
    }
    expect(() => validateImagegenReceipt(plan, 1, receipt(plan))).not.toThrow();
  });
  it.each(["workspaceId", "filmId", "projectId"] as const)("不同 %s 的图片不能导入当前片", key => {
    const plan = buildImagegenPlan(input);
    const changed = buildImagegenPlan({ ...input, [key]: "OTHER" });
    expect(changed.planHash).not.toBe(plan.planHash);
    expect(() => validateImagegenReceipt(changed, 1, receipt(plan))).toThrow("不匹配");
  });
  it.each(["id", "core_idea", "subtitle_srt", "duration_ms", "cue_start_ms"] as const)("%s 变化使旧来源记录失效", key => {
    const next = structuredClone(input);
    Object.assign(next.scenes[0]!, { [key]: typeof next.scenes[0]![key] === "number" ? 12345 : "变化后的内容" });
    const original = buildImagegenPlan(input);
    expect(() => validateImagegenReceipt(buildImagegenPlan(next), 1, receipt(original))).toThrow("不匹配");
  });
  it("主参考字节、文字说明及核心锁变化同样使旧图失效", () => {
    const original = buildImagegenPlan(input);
    for (const change of [
      (c: typeof continuity) => { c.references[0]!.sha256 = "b".repeat(64); },
      (c: typeof continuity) => { c.references[0]!.description = "不同画风"; },
      (c: typeof continuity) => { c.lockedElements[0]!.description = "换一个主体"; },
    ]) {
      const next = structuredClone(continuity); change(next);
      expect(() => validateImagegenReceipt(buildImagegenPlan({ ...input, continuity: next }), 1, receipt(original))).toThrow("不匹配");
    }
  });
  it("已有路径与完成状态不改变计划，续跑不会无故让旧图失效", () => {
    const plan = buildImagegenPlan(input);
    const resumed = buildImagegenPlan({ ...input, scenes: scenes.map(scene => ({ ...scene, lineart_path: "video/ws-one/cached.png" })) });
    expect(resumed.planHash).toBe(plan.planHash);
    expect(resumed.scenes[0]!.existingPath).toContain("cached");
  });
  it("可以先规划但不能导入没有固定风格主参考的图片", () => {
    const plan = buildImagegenPlan({ ...input, continuity: undefined });
    expect(plan.needsStyleReference).toBe(true);
    expect(() => validateImagegenReceipt(plan, 1, { ...receipt(), planHash: plan.planHash, sceneHash: plan.scenes[0]!.sceneHash })).toThrow("缺少固定");
  });
  it("声明实际使用的完整参考顺序必须匹配", () => {
    const plan = buildImagegenPlan(input);
    expect(() => validateImagegenReceipt(plan, 1, { ...receipt(plan), referencedHashes: ["b".repeat(64)] })).toThrow("完整主参考");
    expect(() => validateImagegenReceipt(plan, 2, receipt(plan))).toThrow("不匹配");
  });
  it("缺幕、重复幕、重复资产/元素和错误引用均拒绝", () => {
    expect(() => buildImagegenPlan({ ...input, scenes: [] })).toThrow("未分幕");
    expect(() => buildImagegenPlan({ ...input, scenes: [scenes[0]!, scenes[0]!] })).toThrow("重复");
    expect(() => ContinuitySchema.parse({ ...continuity, references: [...continuity.references, continuity.references[0]] })).toThrow();
    expect(() => ContinuitySchema.parse({ ...continuity, lockedElements: [...continuity.lockedElements, continuity.lockedElements[0]] })).toThrow();
    expect(() => ContinuitySchema.parse({ ...continuity, lockedElements: [{ ...continuity.lockedElements[0], referenceId: "missing" }] })).toThrow();
  });
  it("参考上限、合同字节上限、非法摘要与未完成视觉检查均拒绝", () => {
    expect(() => ContinuitySchema.parse({ references: Array.from({ length: 6 }, (_, i) => ({ ...continuity.references[0], id: `r${i}` })) })).toThrow();
    expect(() => ContinuitySchema.parse({ references: Array.from({ length: 5 }, (_, i) => ({ ...continuity.references[0], id: `r${i}`, description: "字".repeat(400) })) })).toThrow("4000");
    expect(() => ImagegenReceiptSchema.parse({ ...receipt(), imageSha256: "not-a-hash" })).toThrow();
    expect(() => ImagegenReceiptSchema.parse({ ...receipt(), visualReview: { status: "unverified", reviewer: "fixture", note: "未看图" } })).toThrow();
  });
  it("特殊字符和换行完整进入提示词，不截断用户内容", () => {
    const plan = buildImagegenPlan({ ...input, scenes: [{ ...scenes[0]!, core_idea: 'AB 与 A/B；中文 "引号"、<箭头>\n保持关系' }] });
    expect(plan.scenes[0]!.prompt).toContain('中文 "引号"、<箭头>\n保持关系');
  });
  it.each(["timeout", "moderation-blocked", "quality-failed", "quota-exhausted", "unknown", "missing-image"])("%s 不是工具不支持的备选依据", reason => {
    expect(() => ImagegenUnavailableSchema.parse({ reason, detail: "实际失败" })).toThrow();
  });
  it.each(["tool-unavailable", "unsupported-client"])("%s 的明确原因可以作为备选声明", reason => {
    expect(ImagegenUnavailableSchema.parse({ reason, detail: "当前会话工具列表无内置生图" }).reason).toBe(reason);
  });
});

describe("白板请求总时长", () => {
  it("不指定时仍以真实配音为准，指定30秒只补末幕停留", () => {
    expect(whiteboardTimelineMs(27500)).toBe(27500);
    const target = whiteboardTimelineMs(27500, 30);
    const tiled = tileScenes([{ sceneIndex: 1, startMs: 0, endMs: 10000, sceneDurationMs: 10000, cueRange: [1, 1], text: "第一幕" },
      { sceneIndex: 2, startMs: 10000, endMs: 27500, sceneDurationMs: 17500, cueRange: [2, 3], text: "第二幕" }], target);
    expect(tiled.reduce((sum, scene) => sum + scene.sceneDurationMs, 0)).toBe(30000);
    expect(tiled[0]!.sceneDurationMs).toBe(10000);
    expect(whiteboardTimelineMs(30000, 30)).toBe(30000);
  });
  it.each([NaN, Infinity, 0, -1, 601])("非法目标 %s 拒绝", sec => {
    expect(() => whiteboardTimelineMs(1000, sec)).toThrow();
  });
  it("超目标配音拒绝，不截断、不加速", () => {
    expect(() => whiteboardTimelineMs(30001, 30)).toThrow("不截断或加速");
    expect(() => whiteboardTimelineMs(0, 30)).toThrow("非法");
  });
});
