/** Adapt already reviewed claims to Jenny's supported input contract; discovery never supplies facts. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { sourceRestrictionsHash } from "./source-restrictions.js";

type RecordValue = Record<string, unknown>;
export type MarketingIntelStage = "A1" | "A2" | "A3";
const text = z.string().trim().min(1).max(8000);
const url = z.string().url().max(8192);
const factValue = z.union([text, z.number().finite(), z.boolean()]);
const point = z.object({ point: text, source_url: url, channel: z.string().max(200).optional() }).strict();
const a1 = z.object({ identity: z.object({ name: text, brand: text.optional(), category: text.optional(), model: text.optional(),
  specs: z.record(z.string().min(1).max(100), factValue).default({}),
  prices: z.array(z.object({ amount: z.number().finite().nonnegative(), currency: z.string().min(1).max(10), note: text.optional(), source_url: url }).strict()).max(30).default([]),
  official_selling_points: z.array(point).max(30).default([]),
}).strict(), images: z.array(z.object({ url, page_url: url, source: z.string().max(200).optional(), angle: text.optional() }).strict()).max(20).default([]),
  inferred_notes: z.array(z.unknown()).max(0).optional(),
}).strict();
const a2 = z.object({ reviews: z.array(z.object({ text, source: z.string().max(200).optional(), url,
  rating: z.number().min(1).max(5).optional(), suspect: z.boolean().optional(),
}).strict()).max(30) }).strict();
const a3 = z.object({ competitors: z.array(z.object({ name: text, price_band: text.optional(), price_source_url: url.optional(),
  selling_points: z.array(point).min(1).max(15), visual_style: text.optional(), visual_source_url: url.optional(),
  viral_patterns: z.array(z.object({ pattern: text, sample_count: z.number().int().positive(), source_url: url }).strict()).max(10).optional(),
  weakness_notes: text.optional(),
}).strict()).max(3), adjacent_notes: z.array(z.unknown()).max(0).optional() }).strict();
/** One schema for the source extractor, host replay and the actual native studio consumer. */
export function marketingStagePayloadSchema(stage: MarketingIntelStage) { return stage === "A1" ? a1 : stage === "A2" ? a2 : a3; }
export function marketingStagePayloadShape(stage: MarketingIntelStage, raw: unknown): RecordValue {
  try { return marketingStagePayloadSchema(stage).parse(raw) as RecordValue; }
  catch (error) { throw new Error(`MARKETING_PAYLOAD_INVALID：${stage} ${error instanceof Error ? error.message : String(error)}`); }
}

