import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { reviewStage } from "../packages/video-studio/src/producer-gate.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const negative = { approved: false, score: 10, issues: ["原文不支持"], suggestions: [], reason: "原文否定此主张" };
async function run(rawBody: string, options: { status?: number; failArchive?: boolean; projectId?: string; secret?: string; mutate?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "judge-exchange-")), source = join(dir, "facts.json"), archive = join(dir, "exchange.json");
  writeFileSync(source, JSON.stringify({ claim: "商品效果", source: "原文否定商品效果" }));
  const exchanges: any[] = [], requests: any[] = []; let calls = 0;
  try {
    const verdict = await reviewStage({ stage: "facts", projectId: options.projectId ?? "P-exchange", artifacts: [{ path: source, kind: "json" }], deterministic: [], minScore: 85,
      env: { LLM_BASE_URL: "https://judge.example.test", LLM_API_KEY: options.secret ?? "test-only-secret", LLM_MODEL: "judge" },
      fetchImpl: async (_url, init) => { calls++; requests.push(JSON.parse(String(init?.body))); return new Response(rawBody, { status: options.status ?? 200 }); },
      onModelExchange: async (record: any) => {
        exchanges.push(record);
        if (options.failArchive) throw new Error("injected archive disk failure");
        const bytes = JSON.stringify(record); writeFileSync(archive, bytes, { flag: "wx" });
        if (options.mutate) writeFileSync(source, "changed while archiving");
        return { path: archive, sha256: sha(bytes) };
      },
    } as any);
    return { verdict, calls, requests, exchanges, archived: exchanges.length && !options.failArchive ? readFileSync(archive, "utf8") : undefined };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("malformed judge and HTTP responses are archived before rejection, with no second decision", async () => {
  const bodies = ["not JSON", JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...negative, suggestions: [false] }) }, finish_reason: "stop" }], usage: { total_tokens: 19 } }), "upstream unavailable"];
  for (const [index, body] of bodies.entries()) {
    const value = await run(body, { status: index === 2 ? 503 : 200 });
    assert.equal(value.calls, 1); assert.equal(value.verdict.approved, false);
    assert.equal(value.exchanges.length, 1, "original raw response must survive invalid JSON/shape/HTTP");
    assert.equal(value.exchanges[0].response.body, body); assert.equal(value.exchanges[0].response.sha256, sha(body));
    assert.equal(value.exchanges[0].response.status, index === 2 ? 503 : 200);
    assert.equal(value.verdict.evidence?.at(-1)?.scope, "judge-model-exchange");
  }
});
test("schema and valid JSON example constrain field types without retrying a negative verdict", async () => {
  const value = await run(JSON.stringify({ choices: [{ message: { content: JSON.stringify(negative) } }] }));
  const prompt = value.requests[0].messages[0].content[0].text;
  assert.doesNotMatch(prompt, /true\|false|0-100/); assert.match(prompt, /"type":"boolean"/);
  assert.match(prompt, /"minimum":0,"maximum":100/); assert.match(prompt, /"type":"array","items":\{"type":"string"\}/);
  assert.match(prompt, /"approved":false,"score":0/);
  assert.equal(value.requests[0].response_format.type, "json_object"); assert.equal(value.requests[0].max_tokens, 8192);
  assert.equal(value.verdict.status, "failed"); assert.equal(value.verdict.score, 10); assert.equal(value.calls, 1);
});
test("credential echoes are redacted from archival bytes while original response hash remains exact", async () => {
  const secret = "fixture-credential-never-save", body = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...negative, reason: secret }) } }] });
  const value = await run(body, { secret });
  assert.equal(value.exchanges.length, 1); assert.doesNotMatch(value.archived!, new RegExp(secret));
  assert.equal(value.exchanges[0].response.redacted, true); assert.equal(value.exchanges[0].response.sha256, sha(body));
  assert.equal(value.exchanges[0].requestSha256, sha(JSON.stringify(value.requests[0])));
});
test("archive write failure refuses even a positive model answer and never rescores", async () => {
  const body = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...negative, approved: true, score: 99 }) } }] });
  const value = await run(body, { failArchive: true });
  assert.equal(value.verdict.approved, false); assert.equal(value.verdict.status, "unverified");
  assert.match(value.verdict.reason, /原响应归档失败/); assert.equal(value.calls, 1); assert.equal(value.exchanges.length, 1);
});
test("concurrent project exchanges keep separate request, response and evidence identities", async () => {
  const values = await Promise.all(["P-a", "P-b"].map(projectId => run(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...negative, reason: projectId }) } }] }), { projectId })));
  for (const [index, value] of values.entries()) {
    assert.equal(value.exchanges.length, 1); assert.equal(value.exchanges[0].projectId, index === 0 ? "P-a" : "P-b");
    assert.equal(value.exchanges[0].batch, 1); assert.equal(value.exchanges[0].batches, 1); assert.equal(value.calls, 1);
  }
  assert.notEqual(values[0].exchanges[0].response.sha256, values[1].exchanges[0].response.sha256);
});
test("source mutation during archival cannot acquire positive qualification", async () => {
  const value = await run(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...negative, approved: true, score: 99 }) } }] }), { mutate: true });
  assert.equal(value.calls, 1); assert.equal(value.exchanges.length, 1); assert.equal(value.verdict.approved, false);
  assert.match(value.verdict.reason, /产物发生变化/);
});
