/** 原生事实提取：完整来源、严格结构、一次结构校正；证据或服务失败不可重试成通过。 */
import { extractionSchema, stageExtractionJsonSchema, validateStageFacts, type ValidatedStageFacts } from "./marketing-facts.js";
import type { ExecutorLlm, IntelStage } from "./data-mining-executor.js";
import type { SourceSnapshot } from "./marketing-source-fetcher.js";
import { canonicalRenderJson, renderSha256 } from "./gen/compiled-request.js";

type ExtractionResponse = Awaited<ReturnType<ExecutorLlm["reason"]>>;
const options = { forceJson: true, temperature: 0, maxTokens: 8192 } as const;
export interface MarketingExtractionAttempt {
  schemaVersion: "workloom.marketing-extraction-attempt/v1";
  stage: IntelStage; attempt: number;
  request: { prompt: string; options: typeof options }; requestSha256: string;
  response: ExtractionResponse;
  validation: { ok: boolean; error?: string };
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** 重放原响应；结构错误统一编码，引用/来源/事实错误保持原来的拒绝原因。 */
export function validateMarketingExtractionResponse(stage: IntelStage, response: ExtractionResponse, sources: SourceSnapshot[]): ValidatedStageFacts {
  if (!response?.success) throw new Error(`MARKETING_EXTRACTION_UNVERIFIED：事实提取失败 ${response?.error ?? "空回包"}`);
  let raw: unknown;
  try { raw = response.data ?? JSON.parse(response.content ?? ""); }
  catch (error) { throw new Error(`MARKETING_PAYLOAD_INVALID：事实提取不是JSON ${message(error)}`); }
  const parsed = extractionSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`MARKETING_PAYLOAD_INVALID：${stage} ${parsed.error.message}`);
  return validateStageFacts(stage, parsed.data, sources);
}

export async function extractMarketingStageFacts(input: {
  stage: IntelStage; prompt: string; sources: SourceSnapshot[]; llm: ExecutorLlm;
  persistAttempt: (record: MarketingExtractionAttempt) => Promise<void>;
}): Promise<ValidatedStageFacts> {
  const contract = `本阶段完整JSON Schema（禁止新增字段；原文证据规则仍全部适用）：\n${canonicalRenderJson(stageExtractionJsonSchema(input.stage))}\n`;
  let correction = "";
  for (const attempt of [1, 2]) {
    // 反馈在前，完整原来源保持原字节；不裁剪、不把上次模型回答升格为来源。
    const prompt = `${correction}${contract}${input.prompt}`;
    if (prompt.length > 90_000) throw new Error("MARKETING_REVIEW_TOO_LARGE：完整来源超单次提取预算，禁止裁剪来源");
    const request = { prompt, options };
    let response: ExtractionResponse;
    try { response = await input.llm.reason(prompt, options); }
    catch (error) { response = { success: false, error: message(error) }; }
    // 留住模型原包；校验器归一化后的事实另存，不能覆盖原包冒充模型输出。
    const record: MarketingExtractionAttempt = { schemaVersion: "workloom.marketing-extraction-attempt/v1", stage: input.stage, attempt,
      request, requestSha256: renderSha256(canonicalRenderJson(request)), response: structuredClone(response), validation: { ok: false } };
    let facts: ValidatedStageFacts | undefined, failure: unknown;
    try { facts = validateMarketingExtractionResponse(input.stage, response, input.sources); record.validation = { ok: true }; }
    catch (error) { failure = error; record.validation = { ok: false, error: message(error) }; }
    // 写盘失败在任何后续模型调用或评审之前终止。
    await input.persistAttempt(record);
    if (facts) return facts;
    if (attempt === 2 || !message(failure).startsWith("MARKETING_PAYLOAD_INVALID：")) throw failure;
    correction = `结构校正（唯一一次）：上次响应违反结构。只按完整Schema重新输出；仍需逐项核验以下原来源，禁止补造、删减事实或改写原文引证。\n校验错误：${message(failure)}\n`;
  }
  throw new Error("MARKETING_EXTRACTION_UNVERIFIED：没有有效提取结果");
}