export interface NativeMarketingClaim {
  claimId: string; stage: MarketingIntelStage; pointer: string; value: string | number | boolean;
  sourceId: string; textSha256: string; quote: string; quoteStart: number; quoteEnd: number;
  sourcePointer?: string; status: "source-bound";
}
interface StageEvidence {
  stage: MarketingIntelStage; status: "source_bound" | "no_evidence"; claims: NativeMarketingClaim[]; noEvidenceReason?: string;
}
export interface NativeMarketingSource {
  sourceId: string; requestedUrl: string; finalUrl: string; rawSha256: string; textSha256: string; assetUrls: string[];
  policy?: { restrictions: string[]; blockedFields: Array<{ pointer: string; reason: string }> };
}
interface Mapping {
  stage: MarketingIntelStage; pointer: string; claimId: string; sourceId: string; textSha256: string;
  sourceUrl: string; nativePointer: string; sourcePointer?: string;
}
export interface NativeMarketingDossier {
  schemaVersion: "workloom.native-marketing-dossier/v1";
  rawSha256: string; productQuerySha256: string; stagesSha256: string; sourcesSha256: string;
  restrictionsSha256: string; mappingsSha256: string; nativeRawSha256: string;
  factInput: RecordValue; rawByAgent: Record<MarketingIntelStage, RecordValue>;
  stages: StageEvidence[]; sources: NativeMarketingSource[]; mappings: Mapping[]; restrictions: string[];
  handoffNote: string; sha256: string;
}
export const NATIVE_MARKETING_HANDOFF_NOTE = "原生 portrait_manifest.handoff_note 仅表达尚未完成的核查任务，不是核实回执：图片真实性、图片与商品/型号映射仍未核实，素材授权仍未核实；不能以 owner-confirmed、候选来源URL或渠道标签升级为已核实。型号无 source-bound 主张时不得声称型号一致；规格只能按引用的原文陈述，不能扩展为性能承诺、使用效果或用户共识。完整来源用途限制及最终客户验收提示必须保留。";
const object = (value: unknown): value is RecordValue => Boolean(value && typeof value === "object" && !Array.isArray(value));
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (object(item)) return Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, visit(item[key])]));
    return item;
  };
  return JSON.stringify(visit(value));
}
const hash = (value: unknown) => digest(canonical(value));
const escapePointer = (value: string) => value.replace(/~/g, "~0").replace(/\//g, "~1");
const sourceFields = new Set(["url", "source_url", "page_url", "price_source_url", "visual_source_url", "source", "channel", "suspect"]);
function fail(message: string): never { throw new Error(`MARKETING_NATIVE_DOSSIER_INVALID：${message}`); }
function leaves(value: unknown, pointer = "", output = new Map<string, string | number | boolean>()) {
  if (Array.isArray(value)) value.forEach((entry, i) => leaves(entry, `${pointer}/${i}`, output));
  else if (object(value)) for (const [key, entry] of Object.entries(value)) {
    if ((!sourceFields.has(key) || pointer === "/identity/specs") && !(key === "angle" && entry === "unknown")) leaves(entry, `${pointer}/${escapePointer(key)}`, output);
  }
  else if (["string", "number", "boolean"].includes(typeof value)) output.set(pointer, value as string | number | boolean);
  return output;
}
function sourceProjection(source: NativeMarketingSource): NativeMarketingSource {
  if (!object(source) || typeof source.sourceId !== "string" || !source.sourceId.trim() || source.sourceId.length > 100
    || typeof source.requestedUrl !== "string" || typeof source.finalUrl !== "string"
    || !/^[a-f0-9]{64}$/.test(source.rawSha256) || !/^[a-f0-9]{64}$/.test(source.textSha256)
    || !Array.isArray(source.assetUrls) || !source.assetUrls.every(item => typeof item === "string")) fail("来源身份或原文字节摘要无效");
  for (const address of [source.requestedUrl, source.finalUrl, ...source.assetUrls]) {
    try { const parsed = new URL(address); if (!["https:", "http:", "workloom-archive:"].includes(parsed.protocol)) fail("来源协议不是已支持来源"); }
    catch (error) { fail(error instanceof Error ? error.message : "来源URL无效"); }
  }
  if (source.policy !== undefined && (!object(source.policy) || !Array.isArray(source.policy.restrictions)
    || !source.policy.restrictions.every(item => typeof item === "string" && item.trim())
    || !Array.isArray(source.policy.blockedFields) || !source.policy.blockedFields.every(field => object(field)
      && typeof field.pointer === "string" && field.pointer.startsWith("/") && typeof field.reason === "string" && field.reason.trim()))) fail("来源用途策略结构无效");
  if (source.finalUrl.startsWith("workloom-archive:") && !source.policy) fail("受控商品来源缺完整用途策略");
  return structuredClone({ sourceId: source.sourceId, requestedUrl: source.requestedUrl, finalUrl: source.finalUrl,
    rawSha256: source.rawSha256, textSha256: source.textSha256, assetUrls: source.assetUrls, ...(source.policy ? { policy: source.policy } : {}) });
}

export function createNativeMarketingDossier(input: {
  rawJson: string; productQuery: RecordValue;
  stages: Array<StageEvidence & { payload: RecordValue }>; sources: NativeMarketingSource[]; restrictions: string[];
}): NativeMarketingDossier {
  if (typeof input.rawJson !== "string" || input.rawJson.length > 200_000) fail("原始事实字节缺失或超限");
  let parsed: unknown;
  try { parsed = JSON.parse(input.rawJson); } catch { fail("原始事实不是JSON"); }
  if (!object(parsed) || Object.keys(parsed).sort().join(",") !== "A1,A2,A3") fail("原始事实必须完整覆盖且仅覆盖三站");
  if (!object(input.productQuery) || typeof input.productQuery.name !== "string" || !input.productQuery.name.trim()
    || Object.entries(input.productQuery).some(([key, value]) => !["name", "brand", "category", "model"].includes(key) || typeof value !== "string" || !value.trim())) fail("查询线索身份无效");
  if (!Array.isArray(input.stages) || input.stages.length !== 3 || !input.stages.every(object) || !Array.isArray(input.sources)) fail("主张或来源记录缺失");
  const rawSha256 = digest(input.rawJson), restrictionsSha256 = sourceRestrictionsHash(rawSha256, input.restrictions);
  const sources = input.sources.map(sourceProjection), bySource = new Map(sources.map(source => [source.sourceId, source]));
  if (bySource.size !== sources.length) fail("来源ID重复");
  for (const source of sources) for (const restriction of source.policy?.restrictions ?? []) {
    if (!input.restrictions.includes(restriction)) fail("原始来源用途限制被删除");
  }
  const rawByAgent = {} as Record<MarketingIntelStage, RecordValue>, stages: StageEvidence[] = [], mappings: Mapping[] = [];
  const factInput: RecordValue = {};
  for (const stage of ["A1", "A2", "A3"] as const) {
    const records = input.stages.filter(record => record.stage === stage), record = records[0];
    if (records.length !== 1 || !record || !Array.isArray(record.claims) || record.claims.length > 200
      || record.noEvidenceReason !== undefined && (typeof record.noEvidenceReason !== "string" || !record.noEvidenceReason.trim())) fail(`${stage}主张记录不是唯一的已审阶段`);
    const raw = marketingStagePayloadShape(stage, parsed[stage]);
    if (canonical(raw) !== canonical(parsed[stage]) || canonical(raw) !== canonical(record.payload)) fail(`${stage}原始回填与已审主张不一致`);
    const values = leaves(raw), claims = new Map<string, NativeMarketingClaim>();
    for (const claim of record.claims) {
      if (!object(claim)) fail(`${stage}主张不是有效记录`);
      const source = bySource.get(claim.sourceId);
      if (!source || claim.stage !== stage || claim.status !== "source-bound" || claim.textSha256 !== source.textSha256
        || !values.has(claim.pointer) || values.get(claim.pointer) !== claim.value || claims.has(claim.pointer)
        || typeof claim.quote !== "string" || !claim.quote || claim.quote.length > 6000 || !Number.isInteger(claim.quoteStart) || claim.quoteStart < 0
        || claim.quoteEnd !== claim.quoteStart + claim.quote.length) fail(`${stage}主张值、来源、位置或状态无效`);
      if (source.finalUrl.startsWith("workloom-archive:") ? typeof claim.sourcePointer !== "string" || !claim.sourcePointer.startsWith("/")
        : claim.sourcePointer !== undefined) fail(`${stage}主张的来源字段引用与来源类型不符`);
      const expectedId = `CL-${hash({ stage, pointer: claim.pointer, value: claim.value, sourceId: source.sourceId, quote: claim.quote,
        ...(claim.sourcePointer ? { sourcePointer: claim.sourcePointer } : {}) }).slice(0, 24)}`;
      if (claim.claimId !== expectedId || source.policy?.blockedFields.some(field => field.pointer === claim.sourcePointer)) fail(`${stage}主张身份不符或来源字段已禁止`);
      claims.set(claim.pointer, claim);
      mappings.push({ stage, pointer: claim.pointer, claimId: claim.claimId, sourceId: source.sourceId, textSha256: source.textSha256,
        sourceUrl: source.finalUrl, nativePointer: stage === "A1" && claim.pointer.startsWith("/identity/specs/") ? `${claim.pointer}/value` : claim.pointer,
        ...(claim.sourcePointer ? { sourcePointer: claim.sourcePointer } : {}) });
    }
    if (claims.size !== values.size || record.status !== (claims.size ? "source_bound" : "no_evidence")
      || !claims.size && (stage === "A1" || !record.noEvidenceReason?.trim())) fail(`${stage}存在无证据事实或空站未声明`);
    const native = structuredClone(raw);
    // Bind every supplied URL to the actual source; channel labels carry no owner/official authority.
    const normalizeUrls = (value: unknown, pointer = ""): void => {
      if (Array.isArray(value)) { value.forEach((entry, i) => normalizeUrls(entry, `${pointer}/${i}`)); return; }
      if (!object(value)) return;
      if (pointer === "/identity/specs") return; // A spec named source/url remains a factual key.
      const address = value.page_url ?? value.source_url ?? value.url;
      if (address !== undefined) {
        const source = sources.find(item => item.requestedUrl === address || item.finalUrl === address);
        if (!source || typeof value.page_url === "string" && !source.assetUrls.includes(String(value.url))) fail(`${stage}来源URL或候选图片未绑定`);
        if ("source" in value) value.source = new URL(source.finalUrl).hostname;
        if ("channel" in value) value.channel = new URL(source.finalUrl).hostname;
        for (const [claimPointer, claim] of claims) {
          if (claimPointer.startsWith(`${pointer}/`) && !claimPointer.slice(pointer.length + 1).includes("/") && claim.sourceId !== source.sourceId) fail(`${stage}字段来源URL与其主张来源不同`);
        }
      }
      for (const [key, entry] of Object.entries(value)) {
        if ((key === "url" || key.endsWith("_url")) && typeof entry === "string" && key !== "url" && key !== "page_url") {
          const source = sources.find(item => item.requestedUrl === entry || item.finalUrl === entry);
          if (!source) fail(`${stage}字段URL不是实际来源`);
          const linked = key === "price_source_url" ? "price_band" : key === "visual_source_url" ? "visual_style" : undefined;
          if (linked && claims.get(`${pointer}/${linked}`)?.sourceId !== source.sourceId) fail(`${stage}属性来源URL与其主张来源不同`);
        }
        normalizeUrls(entry, `${pointer}/${escapePointer(key)}`);
      }
    };
    normalizeUrls(native);
    if (stage === "A1") {
      const identity = native.identity as RecordValue, specs = identity.specs as RecordValue;
      if (!Object.keys(specs).length && !(identity.official_selling_points as unknown[]).length) fail("A1缺少有证据规格或卖点");
      for (const key of ["name", "brand", "category", "model"]) if (claims.has(`/identity/${key}`)) factInput[key] = identity[key];
      for (const [key, value] of Object.entries(specs)) {
        const claim = claims.get(`/identity/specs/${escapePointer(key)}`)!, source = bySource.get(claim.sourceId)!;
        Object.defineProperty(specs, key, { value: { value, source_url: source.finalUrl, channel: new URL(source.finalUrl).hostname }, enumerable: true, writable: true, configurable: true });
      }
    }
    if (stage === "A3") for (const [index, competitor] of (native.competitors as RecordValue[]).entries()) {
      for (const [field, sourceField] of [["price_band", "price_source_url"], ["visual_style", "visual_source_url"]] as const) {
        const claim = claims.get(`/competitors/${index}/${field}`);
        if (claim) competitor[sourceField] = bySource.get(claim.sourceId)!.finalUrl;
      }
    }
    rawByAgent[stage] = native;
    stages.push(structuredClone({ stage, status: record.status, claims: record.claims, ...(record.noEvidenceReason ? { noEvidenceReason: record.noEvidenceReason } : {}) }));
  }
  if (!factInput.name) fail("没有已审商品名，禁止查询兜底");
  const body = { schemaVersion: "workloom.native-marketing-dossier/v1" as const, rawSha256, productQuerySha256: hash(input.productQuery),
    stagesSha256: hash(stages), sourcesSha256: hash(sources), restrictionsSha256, mappingsSha256: hash(mappings), nativeRawSha256: hash(rawByAgent),
    factInput, rawByAgent, stages, sources, mappings, restrictions: structuredClone(input.restrictions), handoffNote: NATIVE_MARKETING_HANDOFF_NOTE };
  return { ...body, sha256: hash(body) };
}

/** The trusted host passes this proof separately from customer metadata. Rebuild it before native consumption. */
export function verifyNativeMarketingDossier(input: {
  rawJson: string; productQuery: RecordValue; restrictions: string[]; proof: NativeMarketingDossier | undefined;
}): NativeMarketingDossier {
  const proof = input.proof;
  if (!proof || proof.schemaVersion !== "workloom.native-marketing-dossier/v1" || !Array.isArray(proof.stages) || !Array.isArray(proof.sources)) fail("缺本次来源绑定适配契约，须重新原生预生产");
  let parsed: RecordValue;
  try { parsed = JSON.parse(input.rawJson) as RecordValue; } catch { fail("原始事实不是JSON"); }
  let expected: NativeMarketingDossier;
  try { expected = createNativeMarketingDossier({ rawJson: input.rawJson, productQuery: input.productQuery, restrictions: input.restrictions,
    sources: proof.sources, stages: proof.stages.map(stage => ({ ...stage, payload: parsed?.[stage.stage] as RecordValue })) }); }
  catch (error) { fail(error instanceof Error ? error.message : "适配契约无法复读"); }
  if (canonical(expected) !== canonical(proof)) fail("原始事实、查询、来源、用途限制或原生映射已变化");
  return expected;
}
