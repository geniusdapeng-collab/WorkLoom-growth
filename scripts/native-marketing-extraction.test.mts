import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(process.env.WORKLOOM_ASSERTION_MODULE_ROOT ?? new URL("../", import.meta.url).pathname);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const text = "商品F3风量9档";
const source = { sourceId: "SRC-1", requestedUrl: "https://example.test/f3", finalUrl: "https://example.test/f3", redirectChain: [], fetchedAt: new Date().toISOString(),
  contentType: "text/plain", rawSha256: sha(text), textSha256: sha(text), bytes: Buffer.byteLength(text), text, assetUrls: ["https://example.test/f3.png"] };
const valid = () => ({ payload: { identity: { name: "F3", specs: { 风量: "9档" } }, images: [{ url: source.assetUrls[0], page_url: source.finalUrl, angle: "unknown" }] },
  citations: ["/identity/name", "/identity/specs/风量"].map(pointer => ({ pointer, sourceId: source.sourceId, quote: text })) });
const moduleAt = () => import(pathToFileURL(resolve(root, "apps/server/src/video/marketing-extraction.ts")).href);
test("a native extraction gets one schema correction and preserves both original responses", async () => {
  const { extractMarketingStageFacts } = await moduleAt();
  const records: any[] = [], prompts: string[] = [];
  const invalid = valid(); Object.assign(invalid.payload.images[0]!, { width: 100, height: 200 });
  const facts = await extractMarketingStageFacts({ stage: "A1", prompt: "complete-source", sources: [source],
    llm: { reason: async (prompt: string) => { prompts.push(prompt); return { success: true, data: prompts.length === 1 ? invalid : valid() }; } },
    persistAttempt: async (record: unknown) => { records.push(structuredClone(record)); } });
  assert.equal(prompts.length, 2); assert.equal(records.length, 2);
  assert.match(prompts[0]!, /"additionalProperties":false/); assert.match(prompts[1]!, /结构校正/);
  assert.equal(records[0].response.data.payload.images[0].width, 100);
  assert.equal(records[0].validation.ok, false); assert.deepEqual(records[1].validation, { ok: true });
  assert.equal(facts.status, "source_bound"); assert.equal(facts.claims.length, 2);
});
test("persistent structural errors stop after exactly two recorded responses", async () => {
  const { extractMarketingStageFacts } = await moduleAt(); let calls = 0; const records: any[] = [];
  const invalid = valid(); Object.assign(invalid.payload.images[0]!, { width: 100 });
  await assert.rejects(() => extractMarketingStageFacts({ stage: "A1", prompt: "complete-source", sources: [source],
    llm: { reason: async () => { calls++; return { success: true, data: invalid }; } }, persistAttempt: async (record: unknown) => { records.push(record); } }), /MARKETING_PAYLOAD_INVALID/);
  assert.equal(calls, 2); assert.equal(records.length, 2); assert.equal(records.every(record => record.validation.ok === false), true);
});
test("invented citations cannot enter the format correction path", async () => {
  const { extractMarketingStageFacts } = await moduleAt(); let calls = 0; const records: any[] = [];
  const invalid = valid(); invalid.citations[0]!.quote = "invented-source-quote";
  await assert.rejects(() => extractMarketingStageFacts({ stage: "A1", prompt: "complete-source", sources: [source],
    llm: { reason: async () => { calls++; return { success: true, data: invalid }; } }, persistAttempt: async (record: unknown) => { records.push(record); } }), /MARKETING_CITATION_INVALID/);
  assert.equal(calls, 1); assert.equal(records.length, 1); assert.equal(records[0].validation.ok, false);
});
test("a failed extraction call or receipt write stops without additional provider work", async () => {
  const { extractMarketingStageFacts } = await moduleAt(); let calls = 0;
  await assert.rejects(() => extractMarketingStageFacts({ stage: "A1", prompt: "complete-source", sources: [source],
    llm: { reason: async () => { calls++; return { success: false, error: "provider unavailable" }; } }, persistAttempt: async () => {} }), /MARKETING_EXTRACTION_UNVERIFIED/);
  assert.equal(calls, 1); calls = 0;
  await assert.rejects(() => extractMarketingStageFacts({ stage: "A1", prompt: "complete-source", sources: [source],
    llm: { reason: async () => { calls++; return { success: true, data: valid() }; } }, persistAttempt: async () => { throw new Error("owned receipt write failed"); } }), /owned receipt write failed/);
  assert.equal(calls, 1);
});
