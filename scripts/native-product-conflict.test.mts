import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
const root = resolve(process.env.WORKLOOM_ASSERTION_MODULE_ROOT ?? new URL("../", import.meta.url).pathname);
const at = (file: string) => import(pathToFileURL(resolve(root, file)).href);
const policyModule = () => at("apps/server/src/video/product-source-policy.ts");
const factsModule = () => at("apps/server/src/video/marketing-facts.ts");
async function fixture(profile: any) {
  const { deriveProductSourcePolicy } = await policyModule();
  const { renderSha256 } = await at("apps/server/src/video/gen/compiled-request.ts");
  const text = JSON.stringify(profile), url = "workloom-archive://products/test/profile.json";
  return { sourceId: "SRC-test", finalUrl: url, requestedUrl: url, text, textSha256: renderSha256(text),
    rawSha256: renderSha256(text), fetchedAt: new Date().toISOString(), bytes: Buffer.byteLength(text),
    contentType: "application/json", assetUrls: [], redirectChain: [], policy: deriveProductSourcePolicy(profile) };
}
const profile = () => ({ schemaVersion: "workloom.product-archive/v1", displayName: "台式自助机", model: "M1",
  aliases: ["台式自助机", "M1", "M2"], variants: [{ model: "M1" }, { model: "M2" }],
  source: { extraction: { verified: false }, disclaimer: "仅当前客户项目使用" },
  specs: { features: ["支持一键退房"], parameters: [{ name: "型号", value: "M1", source: "page 2" }, { name: "型号", value: "M2", source: "page 2" }] } });
const data = (source: any, model = true) => ({ payload: { identity: { name: "台式自助机", ...(model ? { model: "M1" } : {}),
  specs: {}, official_selling_points: [{ point: "支持一键退房", source_url: source.finalUrl }] } },
  citations: [{ pointer: "/identity/name", sourceId: source.sourceId, quote: "台式自助机", sourcePointer: "/displayName" },
    { pointer: "/identity/official_selling_points/0/point", sourceId: source.sourceId, quote: "支持一键退房", sourcePointer: "/specs/features/0" },
    ...(model ? [{ pointer: "/identity/model", sourceId: source.sourceId, quote: "M1", sourcePointer: "/model" }] : [])] });
test("a conflicting model cannot be selected through model, aliases or variant leaves", async () => {
  const source = await fixture(profile()), { validateStageFacts } = await factsModule();
  for (const pointer of ["/model", "/aliases/1", "/variants/0/model"]) {
    const value = data(source); value.citations[2]!.sourcePointer = pointer;
    assert.throws(() => validateStageFacts("A1", value, [source]), /PRODUCT_CLAIM_BLOCKED/);
  }
});
test("omitting the optional conflicting model preserves safe product claims and full original bytes", async () => {
  const original = profile(), source = await fixture(original), { validateStageFacts, revalidateStageFacts } = await factsModule();
  const facts = validateStageFacts("A1", data(source, false), [source]);
  assert.equal(facts.claims.length, 2); assert.equal(source.text, JSON.stringify(original));
  assert.doesNotThrow(() => revalidateStageFacts(facts, [source]));
  assert.match(JSON.stringify(source.policy.restrictions), /型号|仅当前客户/);
  assert.match(source.text, /M1/); assert.match(source.text, /M2/);
});
test("a single unambiguous model remains selectable and unrelated aliases remain available", async () => {
  const original = profile(); original.specs.parameters.splice(1); original.aliases = ["台式自助机", "M1"];
  const source = await fixture(original), { validateStageFacts } = await factsModule();
  assert.equal(validateStageFacts("A1", data(source), [source]).claims.length, 3);
  assert.ok(!source.policy.blockedFields.some((entry: any) => entry.pointer === "/model"));
});
test("the actual CXZ archive's conflicting optional model is blocked without changing customer data", async () => {
  const { loadProductArchiveSource } = await at("apps/server/src/video/product-archive-source.ts");
  const archive = await loadProductArchiveSource("demo-t001");
  assert.ok(archive.snapshot.policy.blockedFields.some((entry: any) => entry.pointer === "/model"));
  assert.equal(archive.snapshot.text, readFileSync(resolve(root, "bundles/ai-video/library/products/demo-t001/profile.json"), "utf8"));
  assert.equal(archive.snapshot.policy.extractionVerified, false);
  assert.ok(archive.snapshot.policy.conflicts.some((entry: any) => entry.name === "型号"));
});
test("selecting a conflicting identity model records one denial and performs no format correction", async () => {
  const source = await fixture(profile()), { extractMarketingStageFacts } = await at("apps/server/src/video/marketing-extraction.ts");
  let calls = 0; const records: any[] = [];
  await assert.rejects(() => extractMarketingStageFacts({ stage: "A1", prompt: "full original source", sources: [source],
    llm: { reason: async () => { calls++; return { success: true, data: data(source) }; } },
    persistAttempt: async (record: any) => { records.push(record); } }), /PRODUCT_CLAIM_BLOCKED/);
  assert.equal(calls, 1); assert.equal(records.length, 1); assert.equal(records[0].validation.ok, false);
});
