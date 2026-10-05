import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { reviewStage } from "../packages/video-studio/src/producer-gate.js";

const good = { approved: true, score: 96, issues: [], suggestions: [], reason: "原文支持" };
async function review(baseUrl: string, model: string, finish = "stop", answer = good) {
  const dir = mkdtempSync(join(tmpdir(), "judge-reasoning-budget-")), file = join(dir, "source.json"), saved = join(dir, "exchange.json");
  writeFileSync(file, JSON.stringify({ claim: "产品规格", source: "完整原文" }));
  const requests: any[] = [], exchanges: any[] = [];
  try {
    const verdict = await reviewStage({ stage: "facts", projectId: model, artifacts: [{ path: file, kind: "json" }], deterministic: [], minScore: 85,
      env: { LLM_BASE_URL: baseUrl, LLM_API_KEY: "fixture-key", LLM_MODEL: model },
      fetchImpl: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ model, choices: [{ finish_reason: finish, message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 10, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 6 } } })); },
      onModelExchange: async exchange => { exchanges.push(exchange); const bytes = JSON.stringify(exchange); writeFileSync(saved, bytes, { flag: "wx" }); return { path: saved, sha256: createHash("sha256").update(bytes).digest("hex") }; },
    });
    return { verdict, requests, exchanges };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("official DeepSeek thinking models preserve high reasoning with a bounded64K total output budget", async () => {
  for (const model of ["deepseek-flash", "deepseek-v4-pro"]) {
    const result = await review("https://api.deepseek.com/v1", model);
    assert.equal(result.requests.length, 1); assert.equal(result.requests[0].max_tokens, 65536);
    assert.deepEqual(result.requests[0].thinking, { type: "enabled" }); assert.equal(result.requests[0].reasoning_effort, "high");
    assert.equal(result.requests[0].temperature, undefined); assert.equal(result.verdict.approved, true);
  }
});
test("unknown models and endpoints retain their generic budget and receive no DeepSeek-only fields", async () => {
  for (const [base, model] of [["https://judge.example.test", "deepseek-flash"], ["https://api.deepseek.com.evil.example.test", "deepseek-flash"], ["https://api.deepseek.com", "unknown-model"]]) {
    const result = await review(base, model);
    assert.equal(result.requests[0].max_tokens, 8192); assert.equal(result.requests[0].thinking, undefined); assert.equal(result.requests[0].reasoning_effort, undefined);
    assert.equal(result.requests[0].temperature, 0.2); assert.equal(result.requests.length, 1);
  }
});
test("length, aborted and filtered responses cannot qualify even if their visible JSON looks complete", async () => {
  for (const finish of ["length", "aborted", "content_filter", "insufficient_system_resource", "tool_calls"]) {
    const result = await review("https://api.deepseek.com", "deepseek-flash", finish);
    assert.equal(result.verdict.approved, false); assert.equal(result.verdict.status, "unverified");
    assert.match(result.verdict.reason, new RegExp(finish)); assert.equal(result.requests.length, 1); assert.equal(result.exchanges.length, 1);
    assert.equal(JSON.parse(result.exchanges[0].response.body).choices[0].finish_reason, finish);
  }
});
test("completed negative verdict still stops once with its original score and decision", async () => {
  const result = await review("https://api.deepseek.com", "deepseek-flash", "stop", { ...good, approved: false, score: 10, reason: "原文不支持" });
  assert.equal(result.verdict.status, "failed"); assert.equal(result.verdict.score, 10); assert.equal(result.requests.length, 1);
});
test("concurrent known and generic providers cannot leak reasoning options across projects", async () => {
  const values = await Promise.all([review("https://api.deepseek.com", "deepseek-flash"), review("https://judge.example.test", "judge")]);
  assert.equal(values[0].requests[0].max_tokens, 65536); assert.equal(values[1].requests[0].max_tokens, 8192);
  assert.equal(values[1].requests[0].thinking, undefined); assert.equal(values[0].exchanges[0].projectId, "deepseek-flash"); assert.equal(values[1].exchanges[0].projectId, "judge");
});
