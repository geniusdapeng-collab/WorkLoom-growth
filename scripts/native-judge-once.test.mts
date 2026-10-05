import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewStage } from "../packages/video-studio/src/producer-gate.js";

const good = { approved: true, score: 96, issues: [], suggestions: [], reason: "逐主张原文支持" };
async function run(raw: string, stage: "facts" | "prompt" = "facts") {
  const dir = mkdtempSync(join(tmpdir(), "native-judge-once-")), path = join(dir, "facts.json");
  writeFileSync(path, JSON.stringify({ source: "原文否定此主张", claim: "此主张可使用" }));
  let calls = 0;
  try {
    const verdict = await reviewStage({ stage, projectId: "P-once", artifacts: [{ path, kind: "json" }], deterministic: [], minScore: 85,
      env: { LLM_BASE_URL: "https://judge.example.test", LLM_API_KEY: "test-only", LLM_MODEL: "judge" },
      fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ choices: [{ message: { content: calls === 1 ? raw : JSON.stringify(good) } }] })); } });
    return { verdict, calls };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const unsafe = [
  { label: "explicit denial with malformed suggestions", raw: JSON.stringify({ ...good, approved: false, score: 10, suggestions: [false], reason: "原文不支持" }) },
  { label: "low score with malformed issues", raw: JSON.stringify({ ...good, score: 10, issues: { rejected: "原文不支持" } }) },
  { label: "malformed positive cannot gain qualification from another answer", raw: JSON.stringify({ ...good, suggestions: [false] }) },
  { label: "unknown decision cannot be synthesized", raw: JSON.stringify({ ...good, approved: "maybe" }) },
  { label: "truncated negative JSON cannot be rewritten", raw: '{"approved":false,"score":10,"reason":"原文不支持"' },
  { label: "non-JSON text cannot hide rejection behind a positive object", raw: '原文不支持，approved=false。\n' + JSON.stringify(good) },
  { label: "duplicate decision keys cannot overwrite a denial", raw: '{"approved":false,"score":10,"approved":true,"score":96,"issues":[],"suggestions":[],"reason":"原文不支持"}' },
  { label: "escaped duplicate decision keys cannot overwrite a denial", raw: '{"approved":false,"\\u0061pproved":true,"score":96,"issues":[],"suggestions":[],"reason":"原文不支持"}' },
  { label: "duplicate scores cannot overwrite a low score", raw: '{"approved":true,"score":10,"score":96,"issues":[],"suggestions":[],"reason":"原文不支持"}' },
  { label: "an unclosed code fence is not a complete verdict", raw: "```json\n" + JSON.stringify(good) },
  { label: "an unmatched closing fence is not a complete verdict", raw: JSON.stringify(good) + "\n```" },
];
for (const { label, raw } of unsafe) test(label + " stops after one judge call", async () => {
  for (const stage of ["facts", "prompt"] as const) {
    const { verdict, calls } = await run(raw, stage);
    assert.equal(calls, 1, `${stage} must not resubmit a semantic decision`);
    assert.equal(verdict.approved, false); assert.notEqual(verdict.status, "passed");
  }
});
test("unambiguous local coercion preserves a negative score and decision", async () => {
  const { verdict, calls } = await run(JSON.stringify({ approved: " FALSE ", score: "10", issues: "原文不支持", suggestions: [], summary: "否定主张不可用" }));
  assert.equal(calls, 1); assert.equal(verdict.status, "failed"); assert.equal(verdict.approved, false);
  assert.equal(verdict.score, 10); assert.match(verdict.reason, /否定主张不可用/);
});
test("legal fenced JSON and unambiguous positive fields need no extra model", async () => {
  const { verdict, calls } = await run("```json\n" + JSON.stringify({ ...good, approved: "true", score: "96" }) + "\n```");
  assert.equal(calls, 1); assert.equal(verdict.status, "passed"); assert.equal(verdict.score, 96);
});
