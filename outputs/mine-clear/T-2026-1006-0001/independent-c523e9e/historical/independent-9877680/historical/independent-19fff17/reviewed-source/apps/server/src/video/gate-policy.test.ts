import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { readPortraitArtifact, reviewStage, type NativeRequirementArchives } from "@hyperreality/video-studio";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AUTO_GATES, GATE_PRODUCER_STAGE, gateDeterministicChecks, portraitGateEvidence, portraitReviewManifest,
  renderSubmitAutoAllowed,
  prdArchiveGateEvidence, prdArchiveReviewMatches,
} from "./gate-policy.js";
let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "portrait-proof-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function fixture() {
  const root = path.join(dir, "characters", "P1"); mkdirSync(root, { recursive: true });
  const files: Record<string, string> = {};
  for (const angle of ["front", "threeQuarter", "closeup", "side"]) {
    files[angle] = path.join(root, `${angle}.png`); writeFileSync(files[angle]!, Buffer.from([137,80,78,71,13,10,26,10,1,2]));
  }
  const index = { schemaVersion: "workloom.portrait-index/v1", projectId: "P1", characters: { c1: { kind: "character", id: "c1", files } }, products: {} };
  const indexPath = path.join(root, "portrait-index.json"); writeFileSync(indexPath, JSON.stringify(index));
  const input = { workDir: dir, projectId: "P1", stage: { status: "completed", characters: 1, products: 0, completedPortraits: 4, pendingPortraits: 0 }, scriptReport: { characters_count: 1 } };
  return { root, files, index, indexPath, input };
}
describe("服务预生产 G5/G7", () => {
  it("G7 是文字预生产收口，不错误调用要求成片和听音回执的 master", () => expect(GATE_PRODUCER_STAGE.G7_FINAL).toBe("prompt"));
  it("只把实际读取的本项目四角度图片送审", () => {
    const f = fixture(); const evidence = portraitGateEvidence(f.input);
    expect(evidence.notApplicable).toBe(false); expect(evidence.deterministic.every(item => item.pass)).toBe(true);
    expect(evidence.artifacts.filter(item => item.kind === "image").map(item => item.path)).toEqual(Object.values(f.files).map(file => realpathSync(file)));
  });
  it.each(["missing-angle", "empty", "other-project", "escape", "symlink", "pending", "count"])("%s 证据失败关闭", kind => {
    const f = fixture();
    if (kind === "missing-angle") delete f.index.characters.c1.files.side;
    if (kind === "empty") writeFileSync(f.files.front!, "");
    if (kind === "other-project") f.index.projectId = "P2";
    if (kind === "escape") { f.index.characters.c1.files.front = path.join(dir, "outside.png"); writeFileSync(f.index.characters.c1.files.front, "image"); }
    if (kind === "symlink") { rmSync(f.files.front!); symlinkSync(f.files.side!, f.files.front!); }
    if (kind === "pending") f.input.stage.pendingPortraits = 1;
    if (kind === "count") f.input.stage.characters = 2;
    writeFileSync(f.indexPath, JSON.stringify(f.index));
    const result = portraitGateEvidence(f.input);
    expect(result.notApplicable).toBe(false); expect(result.deterministic.some(item => item.hard && !item.pass)).toBe(true);
    expect(result.artifacts).toEqual([]);
  });
  it("不适用需要本次明确无任务及剧本角色数零；空图本身不构成 N/A", () => {
    expect(portraitGateEvidence({ workDir: dir, projectId: "P1", stage: {}, scriptReport: {} }).notApplicable).toBe(false);
    const input = { workDir: dir, projectId: "P1", stage: { status: "skipped", reason: "no-characters-or-products" }, scriptReport: { characters_count: 0 } };
    expect(portraitGateEvidence(input)).toMatchObject({ notApplicable: true, deterministic: [{ status: "not_applicable" }] });
    expect(portraitGateEvidence({ ...input, scriptReport: { characters_count: 1 } }).notApplicable).toBe(false);
  });
});

describe("最终成片由人类验收，中间流程由系统检查", () => {
  it("G5 定妆照属于系统事实检查", () => {
    expect(AUTO_GATES.has("G5_PORTRAIT")).toBe(true);
    expect(AUTO_GATES.has("G2_THEME")).toBe(true);
  });

  it("渲染默认由原生资格与预算放行，显式暂停开关仍能停止付费", () => {
    expect(renderSubmitAutoAllowed({})).toBe(true);
    expect(renderSubmitAutoAllowed({ WORKLOOM_RENDER_AUTO: "0" })).toBe(false);
    expect(renderSubmitAutoAllowed({ WORKLOOM_RENDER_AUTO: "1" })).toBe(true);
  });

  it("人类验收清单逐张列出定妆照文件与指纹（放行前可核对原图）", () => {
    const f = fixture();
    const manifest = portraitReviewManifest({ workDir: dir, projectId: "P1" });
    expect(manifest.files).toHaveLength(4);
    expect(manifest.markdown).toContain("放行前请逐张看过原图");
    expect(manifest.markdown).toContain("角色 c1（front）");
    expect(manifest.markdown).toContain("sha256");
    expect(manifest.files.every((entry) => entry.sha256.length === 64)).toBe(true);
    expect(f.files.front).toBeTruthy();
  });
});

