import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadProductArchiveSource } from "../apps/server/src/video/product-archive-source.js";
import { validateStageFacts, revalidateStageFacts, stageExtractionJsonSchema } from "../apps/server/src/video/marketing-facts.js";
import { extractMarketingStageFacts } from "../apps/server/src/video/marketing-extraction.js";

async function fixture(run: (value: any) => Promise<void> | void): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-product-policy-"))), dir = join(root, "machine"); mkdirSync(dir);
  const photo = Buffer.from("customer photo bytes"), profile = { schemaVersion: "workloom.product-archive/v1", id: "machine", displayName: "酒店自助机", model: "P1",
    source: { kind: "user-upload", reviewStatus: "owner-confirmed", extraction: { verified: false, note: "页码和图片映射为机器判定，需客户抽查" },
      disclaimer: "仅客户项目内使用；公开投放前确认素材授权与参数口径" },
    photos: [{ id: "p1", file: "photo.jpg", sha256: createHash("sha256").update(photo).digest("hex"), bytes: photo.length }],
    specs: { features: ["支持循环发卡，酒店无需更换门锁系统，支持现场发"], parameters: [
      { name: "发卡", value: "50张", source: "page 2" }, { name: "发卡", value: "100张", source: "page 2" },
      { name: "摄像头", value: "2MP", source: "page 3" } ] } };
  const raw = JSON.stringify(profile, null, 2); writeFileSync(join(dir, "profile.json"), raw); writeFileSync(join(dir, "photo.jpg"), photo);
  try {
    const archive = await loadProductArchiveSource("machine", root), source = archive.snapshot;
    const valid = () => ({ payload: { identity: { name: "酒店自助机", specs: {}, official_selling_points: [{ point: "无需更换门锁系统", source_url: source.finalUrl }] } },
      citations: [{ pointer: "/identity/name", sourceId: source.sourceId, quote: "酒店自助机", sourcePointer: "/displayName" },
        { pointer: "/identity/official_selling_points/0/point", sourceId: source.sourceId, quote: "酒店无需更换门锁系统", sourcePointer: "/specs/features/0" }] });
    await run({ archive, source, profile, raw, valid });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("controlled source retains every customer byte and machine warning while carrying use restrictions", async () => fixture(({ source, raw }) => {
  assert.equal(source.text, raw); assert.equal(source.policy?.extractionVerified, false);
  assert.match(JSON.stringify(source.policy?.restrictions), /仅客户项目内使用|需客户抽查/);
  assert.equal(source.policy?.conflicts.length, 1); assert.deepEqual(source.policy.conflicts[0].values, ["50张", "100张"]);
  assert.match(source.text, /50张/); assert.match(source.text, /100张/);
}));
test("a source-bound complete claim can use a literal clause without completing a truncated sentence", async () => fixture(({ source, valid }) => {
  const facts = validateStageFacts("A1", valid(), [source]);
  assert.equal(facts.claims.length, 2); assert.equal(facts.claims[1]!.sourcePointer, "/specs/features/0");
  assert.equal(facts.claims[1]!.value, "无需更换门锁系统"); assert.doesNotThrow(() => revalidateStageFacts(facts, [source]));
}));
test("conflicting parameter entries are not selectable even with literal original quotations", async () => fixture(({ source, valid }) => {
  for (const index of [0, 1]) {
    const data = valid(); data.payload.identity.specs = { 发卡: index === 0 ? "50张" : "100张" };
    data.citations.push({ pointer: "/identity/specs/发卡", sourceId: source.sourceId, quote: index === 0 ? "50张" : "100张", sourcePointer: `/specs/parameters/${index}/value` });
    assert.throws(() => validateStageFacts("A1", data, [source]), /PRODUCT_CLAIM_BLOCKED/);
  }
}));
test("archive claims cannot evade field identity with an entire-profile quote or source metadata", async () => fixture(({ source, valid, raw }) => {
  const missing = valid(); delete missing.citations[0]!.sourcePointer; missing.citations[0]!.quote = raw;
  assert.throws(() => validateStageFacts("A1", missing, [source]), /PRODUCT_CLAIM_POINTER/);
  const metadata = valid(); metadata.citations[1]!.sourcePointer = "/source/disclaimer";
  metadata.citations[1]!.quote = "仅客户项目内使用";
  assert.throws(() => validateStageFacts("A1", metadata, [source]), /PRODUCT_CLAIM_POINTER/);
  const wrong = valid(); wrong.citations[1]!.sourcePointer = "/model";
  assert.throws(() => validateStageFacts("A1", wrong, [source]), /PRODUCT_CLAIM_QUOTE/);
}));
test("source-policy and saved source-pointer changes cannot retain fact qualification", async () => fixture(({ source, valid }) => {
  const altered = structuredClone(source); altered.policy = { ...altered.policy, restrictions: [] };
  assert.throws(() => validateStageFacts("A1", valid(), [altered]), /PRODUCT_SOURCE_POLICY_CHANGED/);
  const facts = validateStageFacts("A1", valid(), [source]); facts.claims[1]!.sourcePointer = "/model";
  assert.throws(() => revalidateStageFacts(facts, [source]), /PRODUCT_CLAIM_QUOTE|MARKETING_FACTS_CHANGED/);
}));
test("blocked source fields fail after one recorded extraction rather than a format correction", async () => fixture(async ({ source, valid }) => {
  const data = valid(); data.payload.identity.specs = { 发卡: "50张" };
  data.citations.push({ pointer: "/identity/specs/发卡", sourceId: source.sourceId, quote: "50张", sourcePointer: "/specs/parameters/0/value" });
  let calls = 0; const attempts: any[] = [];
  await assert.rejects(() => extractMarketingStageFacts({ stage: "A1", prompt: "complete-source", sources: [source],
    llm: { reason: async () => { calls++; return { success: true, data }; } }, persistAttempt: async (attempt: unknown) => { attempts.push(attempt); } }), /PRODUCT_CLAIM_BLOCKED/);
  assert.equal(calls, 1); assert.equal(attempts.length, 1); assert.equal(attempts[0].validation.ok, false);
}));
test("the native extraction schema documents optional structured source pointers for archive citations", () => {
  assert.match(JSON.stringify(stageExtractionJsonSchema("A1")), /sourcePointer/);
});
