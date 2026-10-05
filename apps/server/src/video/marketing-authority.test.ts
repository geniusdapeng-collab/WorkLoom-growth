/** 实际来源HTTP、A1–A5 vendor装订、reviewStage及文件摘要；只有模型回答是HTTP协议替身。 */
import { createServer, type Server } from "node:http";
import { mkdtemp, realpath, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareMarketingFacts, finalizeMarketingFacts, verifyMarketingFacts, type PreparedMarketingFacts } from "./marketing-authority.js";
import { fetchMarketingSource, requestSource } from "./marketing-source-fetcher.js";
import { canonicalRenderJson, renderSha256 } from "./gen/compiled-request.js";
const scope = { tenantId: "tenant-a", workspaceId: "ws-a", projectId: "P1", runId: "RUN1", attempt: 1 };
const env = { LLM_BASE_URL: "https://judge.example.test", LLM_API_KEY: "test-only", LLM_MODEL: "test-judge" };
const sourceUrl = "https://source.example.com/f3";
const sourceText = "星野 F3 是一款风扇，风量 9 档。尾部注意：9 档是风量档位，不是能耗等级；不得声称静音或市场第一。";
let server: Server, origin: string, root: string, modelCalls: any[], rejectJudge: boolean, extractionCalls: string[];
beforeAll(async () => {
  server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }); res.end(sourceText); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "marketing-authority-"))); modelCalls = []; extractionCalls = []; rejectJudge = false;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => { modelCalls.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ approved: !rejectJudge, score: rejectJudge ? 10 : 96, issues: rejectJudge ? ["来源不支持此主张"] : [], suggestions: [], reason: rejectJudge ? "原文限定相冲突" : "逐项原文支持" }) } }] })); }));
});
afterEach(async () => { vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); });
async function prepare(options: { noSearch?: boolean; noAux?: boolean; badQuote?: boolean; modelFailure?: boolean; malformedFirst?: boolean; malformedAlways?: boolean; mode?: string; attempt?: number } = {}): Promise<PreparedMarketingFacts> {
  let searches = 0, a1Calls = 0;
  return prepareMarketingFacts({ scope: { ...scope, attempt: options.attempt ?? 1 }, root, intent: "做一条风扇介绍", metadata: { brief: { product: "星野 F3", brand: "星野" } }, env: { ...env, ...(options.mode ? { VM_DATA_MINING_MODE: options.mode } : {}) },
    llm: { reason: async prompt => {
      extractionCalls.push(prompt); if (options.modelFailure) return { success: false, error: "LLM unavailable" };
      const match = /当前阶段：(A[123])\n(.*)$/s.exec(prompt)!; const source = JSON.parse(match[2]!).sources[0];
      if (match[1] !== "A1") return { success: true, data: { payload: match[1] === "A2" ? { reviews: [] } : { competitors: [] }, citations: [], noEvidenceReason: "页面仅商品规格，无可核实评价或竞品" } };
      a1Calls++;
      const images = options.malformedAlways || options.malformedFirst && a1Calls === 1 ? [{ url: sourceUrl + "/hero.png", page_url: sourceUrl, angle: "unknown", width: 100, height: 200 }] : [];
      return { success: true, data: { payload: { identity: { name: "星野 F3", specs: { 风量: "9 档" }, official_selling_points: [{ point: "风量 9 档", source_url: sourceUrl }] }, images }, citations: ["/identity/name", "/identity/specs/风量", "/identity/official_selling_points/0/point"].map(pointer => ({ pointer, sourceId: source.sourceId, quote: options.badQuote ? "不存在的事实" : sourceText })) } };
    } }, dependencies: {
      search: async () => (++searches, options.noSearch || options.noAux && searches > 20 ? [] : [{ title: "星野规格", url: sourceUrl, snippet: "故意错误摘要999档，不能当事实" }]),
      fetchSource: async url => fetchMarketingSource(url, { resolver: async () => [{ address: "93.184.216.34", family: 4 }], transport: async (_url, _address, signal) => requestSource(new URL(origin), { address: "127.0.0.1", family: 4 }, signal) }),
    } });
}
const shots = [{ shotId: "S1", prompt: "窗边展示星野 F3 风扇，字幕说明风量 9 档。", fields: { 场景: "窗边", 产品: "星野 F3", 规格: "9 档" } }];
describe("营销事实宿主完整执行", () => {
  it("非法裁决先保存原始HTTP回包到当前作用域，单次拒绝且不继续后站", async () => {
    const raw = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ approved: false, score: 10, issues: [], suggestions: [false], reason: "原文不支持" }) }, finish_reason: "stop" }], usage: { total_tokens: 37 } });
    vi.stubGlobal("fetch", vi.fn(async () => { modelCalls.push("invalid-original"); return new Response(raw); }));
    await expect(prepare()).rejects.toThrow("MARKETING_SUPPORT_REJECTED");
    expect(modelCalls).toHaveLength(1); expect(extractionCalls).toHaveLength(1);
    const record = JSON.parse(await readFile(path.join(root, "stages/preproduction/attempt-1.marketing-A1.judge-exchange-1.json"), "utf8"));
    expect(record.scope).toEqual(scope); expect(record.response.body).toBe(raw); expect(record.response.sha256).toBe(renderSha256(raw));
    expect(record.requestSha256).toBe(renderSha256(record.requestBody)); expect(record.response.status).toBe(200);
    expect(record.stage).toBe("facts");
  });
  it("原响应路径被占用时归档失败并停止，不用后续通过覆盖它", async () => {
    const file = path.join(root, "stages/preproduction/attempt-1.marketing-A1.judge-exchange-1.json");
    const { mkdir } = await import("node:fs/promises"); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, "existing-original", { flag: "wx" });
    await expect(prepare()).rejects.toThrow("原响应归档失败"); expect(modelCalls).toHaveLength(1);
    expect(await readFile(file, "utf8")).toBe("existing-original");
  });
  it("结构错误只校正一次，保留两次模型原回包；再次完整验证原文与所有事实后才进审核", async () => {
    const prepared = await prepare({ malformedFirst: true });
    const attempts = prepared.bundle.stages[0]!.extractionAttempts!;
    expect(attempts).toHaveLength(2); expect(extractionCalls).toHaveLength(4); expect(modelCalls).toHaveLength(3);
    const first = JSON.parse(await readFile(path.join(root, attempts[0]!.ref), "utf8"));
    const last = JSON.parse(await readFile(path.join(root, attempts[1]!.ref), "utf8"));
    expect(first.response.data.payload.images[0]).toMatchObject({ width: 100, height: 200 });
    expect(first.validation).toMatchObject({ ok: false }); expect(last.validation).toEqual({ ok: true });
    expect(extractionCalls[0]).toContain('"additionalProperties":false');
    expect(extractionCalls[1]).toContain("结构校正"); expect(extractionCalls[1]).toContain(sourceText);
    expect(prepared.bundle.stages[0]!.facts.claims).toHaveLength(3);
    const saved = await finalizeMarketingFacts(prepared, shots, env);
    await expect(verifyMarketingFacts({ root, ...saved, scope, shots })).resolves.toBeTruthy();
  });
  it("两次结构错误均归档，不能改写回包、跳过校验或继续支持审核", async () => {
    await expect(prepare({ malformedAlways: true })).rejects.toThrow("MARKETING_PAYLOAD_INVALID");
    expect(extractionCalls).toHaveLength(2); expect(modelCalls).toHaveLength(0);
    for (const attempt of [1, 2]) {
      const record = JSON.parse(await readFile(path.join(root, `stages/preproduction/attempt-1.marketing-A1.extraction-${attempt}.json`), "utf8"));
      expect(record.validation.ok).toBe(false); expect(record.response.data.payload.images[0].width).toBe(100);
    }
  });
  it("引证错误是事实失败，不适用结构校正；只记录失败回包一次", async () => {
    await expect(prepare({ badQuote: true })).rejects.toThrow("MARKETING_CITATION_INVALID");
    expect(extractionCalls).toHaveLength(1); expect(modelCalls).toHaveLength(0);
    const record = JSON.parse(await readFile(path.join(root, "stages/preproduction/attempt-1.marketing-A1.extraction-1.json"), "utf8"));
    expect(record.validation.ok).toBe(false);
  });
  it("真实HTTP正文→三站提取/完整支持审核→A1–A5→逐最终镜头事实审核→复读", async () => {
    const prepared = await prepare();
    expect(prepared.bundle.stages.map(stage => [stage.stage, stage.facts.status])).toEqual([["A1", "source_bound"], ["A2", "no_evidence"], ["A3", "no_evidence"]]);
    expect(prepared.bundle.sources).toHaveLength(1); expect(prepared.bundle.restrictions).toHaveLength(3); expect(extractionCalls).toHaveLength(3);
    expect(prepared.g1Content).toContain('"schemaVersion":"workloom.marketing-facts/v1"'); expect(modelCalls).toHaveLength(3);
    expect(JSON.stringify(modelCalls)).toContain("不得声称静音或市场第一"); expect(JSON.stringify(modelCalls)).not.toContain("999档");
    expect(JSON.stringify(modelCalls.slice(0, 3))).not.toContain("未提供结构化镜头合同");
    expect(JSON.stringify(modelCalls.slice(0, 3))).toContain("环节 facts");
    const saved = await finalizeMarketingFacts(prepared, shots, env); expect(modelCalls).toHaveLength(4);
    const checked = await verifyMarketingFacts({ root, ...saved, scope, shots }); expect(checked.outputReviews[0]?.promptSha256).toBe(renderSha256(shots[0]!.prompt));
    expect(await readFile(path.join(root, checked.sources[0]!.textRef), "utf8")).toBe(sourceText);
  });
  it.each(["spec", "no-search", "bad-quote", "model-failure", "support-rejected"])("%s不能得到可送G1的事实包", async kind => {
    rejectJudge = kind === "support-rejected";
    await expect(prepare({ mode: kind === "spec" ? "spec" : undefined, noSearch: kind === "no-search", badQuote: kind === "bad-quote", modelFailure: kind === "model-failure" })).rejects.toThrow();
    if (["spec", "no-search", "bad-quote", "model-failure"].includes(kind)) expect(modelCalls).toHaveLength(0);
  });
  it("最终镜头夸大主张被监制拒绝，事实包不能完成", async () => {
    const prepared = await prepare(); rejectJudge = true;
    await expect(finalizeMarketingFacts(prepared, [{ ...shots[0]!, prompt: "全市场第一，零噪音" }], env)).rejects.toThrow("MARKETING_PROMPT_FACTS_REJECTED");
    await expect(readFile(path.join(root, `${prepared.prefix}-facts.json`))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["raw", "text", "review", "extraction", "judge-exchange", "prompt-exchange", "missing-exchange", "exchange-scope", "prompt", "fields", "scope", "attempt", "expired", "claim-offset", "restrictions", "native-archive", "native-assembly", "native-proof", "native-model", "native-source"])("%s变化不能复用营销事实资格", async kind => {
    const prepared = await prepare(), saved = await finalizeMarketingFacts(prepared, shots, env); let hash = saved.sha256;
    const requestedShots = structuredClone(shots), expectedScope = { ...scope };
    if (["raw", "text", "review"].includes(kind)) {
      const source = prepared.bundle.sources[0]!, file = kind === "raw" ? source.rawRef : kind === "text" ? source.textRef : prepared.bundle.stages[0]!.review!.ref;
      await writeFile(path.join(root, file), "changed");
    }
    if (kind === "extraction") await writeFile(path.join(root, prepared.bundle.stages[0]!.extractionAttempts![0]!.ref), "changed");
    if (kind === "judge-exchange" || kind === "prompt-exchange") await writeFile(path.join(root,
      kind === "judge-exchange" ? `${prepared.prefix}-A1.judge-exchange-1.json` : `${prepared.prefix}-shot-1.judge-exchange-1.json`), "changed");
    if (kind === "missing-exchange") prepared.bundle.stages[0]!.review!.verdict.evidence = prepared.bundle.stages[0]!.review!.verdict.evidence!.filter(item => item.scope !== "judge-model-exchange");
    if (kind === "exchange-scope") {
      const file = path.join(root, `${prepared.prefix}-A1.judge-exchange-1.json`), record = JSON.parse(await readFile(file, "utf8"));
      record.scope.tenantId = "other"; const text = canonicalRenderJson(record); await writeFile(file, text);
      prepared.bundle.stages[0]!.review!.verdict.evidence!.find(item => item.scope === "judge-model-exchange")!.sha256 = renderSha256(text);
    }
    if (kind === "prompt") requestedShots[0]!.prompt += "未审主张";
    if (kind === "fields") requestedShots[0]!.fields.规格 = "99 档";
    if (kind === "scope") expectedScope.tenantId = "other";
    if (kind === "attempt") expectedScope.attempt = 2;
    if (kind === "native-archive") await writeFile(path.join(root, prepared.bundle.nativeDossierArchive.ref), "changed");
    if (kind === "native-assembly") await writeFile(path.join(root, prepared.bundle.nativeAssembly.ref), "changed");
    if (kind === "native-proof") delete (prepared.bundle as Partial<typeof prepared.bundle>).nativeDossier;
    if (kind === "native-model") prepared.bundle.nativeDossier.factInput.model = "未引证型号";
    if (kind === "native-source") prepared.bundle.nativeDossier.sources[0]!.finalUrl = "https://forged.example.test/";
    if (["expired", "claim-offset", "restrictions", "missing-exchange", "exchange-scope", "native-proof", "native-model", "native-source"].includes(kind)) {
      if (kind === "expired") prepared.bundle.collectedAt = new Date(Date.now() - 25 * 3600_000).toISOString();
      else if (kind === "claim-offset") prepared.bundle.stages[0]!.facts.claims[0]!.quoteStart++;
      else if (kind === "restrictions") prepared.bundle.restrictions.pop();
      if (prepared.bundle.nativeDossier) {
        const { sha256: _old, ...body } = prepared.bundle.nativeDossier;
        prepared.bundle.nativeDossier.sha256 = renderSha256(canonicalRenderJson(body));
      }
      const text = canonicalRenderJson(prepared.bundle); await writeFile(path.join(root, saved.ref), text); hash = renderSha256(text);
    }
    await expect(verifyMarketingFacts({ root, ref: saved.ref, sha256: hash, scope: expectedScope, shots: requestedShots })).rejects.toThrow();
  });
  it("重复attempt写盘失败必须终止，不能当抓源失败换候选", async () => {
    await prepare(); await expect(prepare()).rejects.toMatchObject({ code: "EEXIST" });
  });
});
