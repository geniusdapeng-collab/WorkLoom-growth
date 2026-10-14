/**
 * Codex produces images outside the service; the existing import transports their bytes.
 * Hashes bind the requested film, scene, prompt and master references, not model identity.
 * Visual review is explicitly caller-declared; it is not a cryptographic provider receipt.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { buildLineartPrompt, LINEART_STYLE_PROMPT } from "./lineart-prompts.js";

export const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
const RefId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const ContinuitySchema = z.object({
  references: z.array(z.object({
    id: RefId,
    role: z.enum(["style", "core"]),
    description: z.string().min(1).max(400),
    sha256: SHA256,
  }).strict()).max(5).default([]),
  lockedElements: z.array(z.object({
    id: RefId,
    description: z.string().min(1).max(600),
    referenceId: RefId,
  }).strict()).max(12).default([]),
}).strict().superRefine((value, ctx) => {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 4000) {
    ctx.addIssue({ code: "custom", message: "一致性合同超过 4000 字节；用简明元素描述和参考图，不截断合同" });
  }
  const ids = new Set<string>();
  for (const [i, ref] of value.references.entries()) {
    if (ids.has(ref.id)) ctx.addIssue({ code: "custom", path: ["references", i, "id"], message: "参考资产 ID 重复" });
    ids.add(ref.id);
  }
  const elements = new Set<string>();
  for (const [i, el] of value.lockedElements.entries()) {
    if (elements.has(el.id)) ctx.addIssue({ code: "custom", path: ["lockedElements", i, "id"], message: "核心元素 ID 重复" });
    elements.add(el.id);
    if (!ids.has(el.referenceId)) ctx.addIssue({ code: "custom", path: ["lockedElements", i, "referenceId"], message: "核心元素缺少对应主参考资产" });
  }
});
export type Continuity = z.infer<typeof ContinuitySchema>;

export const ImagegenReceiptSchema = z.object({
  schemaVersion: z.literal("workloom.whiteboard-imagegen-receipt/v1"),
  planHash: SHA256,
  sceneHash: SHA256,
  imageSha256: SHA256,
  referencedHashes: z.array(SHA256).min(1).max(5),
  visualReview: z.object({
    status: z.literal("passed"),
    reviewer: z.string().min(1).max(120),
    note: z.string().min(2).max(1000),
  }).strict(),
}).strict();
export type ImagegenReceipt = z.infer<typeof ImagegenReceiptSchema>;

/** File contracts are shared with the CLI, which has no separate zod dependency. */
export const ContinuityFileSchema = z.object({
  schemaVersion: z.literal("workloom.whiteboard-continuity/v1"),
  references: z.array(z.object({
    id: z.string(), role: z.enum(["style", "core"]), description: z.string(),
    path: z.string().min(1).max(1200), sha256: SHA256.optional(),
  }).strict()).max(5),
  lockedElements: z.array(z.object({ id: z.string(), description: z.string(), referenceId: z.string() }).strict()).max(12),
}).strict();

export const ImagegenResultsSchema = z.object({
  schemaVersion: z.literal("workloom.whiteboard-imagegen-results/v1"),
  planHash: SHA256,
  scenes: z.array(z.object({
    sceneNo: z.number().int().min(1), sceneHash: SHA256,
    path: z.string().min(1).max(1200), imageSha256: SHA256,
    referencedHashes: z.array(SHA256).min(1).max(5),
    visualReview: ImagegenReceiptSchema.shape.visualReview,
  }).strict()).min(1).max(200),
}).strict();

export const ImagegenUnavailableSchema = z.object({
  reason: z.enum(["tool-unavailable", "unsupported-client"]),
  detail: z.string().min(2).max(400),
}).strict();
export type ImagegenUnavailable = z.infer<typeof ImagegenUnavailableSchema>;

export interface ImagegenScene {
  id: string;
  scene_no: number;
  core_idea: string;
  subtitle_srt: string;
  cue_start_ms: number;
  cue_end_ms: number;
  duration_ms: number | null;
  lineart_path?: string | null;
}

export function lineartSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sceneElements(srt: string): string[] {
  return srt.split(/\r?\n/).map(line => line.trim())
    .filter(line => line.length > 0 && !/^\d+$/.test(line) && !line.includes("-->"));
}

