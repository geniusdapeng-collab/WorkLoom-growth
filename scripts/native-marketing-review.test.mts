import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewStage } from "../packages/video-studio/src/producer-gate.js";

async function review(input: { stage?: string; approved?: boolean; contracts?: unknown; visual?: boolean; unavailable?: boolean } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "native-fact-review-"))), file = join(dir, "facts.json");
  const raw = JSON.stringify({ facts: { value: "无需更换门锁", quote: "支持循环发卡，酒店无需更换门锁系统" },
    sources: [{ text: "完整客户原文；另一未选规格有相互冲突值", restrictions: ["客户项目内使用，公开投放前需确认"] }] });
  writeFileSync(file, raw); const bodies: any[] = [];
  try {
    const verdict = await reviewStage({ stage: input.stage ?? "facts", projectId: "P-facts", artifacts: [{ path: file, kind: input.visual ? "image" : "json" }],
      deterministic: [{ id: "claims-source-bound", hard: true, pass: true, detail: "原文引用完整" }], requiredCheckIds: ["claims-source-bound"], minScore: 85,
      env: input.unavailable ? {} : { LLM_BASE_URL: "https://judge.example.test", LLM_API_KEY: "test-only", LLM_MODEL: "judge" },
      ...(input.contracts === undefined ? {} : { contracts: input.contracts }),
      fetchImpl: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ choices: [{ message: {
        content: JSON.stringify({ approved: input.approved !== false, score: input.approved === false ? 10 : 96, issues: [], suggestions: [], reason: "逐主张原文核验" }),
      } }] })); } } as any);
    return { verdict, bodies, raw };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("native fact review examines complete source support without an imaginary shot contract", async () => {
  const value = await review(); assert.equal(value.verdict.status, "passed", value.verdict.reason);
  assert.equal(value.bodies.length, 1); assert.equal(value.verdict.via, "llm");
  const prompt = JSON.stringify(value.bodies[0]);
  assert.doesNotMatch(prompt, /镜头合同|年代、人数、空间或设备型号/);
  assert.match(prompt, /逐主张/); assert.match(prompt, /公开投放前需确认/);
  assert.match(prompt, /另一未选规格有相互冲突值/);
  assert.equal(value.verdict.evidence?.[0]?.scope, "complete-text");
});
test("source-support rejection remains a failed verdict and does not retry the semantic decision", async () => {
  const value = await review({ approved: false });
  assert.equal(value.verdict.status, "failed"); assert.equal(value.verdict.approved, false); assert.equal(value.bodies.length, 1);
});
test("fact review cannot grant visual or shot-contract qualification", async () => {
  for (const input of [{ contracts: { shots: [{ shotId: "S1", scene: "产品特写" }] } }, { visual: true }]) {
    const value = await review(input);
    assert.equal(value.verdict.status, "unverified"); assert.equal(value.bodies.length, 0);
    assert.match(value.verdict.reason, /事实审核只接受完整文本|事实审核不消费镜头合同/);
  }
});
test("missing source-review model remains unverified rather than a fact approval", async () => {
  const value = await review({ unavailable: true }); assert.equal(value.verdict.approved, false);
  assert.equal(value.verdict.status, "unverified"); assert.equal(value.bodies.length, 0);
});
test("ordinary prompt review retains its missing shot-contract boundary", async () => {
  const value = await review({ stage: "prompt" });
  assert.equal(value.verdict.status, "passed"); assert.match(JSON.stringify(value.bodies[0]), /未提供结构化镜头合同/);
});
