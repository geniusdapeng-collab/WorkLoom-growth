import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareMarketingFacts, finalizeMarketingFacts, verifyMarketingFacts } from "../apps/server/src/video/marketing-authority.js";
import { validateStageFacts } from "../apps/server/src/video/marketing-facts.js";
import { canonicalRenderJson, renderSha256 } from "../apps/server/src/video/gen/compiled-request.js";
import { VideoStudio } from "../packages/video-studio/src/studio.js";
import { WorkloomLLMEngine } from "../packages/video-studio/src/llm-adapter.js";
import { sourceRestrictionsHash } from "../packages/video-studio/src/source-restrictions.js";

const require = createRequire(import.meta.url);
const { JennyLoomEngine } = require("../vendor/supermickey/hyperreality-system/engines/data-mining-engine/index.js");
const { HyperrealitySystem } = require("../vendor/supermickey/hyperreality-system/index.js");
const adapterPath = new URL("../packages/video-studio/src/native-marketing-dossier.ts", import.meta.url);
const adapter = existsSync(fileURLToPath(adapterPath)) ? await import(adapterPath.href) : undefined;
const sourceUrl = "https://source.example.test/device";
const sourceText = "本次商品，品牌源品牌，型号源型号，类别源类别；Wi-Fi 支持 2.4G/5G；蓝牙不支持；规格 0；性能 true；售价 399 CNY；便携；正面";
const source = { sourceId: "SRC-dossier", requestedUrl: sourceUrl, finalUrl: sourceUrl, redirectChain: [],
  fetchedAt: "2026-10-05T00:00:00.000Z", contentType: "text/plain", bytes: Buffer.byteLength(sourceText), text: sourceText,
  rawSha256: renderSha256(sourceText), textSha256: renderSha256(sourceText), assetUrls: ["https://source.example.test/hero.png"] };
const query = { name: "本次商品", brand: "查询品牌", model: "查询型号", category: "查询类别" };
const rawFixture = () => ({ A1: { identity: { name: "本次商品", specs: { "Wi-Fi": "支持 2.4G/5G", 蓝牙: "不支持" },
  prices: [], official_selling_points: [] }, images: [] }, A2: { reviews: [] }, A3: { competitors: [] } });