export function continuityPrompt(continuity: Continuity): string {
  return [
    "【全片一致性】每一幕均使用同一份主参考资产，不把上一幕的重新生成图替换为新的主参考。",
    ...continuity.references.map((ref, i) => `参考图 ${i + 1}（${ref.id}，${ref.role}）：${ref.description}。`),
    ...continuity.lockedElements.map(el => `保持核心元素 ${el.id}（参考 ${el.referenceId}）：${el.description}；只改变本幕明确要求的动作或关系，不重新设计。`),
    "保持纸底、线条颜色与粗细、主体比例及点缀色一致。需要像素级不变的元素应复用原素材；参考生成不能保证像素完全一致。",
  ].join("\n");
}

export function buildImagegenPlan(input: {
  workspaceId: string; filmId: string; projectId: string;
  scenes: ImagegenScene[]; continuity?: Continuity;
}) {
  const continuity = ContinuitySchema.parse(input.continuity ?? {});
  const ids = new Set<number>();
  if (input.scenes.length === 0) throw new Error("白板片还未分幕：先执行 whiteboard.plan");
  const scenes = input.scenes.map(scene => {
    if (!Number.isInteger(scene.scene_no) || scene.scene_no < 1 || ids.has(scene.scene_no)) throw new Error("幕号非法或重复");
    ids.add(scene.scene_no);
    const prompt = `${buildLineartPrompt(scene.core_idea, sceneElements(scene.subtitle_srt))}\n${continuityPrompt(continuity)}`;
    const sceneHash = lineartSha256(JSON.stringify({
      workspaceId: input.workspaceId, filmId: input.filmId, projectId: input.projectId,
      sceneId: scene.id, sceneNo: scene.scene_no, prompt, continuity,
      cueStartMs: scene.cue_start_ms, cueEndMs: scene.cue_end_ms, durationMs: scene.duration_ms,
    }));
    return { sceneNo: scene.scene_no, sceneHash, prompt, promptHash: lineartSha256(prompt),
      existingPath: scene.lineart_path ?? null };
  });
  const planHash = lineartSha256(JSON.stringify({
    workspaceId: input.workspaceId, filmId: input.filmId, projectId: input.projectId,
    styleHash: lineartSha256(LINEART_STYLE_PROMPT), continuity,
    scenes: scenes.map(scene => ({ sceneNo: scene.sceneNo, sceneHash: scene.sceneHash })),
  }));
  return {
    schemaVersion: "workloom.whiteboard-imagegen-plan/v1" as const,
    workspaceId: input.workspaceId, filmId: input.filmId, projectId: input.projectId, planHash, continuity, scenes,
    needsStyleReference: !continuity.references.some(ref => ref.role === "style"),
    preferred: "codex-imagegen" as const, fallback: "seedream" as const,
    instructions: [
      "先生成或选定全片风格/核心元素主参考图，再重新读取带主参考摘要的计划。",
      "使用当前 Codex 会话的内置 image_gen；逐幕传入同一组参考图，不调用 OpenAI API/CLI 替代内置工具。",
      "逐幕检查画风和核心元素，保存图片路径、SHA-256、planHash、sceneHash 与实际引用的参考摘要。",
      "只在明确 tool-unavailable 或 unsupported-client 时选 Seedream；缺图、画错、超时或状态不明都不是备选依据。",
    ],
  };
}
export type ImagegenPlan = ReturnType<typeof buildImagegenPlan>;

export function validateImagegenReceipt(plan: ImagegenPlan, sceneNo: number, value: ImagegenReceipt): void {
  const receipt = ImagegenReceiptSchema.parse(value);
  const scene = plan.scenes.find(item => item.sceneNo === sceneNo);
  if (!scene || receipt.planHash !== plan.planHash || receipt.sceneHash !== scene.sceneHash) {
    throw new Error("imagegen 图片与当前项目/幕/提示词或参考资产不匹配：重新读取计划，禁止盲重出");
  }
  if (plan.needsStyleReference) throw new Error("imagegen 全片缺少固定风格主参考图");
  const hashes = plan.continuity.references.map(ref => ref.sha256);
  if (JSON.stringify(hashes) !== JSON.stringify(receipt.referencedHashes)) {
    throw new Error("imagegen 图片没有声明使用当前完整主参考资产");
  }
}