it("营销G1允许合法JSON空值，拒绝仅摘要或旧自报档案", () => {
  const good = { facts: { schemaVersion: "workloom.marketing-facts/v1", stages: [1, 2, 3], sources: [1], optional: null } };
  expect(gateDeterministicChecks("G1_DOSSIER", JSON.stringify(good)).every(check => check.pass)).toBe(true);
  for (const bad of ["商品事实摘要".repeat(100), JSON.stringify({ ...good, facts: { ...good.facts, stages: [1] } }), "null"]) expect(gateDeterministicChecks("G1_DOSSIER", bad).some(check => check.hard && !check.pass)).toBe(true);
});

function archivedPortraits(): NativeRequirementArchives {
  const files = Object.fromEntries(["front", "threeQuarter", "closeup", "side", "back", "actionPose", "emotionCloseup", "handDetail"].map((angle, index) => {
    const file = path.join(dir, `selected-${angle}.png`), bytes = Buffer.alloc(2048, index + 1);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); writeFileSync(file, bytes);
    return [angle, readPortraitArtifact(file)];
  }));
  return { characters: [{ id: "selected-ceo", name: "已选CEO", identity: { age: "三十岁上下", gender: "female" } }], products: [],
    portraits: [{ kind: "character", id: "selected-ceo", name: "已选CEO", aliases: [], files }] };
}
describe("G4完整原生PRD与受控档案实物", () => {
  it("实际reviewStage一批发送完整正文及所有8张原图；原回包分数不改", async () => {
    const archives = archivedPortraits(), source = prdArchiveGateEvidence(archives), text = "完整原生PRD及当前已选CEO合同。".repeat(80), file = path.join(dir, "G4.md");
    writeFileSync(file, text); const requests: any[] = [];
    const verdict = await reviewStage({ stage: "prompt", projectId: "P1", artifacts: [{ path: file, kind: "text" }, ...source.artifacts],
      deterministic: source.deterministic, batchSize: source.artifacts.length,
      env: { LLM_BASE_URL: "https://judge.example.test", LLM_API_KEY: "fixture-key", LLM_MODEL: "fixture-model" },
      fetchImpl: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: {
        content: JSON.stringify({ approved: true, score: 81, issues: [], suggestions: [], reason: "fixture-complete-original-input" }) } }] })); } });
    expect(requests).toHaveLength(1); const content = requests[0].messages[0].content;
    expect(content.filter((item: any) => item.type === "image_url")).toHaveLength(8);
    for (const artifact of source.artifacts) expect(content.some((item: any) => item.image_url?.url?.endsWith(readFileSync(artifact.path).toString("base64")))).toBe(true);
    expect(content.some((item: any) => item.type === "text" && item.text.endsWith(text))).toBe(true);
    expect(verdict).toMatchObject({ approved: true, score: 81, via: "llm", degraded: false });
    expect(prdArchiveReviewMatches(archives, verdict.evidence)).toBe(true);
  });
  it.each(["missing-angle", "changed-bytes", "wrong-hash", "wrong-name", "symlink", "absent-photos"])("%s不能用文字替代当前实物", kind => {
    const archives = archivedPortraits(), asset = archives.portraits![0]!;
    if (kind === "missing-angle") delete asset.files.side;
    if (kind === "changed-bytes") writeFileSync(asset.files.front!.path, Buffer.alloc(2048, 99));
    if (kind === "wrong-hash") asset.files.front!.sha256 = "0".repeat(64);
    if (kind === "wrong-name") asset.name = "另一人";
    if (kind === "symlink") { const front = asset.files.front!.path; rmSync(front); symlinkSync(asset.files.side!.path, front); }
    if (kind === "absent-photos") archives.portraits = [];
    const proof = prdArchiveGateEvidence(archives); expect(proof.artifacts).toEqual([]); expect(proof.deterministic[0]).toMatchObject({ pass: false, hard: true });
    expect(prdArchiveReviewMatches(archives, [])).toBe(false);
  });
  it.each(["missing", "wrong-scope", "wrong-hash", "changed-during-review"])("%s回执不能放行G4", kind => {
    const archives = archivedPortraits(), evidence: Array<{ path: string; sha256: string; scope: string }> = prdArchiveGateEvidence(archives).expected;
    if (kind === "missing") evidence.pop();
    if (kind === "wrong-scope") evidence[0]!.scope = "complete-text";
    if (kind === "wrong-hash") evidence[0]!.sha256 = "0".repeat(64);
    if (kind === "changed-during-review") writeFileSync(evidence[0]!.path, Buffer.alloc(2048, 99));
    expect(prdArchiveReviewMatches(archives, evidence)).toBe(false);
  });
  it("没有选档的原生叙事保持素材规划，不虚构受控照片", () => {
    expect(prdArchiveGateEvidence({ characters: [], products: [] })).toMatchObject({ artifacts: [], expected: [], deterministic: [{ pass: true }] });
    expect(prdArchiveReviewMatches({ characters: [], products: [] }, [])).toBe(true);
  });
});