const noEvidenceReason = "本次无可核实评价或竞品；无关检索页不能填事实";
const restrictions = ["页码→商品→图片为机器判定，图片映射与素材授权未核实；投放前须客户确认", "无评价禁止口碑评分", "无竞品禁止对比"];
function stagesFor(raw: any) {
  return ["A1", "A2", "A3"].map(stage => {
    const payload = raw[stage], citations: any[] = [];
    const walk = (value: any, pointer = "") => {
      if (Array.isArray(value)) return value.forEach((entry, i) => walk(entry, `${pointer}/${i}`));
      if (value && typeof value === "object") return Object.entries(value).forEach(([key, entry]) => {
        if ((!['url', 'source_url', 'page_url', 'source', 'channel', 'suspect'].includes(key) || pointer === "/identity/specs") && !(key === "angle" && entry === "unknown")) {
          walk(entry, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
        }
      });
      citations.push({ pointer, sourceId: source.sourceId, quote: sourceText });
    };
    walk(payload);
    return validateStageFacts(stage as any, { payload, citations, ...(stage !== "A1" ? { noEvidenceReason } : {}) }, [source]);
  });
}
function compile(raw = rawFixture(), productQuery: any = query, limits = restrictions) {
  assert.ok(adapter, "the shared source-bound native adapter must exist");
  const stages = stagesFor(raw), reviewed = Object.fromEntries(stages.map(stage => [stage.stage, stage.payload]));
  return adapter.createNativeMarketingDossier({ rawJson: canonicalRenderJson(reviewed), productQuery,
    stages, sources: [source], restrictions: limits });
}
async function temporary(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "native-dossier-")));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function host(root: string, productQuery: any = query, raw: any = rawFixture()) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ approved: true,
    score: 96, issues: [], suggestions: [], reason: "fixture source-support judge" }) }, finish_reason: "stop" }] });
  try {
    const stages = stagesFor(raw);
    return await prepareMarketingFacts({ scope: { tenantId: "t", workspaceId: "w", projectId: "P1", runId: "R1", attempt: 1 }, root,
      intent: "仅以本次已审事实制作宣传片", metadata: { dataMining: productQuery },
      env: { LLM_BASE_URL: "https://judge.example.test", LLM_API_KEY: "fixture-only", LLM_MODEL: "fixture-judge" },
      llm: { reason: async prompt => {
        const stage = /当前阶段：(A[123])\n/.exec(prompt)?.[1], facts = stages.find(item => item.stage === stage)!;
        return { success: true, data: { payload: facts.payload,
          citations: facts.claims.map(({ pointer, sourceId, quote }) => ({ pointer, sourceId, quote })),
          ...(facts.noEvidenceReason ? { noEvidenceReason: facts.noEvidenceReason } : {}) } };
      } }, dependencies: { search: async () => [{ title: "source", url: sourceUrl, snippet: "untrusted query text" }],
        fetchSource: async () => ({ snapshot: structuredClone(source), rawBytes: Buffer.from(sourceText) }) } });
  } finally { globalThis.fetch = originalFetch; }
}
for (const key of ["model", "brand", "category"] as const) {
  test(`host G1 never promotes discovery-only ${key} into any native fact/card`, async () => temporary(async root => {
    const prepared = await host(root), identity: any = prepared.bundle.dossier.identity;
    assert.equal(identity[key], "", `${key} has no source-bound claim and must remain absent`);
    assert.ok(!JSON.stringify(prepared.bundle.cards).includes(query[key]));
    assert.equal(prepared.bundle.productQuery[key], query[key]);
  }));
}
test("host native specs keep actual source provenance without contradictory no-source gaps", async () => temporary(async root => {
  const prepared = await host(root), dossier: any = prepared.bundle.dossier;
  assert.deepEqual(dossier.identity.specs, rawFixture().A1.identity.specs);
  assert.ok(!dossier.gaps.some((item: string) => /规格 .*无来源/.test(item)));
  for (const key of ["Wi-Fi", "蓝牙"]) assert.ok(dossier.provenance.some((item: any) => item.claim_ref === `identity.specs.${key}` && item.source_url === sourceUrl));
  assert.deepEqual(prepared.raw, rawFixture());
  assert.equal(prepared.bundle.rawSha256, renderSha256(canonicalRenderJson(rawFixture())));
  assert.equal(prepared.bundle.stages[0]!.facts.claims.length, 3);
}));
test("native assembly preserves five stations, chain, empty A2/A3, source restrictions and unchanged vendor prototypes", async () => temporary(async root => {
  const original = JennyLoomEngine.prototype.assemble, a1 = new JennyLoomEngine({ storeRoot: root }).a1.constructor.prototype.distill;
  const raw = rawFixture(), bytes = canonicalRenderJson(raw), proof = compile(raw);
  const native = new JennyLoomEngine({ mode: "api", storeRoot: root });
  const result = native.assemble(native.plan(proof.factInput).trace_id, proof.factInput, proof.rawByAgent);
  assert.equal(result.ok, true); assert.equal(result.chain.ok, true);
  assert.deepEqual(result.envelopes.map((item: any) => item.stage), ["A1_COLLECT", "A2_MINE", "A3_SCOUT", "A4_VERIFY", "A5_BIND"]);
  assert.equal(result.envelopes[0].prev_checksum, null);
  for (let i = 1; i < result.envelopes.length; i++) assert.equal(result.envelopes[i].prev_checksum, result.envelopes[i - 1].checksum);
  assert.deepEqual(result.dossier.competitors, []); assert.deepEqual(result.dossier.pros_cons, { pros: [], cons: [] });
  assert.deepEqual(result.dossier.voice_of_customer, { praise_points: [], pain_points: [], verbatim: [] });
  assert.deepEqual(proof.restrictions, restrictions); assert.equal(canonicalRenderJson(raw), bytes);
  assert.equal(JennyLoomEngine.prototype.assemble, original); assert.equal(native.a1.constructor.prototype.distill, a1);
}));
test("supported identity, escaped specs, zero/boolean values, prices and selling points map only to actual cited URLs", async () => temporary(async root => {
  const raw: any = rawFixture(); Object.assign(raw.A1.identity, { brand: "源品牌", category: "源类别", model: "源型号" });
  raw.A1.identity.specs = { "a/b~c": 0, supported: true, source: "不支持" };
  raw.A1.identity.prices = [{ amount: 399, currency: "CNY", source_url: sourceUrl }];
  raw.A1.identity.official_selling_points = [{ point: "便携", source_url: sourceUrl, channel: "owner-confirmed官方" }];
  const proof = compile(raw);
  assert.deepEqual(proof.factInput, { name: "本次商品", brand: "源品牌", category: "源类别", model: "源型号" });
  assert.equal(proof.rawByAgent.A1.identity.specs["a/b~c"].value, 0);
  assert.equal(proof.rawByAgent.A1.identity.specs["a/b~c"].source_url, sourceUrl);
  assert.ok(proof.mappings.some((entry: any) => entry.pointer === "/identity/specs/a~1b~0c" && entry.sourceId === source.sourceId));
  assert.equal(proof.rawByAgent.A1.identity.official_selling_points[0].channel, "source.example.test");
  const native = new JennyLoomEngine({ mode: "api", storeRoot: root });
  const result = native.assemble(native.plan(proof.factInput).trace_id, proof.factInput, proof.rawByAgent);
  assert.equal(result.ok, true); assert.deepEqual(result.dossier.identity.specs, raw.A1.identity.specs);
}));
test("candidate images keep unverified mapping/license statement, unknown angle and actual source; unsupported metadata is rejected", async () => {
  const raw: any = rawFixture(); raw.A1.images = [{ url: source.assetUrls[0], page_url: sourceUrl, source: "owner-confirmed官方", angle: "unknown" }];
  const proof = compile(raw);
  assert.equal(proof.rawByAgent.A1.images[0].source, "source.example.test");
  assert.equal(proof.rawByAgent.A1.images[0].angle, "unknown");
  assert.match(proof.handoffNote, /图片.*映射.*未核实/); assert.match(proof.handoffNote, /授权.*未核实/);
  for (const property of ["width", "height", "title", "license_risk", "verified", "model"]) {
    const forged = structuredClone(raw); forged.A1.images[0][property] = property === "width" || property === "height" ? 100 : "owner-confirmed";
    assert.throws(() => compile(forged), /MARKETING_(?:PAYLOAD|NATIVE_DOSSIER)_INVALID/);
  }
});
test("missing, duplicate, mismatched, foreign and invalid claims cannot be wrapped as sourced native facts", () => {
  const raw = rawFixture(), stages: any = stagesFor(raw);
  for (const kind of ["missing", "duplicate", "value", "foreign", "hash", "status", "offset"]) {
    const changed = structuredClone(stages);
    if (kind === "missing") changed[0].claims.pop();
    if (kind === "duplicate") changed[0].claims.push(changed[0].claims[0]);
    if (kind === "value") changed[0].claims[0].value = "注入商品";
    if (kind === "foreign") changed[0].claims[0].sourceId = "SRC-other";
    if (kind === "hash") changed[0].claims[0].textSha256 = "0".repeat(64);
    if (kind === "status") changed[0].claims[0].status = "owner-confirmed";
    if (kind === "offset") changed[0].claims[0].quoteStart = -1;
    assert.ok(adapter); assert.throws(() => adapter.createNativeMarketingDossier({ rawJson: canonicalRenderJson(raw), productQuery: query,
      stages: changed, sources: [source], restrictions }), /MARKETING_NATIVE_DOSSIER_INVALID/);
  }
});
test("malformed stage/source records, empty evidence, unbound URLs and deleted policy limits fail closed", () => {
  assert.ok(adapter);
  const raw = rawFixture(), stages: any = stagesFor(raw);
  for (const kind of ["null-stage", "extra-stage", "empty-reason", "null-claim", "null-source", "source-id", "policy", "policy-field", "url", "duplicate-source", "missing-spec"]) {
    const input: any = { rawJson: canonicalRenderJson(raw), productQuery: query, restrictions, stages: structuredClone(stages), sources: [structuredClone(source)] };
    if (kind === "null-stage") input.stages[1] = null;
    if (kind === "extra-stage") input.stages.push(input.stages[0]);
    if (kind === "empty-reason") input.stages[1].noEvidenceReason = false;
    if (kind === "null-claim") input.stages[0].claims[0] = null;
    if (kind === "null-source") input.sources[0] = null;
    if (kind === "source-id") input.sources[0].sourceId = {};
    if (kind === "policy") input.sources[0].policy = { restrictions: [false], blockedFields: [] };
    if (kind === "policy-field") input.sources[0].policy = { restrictions: [], blockedFields: [null] };
    if (kind === "url") input.sources[0].finalUrl = "javascript:untrusted";
    if (kind === "duplicate-source") input.sources.push(input.sources[0]);
    if (kind === "missing-spec") { const changed: any = rawFixture(); changed.A1.identity.specs = {}; input.rawJson = canonicalRenderJson(changed); input.stages[0].payload = changed.A1; }
    assert.throws(() => adapter.createNativeMarketingDossier(input), /MARKETING_NATIVE_DOSSIER_INVALID/, kind);
  }
  const archived: any = structuredClone(source);
  archived.requestedUrl = archived.finalUrl = "workloom-archive://products/test/profile.json";
  archived.policy = { restrictions: ["机器映射与授权未核实"], blockedFields: [{ pointer: "/model", reason: "型号冲突" }] };
  const bound: any = structuredClone(stages);
  for (const claim of bound[0].claims) {
    claim.sourcePointer = claim.pointer === "/identity/name" ? "/displayName" : "/specs/features/0";
    claim.claimId = `CL-${renderSha256(canonicalRenderJson({ stage: claim.stage, pointer: claim.pointer, value: claim.value,
      sourceId: claim.sourceId, quote: claim.quote, sourcePointer: claim.sourcePointer })).slice(0, 24)}`;
  }
  const limits = [...restrictions, ...archived.policy.restrictions];
  assert.doesNotThrow(() => adapter.createNativeMarketingDossier({ rawJson: canonicalRenderJson(raw), productQuery: query, stages: bound, sources: [archived], restrictions: limits }));
  assert.throws(() => adapter.createNativeMarketingDossier({ rawJson: canonicalRenderJson(raw), productQuery: query, stages: bound, sources: [archived], restrictions }), /原始来源用途限制被删除/);
  const blocked = structuredClone(bound), claim = blocked[0].claims[0]; claim.sourcePointer = "/model";
  claim.claimId = `CL-${renderSha256(canonicalRenderJson({ stage: claim.stage, pointer: claim.pointer, value: claim.value,
    sourceId: claim.sourceId, quote: claim.quote, sourcePointer: claim.sourcePointer })).slice(0, 24)}`;
  assert.throws(() => adapter.createNativeMarketingDossier({ rawJson: canonicalRenderJson(raw), productQuery: query, stages: blocked, sources: [archived], restrictions: limits }), /来源字段已禁止/);
});
test("native price and visual source URLs must belong to the specific cited competitor attribute", () => {
  assert.ok(adapter);
  const raw: any = rawFixture(), other = { ...source, sourceId: "SRC-other", requestedUrl: "https://other.example.test/device", finalUrl: "https://other.example.test/device" };
  raw.A3.competitors = [{ name: "对手", price_band: "399", price_source_url: other.finalUrl,
    selling_points: [{ point: "便携", source_url: sourceUrl }], visual_style: "正面", visual_source_url: sourceUrl }];
  const stage = validateStageFacts("A3", { payload: raw.A3, citations: ["/competitors/0/name", "/competitors/0/price_band", "/competitors/0/selling_points/0/point", "/competitors/0/visual_style"]
    .map(pointer => ({ pointer, sourceId: source.sourceId, quote: sourceText })) }, [source, other]);
  const stages: any = stagesFor(rawFixture()); stages[2] = stage;
  assert.throws(() => adapter.createNativeMarketingDossier({ rawJson: canonicalRenderJson(raw), productQuery: query, stages, sources: [source, other], restrictions }), /属性来源URL与其主张来源不同/);
  raw.A3.competitors[0].price_source_url = sourceUrl; raw.A3.competitors[0].visual_source_url = other.finalUrl; stage.payload = raw.A3;
  assert.throws(() => adapter.createNativeMarketingDossier({ rawJson: canonicalRenderJson(raw), productQuery: query, stages, sources: [source, other], restrictions }), /属性来源URL与其主张来源不同/);
  delete raw.A3.competitors[0].price_source_url; delete raw.A3.competitors[0].visual_source_url;
  const original = canonicalRenderJson(raw);
  const proof = adapter.createNativeMarketingDossier({ rawJson: original, productQuery: query, stages, sources: [source, other], restrictions });
  assert.equal((proof.rawByAgent.A3.competitors as any[])[0].price_source_url, sourceUrl);
  assert.equal((proof.rawByAgent.A3.competitors as any[])[0].visual_source_url, sourceUrl);
  assert.equal(canonicalRenderJson(raw), original);
});
test("adapter proof rejects altered raw, query, native values, source URLs, mappings and restrictions even when outer SHA is recomputed", () => {
  const proof = compile(); assert.ok(adapter);
  for (const kind of ["raw", "query", "native", "url", "mapping", "restriction", "proof-hash"]) {
    const changed = structuredClone(proof), input: any = { rawJson: canonicalRenderJson(rawFixture()), productQuery: query, restrictions, proof: changed };
    if (kind === "raw") input.rawJson = canonicalRenderJson({ ...rawFixture(), A1: { identity: { name: "其他商品" } } });
    if (kind === "query") input.productQuery = { ...query, model: "新查询型号" };
    if (kind === "native") changed.factInput.model = "回填型号";
    if (kind === "url") changed.rawByAgent.A1.identity.specs["Wi-Fi"].source_url = "https://fake.test/";
    if (kind === "mapping") changed.mappings[0].sourceId = "SRC-other";
    if (kind === "restriction") input.restrictions = ["授权已经核实"];
    if (kind !== "proof-hash") { const { sha256: _sha, ...body } = changed; changed.sha256 = renderSha256(canonicalRenderJson(body)); }
    else changed.sha256 = "0".repeat(64);
    assert.throws(() => adapter.verifyNativeMarketingDossier(input), /MARKETING_NATIVE_DOSSIER_INVALID/);
  }
});
test("host proof and handoff restrictions remain bound through final fact qualification", async () => temporary(async root => {
  const prepared = await host(root), originalFetch = globalThis.fetch;
  const shots = [{ shotId: "S1", prompt: "介绍本次商品的 Wi-Fi 支持 2.4G/5G", fields: { 规格: "支持 2.4G/5G" } }];
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ approved: true,
    score: 96, issues: [], suggestions: [], reason: "fixture final judge" }) }, finish_reason: "stop" }] });
  try {
    assert.ok((prepared.bundle as any).nativeDossier);
    assert.match(prepared.bundle.restrictions.join("\n"), /图片.*映射.*未核实/);
    assert.match(prepared.bundle.restrictions.join("\n"), /handoff_note/);
    const saved = await finalizeMarketingFacts(prepared, shots, { LLM_BASE_URL: "https://judge.example.test", LLM_API_KEY: "fixture-only", LLM_MODEL: "fixture-judge" });
    const checked = await verifyMarketingFacts({ root, ...saved, scope: prepared.bundle.scope, shots });
    assert.deepEqual((checked as any).nativeDossier, (prepared.bundle as any).nativeDossier);
  } finally { globalThis.fetch = originalFetch; }
}));
test("actual VideoStudio entry reassembles the same source-bound facts without any query fallback or prototype mutation", async () => temporary(async root => {
  const proof = compile(), rawJson = canonicalRenderJson(rawFixture()), sha256 = renderSha256(rawJson);
  const originalCreate = HyperrealitySystem.prototype.create, originalAssemble = JennyLoomEngine.prototype.assemble;
  let observed: any;
  // Replace only the native production boundary. VideoStudio itself and CJS Jenny are real.
  HyperrealitySystem.prototype.create = async function (_intent: string, metadata: any, options: any) {
    const native = new JennyLoomEngine({ mode: "api", storeRoot: root });
    observed = { metadata, options, result: native.assemble(native.plan(metadata.dataMining).trace_id, metadata.dataMining, options.dataMiningRaw) };
    return { success: true, stages: { dataMining: { data: observed.result } } };
  };
  try {
    const studio = new VideoStudio({ llm: new WorkloomLLMEngine({ baseUrl: "https://unreachable.example.test", apiKey: "fixture", model: "fixture" }),
      workDir: root, onApproval: async () => ({ approved: false }), log: () => undefined,
      dataMining: { raw: { A1: { identity: { model: "旧伪事实" } } }, verifiedRaw: { projectId: "P1", rawJson, sha256, productQuery: query,
        restrictions, restrictionsSha256: sourceRestrictionsHash(sha256, restrictions), nativeDossier: proof } as any } });
    await studio.runPreproduction({ projectId: "P1", isMarketing: true, intent: "原生营销", metadata: { dataMining: query, _dataDossier: { fake: true } } });
    assert.deepEqual(observed.metadata.dataMining, { name: "本次商品" });
    assert.deepEqual(observed.options.dataMiningRaw, proof.rawByAgent);
    assert.equal(observed.result.dossier.identity.model, "");
    assert.ok(!observed.result.dossier.gaps.some((item: string) => /规格 .*无来源/.test(item)));
    assert.equal(observed.result.chain.ok, true);
    assert.equal(HyperrealitySystem.prototype.create === originalCreate, false); // Only our fixture patch remains installed.
    assert.equal(JennyLoomEngine.prototype.assemble, originalAssemble);
  } finally { HyperrealitySystem.prototype.create = originalCreate; }
}));
test("actual studio rejects missing or altered native adapter proof before production boundary", async () => temporary(async root => {
  const proof = compile(), rawJson = canonicalRenderJson(rawFixture()), sha256 = renderSha256(rawJson);
  const originalCreate = HyperrealitySystem.prototype.create; let calls = 0;
  HyperrealitySystem.prototype.create = async () => { calls++; return { success: true, stages: {} }; };
  try {
    for (const kind of ["missing", "model", "spec-source", "query", "raw", "restrictions"]) {
      const copy = structuredClone(proof), verified: any = { projectId: "P1", rawJson, sha256, productQuery: query,
        restrictions, restrictionsSha256: sourceRestrictionsHash(sha256, restrictions), nativeDossier: copy };
      if (kind === "missing") delete verified.nativeDossier;
      if (kind === "model") copy.factInput.model = query.model;
      if (kind === "spec-source") copy.rawByAgent.A1.identity.specs["Wi-Fi"].source_url = "https://forged.test/";
      if (kind === "query") verified.productQuery = { ...query, model: "changed" };
      if (kind === "raw") { verified.rawJson = canonicalRenderJson({ ...rawFixture(), A2: { reviews: [{ text: "假口碑" }] } }); verified.sha256 = renderSha256(verified.rawJson); verified.restrictionsSha256 = sourceRestrictionsHash(verified.sha256, restrictions); }
      if (kind === "restrictions") { verified.restrictions = ["可随意发布"]; verified.restrictionsSha256 = sourceRestrictionsHash(sha256, verified.restrictions); }
      const studio = new VideoStudio({ llm: new WorkloomLLMEngine({ baseUrl: "https://unreachable.example.test", apiKey: "fixture", model: "fixture" }),
        workDir: root, onApproval: async () => ({ approved: false }), log: () => undefined, dataMining: { verifiedRaw: verified } });
      await assert.rejects(() => studio.runPreproduction({ projectId: "P1", isMarketing: true, intent: "营销" }), /MARKETING_NATIVE_DOSSIER_INVALID/);
    }
    assert.equal(calls, 0);
  } finally { HyperrealitySystem.prototype.create = originalCreate; }
}));
