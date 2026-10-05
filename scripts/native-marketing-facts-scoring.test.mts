/**
 * MC-024: offline request-contract and immutable-verdict regression tests.
 * This does not judge semantics with a fake model. Replies are fixed protocol fixtures,
 * independent of prompt text; only a later authorized real run can measure model behavior.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repositoryRoot = resolve(process.env.WORKLOOM_ASSERTION_MODULE_ROOT ?? new URL("../", import.meta.url).pathname);
const { reviewStage } = await import(pathToFileURL(join(repositoryRoot, "packages/video-studio/src/producer-gate.ts")).href);
const { validateStageFacts } = await import(pathToFileURL(join(repositoryRoot, "apps/server/src/video/marketing-facts.ts")).href);
const fixtureRoot = fileURLToPath(new URL("./fixtures/marketing-facts-scoring/", import.meta.url));
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fixture = (name: string) => readFileSync(join(fixtureRoot, name));
const actualReviewBytes = fixture("actual-a3.review.json");
const actualReview = JSON.parse(actualReviewBytes.toString("utf8"));
const actualExchange = JSON.parse(fixture("actual-a3.judge-exchange-1.json").toString("utf8"));
const originalResponse = fixture("actual-a3.response-body.json").toString("utf8");
const env = { LLM_BASE_URL: "https://judge.example.test", LLM_API_KEY: "mc024-fixture-only", LLM_MODEL: "offline-fixed-reply" };
const fixedReply = (approved: boolean, score: number, reason = "fixed offline protocol fixture") => JSON.stringify({
  choices: [{ message: { content: JSON.stringify({ approved, score, issues: [], suggestions: [], reason }) }, finish_reason: "stop" }],
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64");

interface ReviewInput {
  record?: unknown; originalBytes?: Buffer; response?: string; rubric?: string[];
  stage?: string; unavailable?: boolean; artifactKind?: string; contracts?: unknown;
  archiveFailure?: boolean; httpStatus?: number;
}
async function runReview(input: ReviewInput = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "mc024-facts-")));
  const evidencePath = join(dir, "complete-evidence.json");
  const bytes = input.originalBytes ?? Buffer.from(JSON.stringify(input.record ?? actualReview));
  writeFileSync(evidencePath, bytes, { flag: "wx" });
  const requests: any[] = [], exchanges: any[] = [], archivedBytes: Buffer[] = [];
  const response = input.response ?? originalResponse;
  try {
    const verdict = await reviewStage({
      stage: input.stage ?? "facts", projectId: "MC024-OFFLINE", minScore: 85,
      artifacts: [{ path: evidencePath, kind: input.artifactKind ?? "json" }],
      deterministic: [{ id: "claims-source-bound", pass: true, hard: true, detail: "offline structural citation fixture; semantic support still needs review" }],
      requiredCheckIds: ["claims-source-bound"], env: input.unavailable ? {} : env,
      ...(input.rubric ? { rubric: input.rubric } : {}),
      ...(input.contracts === undefined ? {} : { contracts: input.contracts }),
      fetchImpl: async (_url: unknown, init: any) => {
        requests.push(JSON.parse(String(init?.body)));
        // Fixed before the request: this never awards a score based on prompt keywords.
        return new Response(response, { status: input.httpStatus ?? 200 });
      },
      onModelExchange: async (exchange: unknown) => {
        exchanges.push(structuredClone(exchange));
        if (input.archiveFailure) throw new Error("fixture archive unavailable");
        const serialized = Buffer.from(JSON.stringify(exchange));
        const archivePath = join(dir, "judge-exchange.json");
        writeFileSync(archivePath, serialized, { flag: "wx" });
        archivedBytes.push(readFileSync(archivePath));
        return { path: archivePath, sha256: sha(serialized) };
      },
    } as any);
    return { verdict, requests, exchanges, archivedBytes, evidenceBytes: readFileSync(evidencePath) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const ruleText = (result: Awaited<ReturnType<typeof runReview>>) => result.requests[0].messages[0].content[0].text as string;
function assertCompleteEvidence(result: Awaited<ReturnType<typeof runReview>>, expected: Buffer) {
  assert.equal(result.requests.length, 1);
  const parts = result.requests[0].messages[0].content;
  assert.ok(parts.some((part: any) => typeof part.text === "string" && part.text.endsWith(expected.toString("utf8"))));
  assert.equal(result.evidenceBytes.equals(expected), true);
  assert.equal(result.verdict.evidence?.find((part: any) => part.scope === "complete-text")?.sha256, sha(expected));
}
function assertScoreScope(text: string) {
  assert.match(text, /score[^\n]*只评[^\n]*主张[^\n]*支持关系/, "facts score must explicitly be the support dimension");
  assert.match(text, /status\/noEvidenceReason[^\n]*来源限制[^\n]*忠实性/, "honesty and source limits belong to this dimension");
  assert.match(text, /覆盖不足[^\n]*issues\/suggestions[^\n]*不得[^\n]*支持关系[^\n]*score/, "coverage stays visible without changing the support score");
  assert.match(text, /A2\/A3[^\n]*no_evidence[^\n]*完整来源/, "empty stages still need full-source review");
  assert.match(text, /虚假空值[^\n]*不实[^\n]*noEvidenceReason[^\n]*拒绝/, "false emptiness remains a refusal condition");
  assert.match(text, /已提出的主张[^\n]*缺证据[^\n]*拒绝/, "an unsupported claim remains a refusal condition");
  assert.match(text, /分数与批准[^\n]*独立判断[^\n]*不预设/, "the prompt may not dictate an approval or score");
  assert.doesNotMatch(text, /只核验实际收到的完整原文与逐主张证据；缺证据必须拒绝/, "remove the ambiguous empty-versus-unsupported blanket instruction");
}

test("actual A3 fixtures preserve complete original bytes, nested exchanges and the true/76 denial input", () => {
  const expectedHashes: Record<string, string> = {
    "actual-a3.review.json": "5334c64f2a145c0ed788e18387cd80fd453e914b3c314da2e6bb6fdfae0c5884",
    "actual-a3.judge-exchange-1.json": "023e2b206de3ef2f69aca7ecd63f03c862b59574236aaf28dc5a535913c57fd0",
    "actual-a3.extraction-1.json": "e01e4fccfbdc6da46c63cd430f974ae6f77d457abd291909514beb3d39df1f75",
    "actual-a3.request-body.json": "db7a4469da8fe139e0a8507cdaa5a7ebf69876c050b02541c0a087bf02f343ca",
    "actual-a3.response-body.json": "b962892e27d3cc97b8c4e10a067318a8a033423ee6c65094f355bc15ad7822df",
  };
  for (const [name, hash] of Object.entries(expectedHashes)) assert.equal(sha(fixture(name)), hash, name);
  assert.equal(originalResponse, actualExchange.response.body);
  assert.equal(fixture("actual-a3.request-body.json").toString("utf8"), actualExchange.requestBody);
  assert.deepEqual(JSON.parse(actualExchange.requestBody), actualExchange.request);
  assert.equal(actualExchange.batch, 1); assert.equal(actualExchange.batches, 1);
  const choice = JSON.parse(originalResponse).choices[0];
  const answer = JSON.parse(choice.message.content);
  assert.equal(choice.finish_reason, "stop"); assert.equal(answer.approved, true); assert.equal(answer.score, 76);
  assert.deepEqual(actualReview.facts.claims, []); assert.deepEqual(actualReview.facts.payload.competitors, []);
  assert.equal(actualReview.facts.status, "no_evidence");
  assert.equal(sha(actualReview.sources[0].text), actualReview.sources[0].textSha256);
  assert.ok(actualExchange.request.messages[0].content.some((part: any) => part.text?.endsWith(actualReviewBytes.toString("utf8"))));
});

test("facts request separates support score from retrieval coverage while retaining the complete actual A3 empty record", async () => {
  const result = await runReview({ originalBytes: actualReviewBytes });
  assertCompleteEvidence(result, actualReviewBytes);
  assertScoreScope(ruleText(result));
  assert.match(ruleText(result), /不能以空值推断市场不存在竞品或用户评价/);
});

test("custom facts rubric cannot omit the mandatory score and honest-empty boundaries", async () => {
  const result = await runReview({ rubric: ["MC024 custom source-support rubric"] });
  assert.equal(result.requests.length, 1);
  assert.match(ruleText(result), /MC024 custom source-support rubric/);
  assertScoreScope(ruleText(result));
});

test("the unchanged original approved=true score=76 response remains denied, archived byte-for-byte, and called once", async () => {
  const result = await runReview({ originalBytes: actualReviewBytes });
  assert.equal(result.verdict.status, "failed"); assert.equal(result.verdict.approved, false);
  assert.equal(result.verdict.score, 76); assert.equal(result.verdict.via, "llm"); assert.equal(result.verdict.degraded, false);
  assert.equal(result.verdict.rerun, true); assert.match(result.verdict.reason, /评分≥85/);
  assert.equal(result.requests.length, 1); assert.equal(result.exchanges.length, 1); assert.equal(result.archivedBytes.length, 1);
  const archived = JSON.parse(result.archivedBytes[0].toString("utf8"));
  assert.equal(archived.response.body, originalResponse);
  assert.equal(archived.response.sha256, actualExchange.response.sha256);
  assert.equal(archived.requestSha256, sha(archived.requestBody));
  assert.equal(archived.response.redacted, false); assert.equal(archived.requestRedacted, false);
  assert.equal(archived.batch, 1); assert.equal(archived.batches, 1);
  assertCompleteEvidence(result, actualReviewBytes);
});

for (const score of [10, 85, 96]) test(`an original approved=false score=${score} is never replaced or promoted`, async () => {
  const response = fixedReply(false, score, "source limitation or unsupported claim");
  const result = await runReview({ response });
  assert.equal(result.verdict.status, "failed"); assert.equal(result.verdict.approved, false); assert.equal(result.verdict.score, score);
  assert.equal(result.requests.length, 1); assert.equal(result.exchanges[0].response.body, response);
});
for (const score of [84, 85, 96]) test(`fixed positive protocol reply score=${score} obeys the unchanged 85 boundary`, async () => {
  const result = await runReview({ response: fixedReply(true, score) });
  assert.equal(result.verdict.approved, score >= 85); assert.equal(result.verdict.status, score >= 85 ? "passed" : "failed");
  assert.equal(result.verdict.score, score); assert.equal(result.requests.length, 1);
});

for (const stage of ["A2", "A3"]) test(`${stage} honest no_evidence stays a full LLM request and cannot become a deterministic approval`, async () => {
  const record = structuredClone(actualReview);
  record.facts.stage = stage; record.facts.payload = stage === "A2" ? { reviews: [] } : { competitors: [] };
  const reason = "完整来源是字词辨析文章；本批次没有可核实评价或竞品，禁止口碑与对比主张";
  record.facts.noEvidenceReason = reason;
  const checked = validateStageFacts(stage, { payload: record.facts.payload, citations: [], noEvidenceReason: reason }, record.sources);
  assert.equal(checked.status, "no_evidence"); assert.deepEqual(checked.claims, []);
  const expected = Buffer.from(JSON.stringify(record));
  const result = await runReview({ record, response: fixedReply(false, 96, "fixed denial is still authoritative") });
  assertCompleteEvidence(result, expected);
  assert.equal(result.verdict.status, "failed"); assert.equal(result.verdict.approved, false); assert.equal(result.verdict.via, "llm");
  assert.equal(result.exchanges.length, 1); assert.equal(result.verdict.score, 96);
});

function semanticCase(kind: "supported-claim" | "false-empty" | "negated-claim" | "missing-limit") {
  const text = "同品类竞品甲：前台双屏自助终端，提供证件读取；不支持离线核验。原文用途限制：仅客户项目内使用，公开投放需确认。";
  const source = { ...actualReview.sources[0], sourceId: "SRC-offline-semantic", text, textSha256: sha(text), rawSha256: sha(text), bytes: Buffer.byteLength(text),
    requestedUrl: "https://fixture.example.com/competitor", finalUrl: "https://fixture.example.com/competitor", assetUrls: [] };
  const payload = kind === "false-empty" ? { competitors: [] } : { competitors: [{ name: "竞品甲", selling_points: [{
    point: kind === "negated-claim" ? "支持离线核验" : "提供证件读取", source_url: source.finalUrl,
  }] }] };
  const citations = kind === "false-empty" ? [] : ["/competitors/0/name", "/competitors/0/selling_points/0/point"]
    .map(pointer => ({ pointer, sourceId: source.sourceId, quote: text }));
  // The existing structural checker deliberately does not pretend to judge semantics.
  const facts = validateStageFacts("A3", { payload, citations,
    ...(kind === "false-empty" ? { noEvidenceReason: "完整来源未出现任何竞品或可核实卖点" } : {}) }, [source]);
  return { facts, sources: [source], sourceRestrictions: ["仅客户项目内使用，公开投放需确认"],
    restrictions: kind === "missing-limit" ? [] : ["仅客户项目内使用，公开投放需确认"] };
}
test("nonempty cited facts preserve complete evidence and apply the unchanged positive 85 protocol boundary", async () => {
  const record = semanticCase("supported-claim"), expected = Buffer.from(JSON.stringify(record));
  assert.equal(record.facts.status, "source_bound"); assert.equal(record.facts.claims.length, 2);
  assert.deepEqual(record.facts.claims.map(claim => [claim.pointer, claim.value]), [
    ["/competitors/0/name", "竞品甲"], ["/competitors/0/selling_points/0/point", "提供证件读取"],
  ]);
  assert.equal(new Set(record.facts.claims.map(claim => claim.pointer)).size, 2);
  assert.ok(record.facts.claims.every(claim => claim.quote === record.sources[0].text));
  assert.ok(record.facts.claims.every(claim => claim.sourceId === record.sources[0].sourceId && claim.textSha256 === sha(record.sources[0].text)));
  assert.deepEqual(record.restrictions, record.sourceRestrictions);
  // The source is explicit, but this fixed positive only tests protocol preservation;
  // it does not measure whether a real model follows the support rubric.
  const response = fixedReply(true, 85, "fixed protocol positive; semantic model behavior is unverified");
  const result = await runReview({ record, response });
  assertCompleteEvidence(result, expected);
  assert.equal(result.verdict.approved, true); assert.equal(result.verdict.status, "passed");
  assert.equal(result.verdict.score, 85); assert.equal(result.verdict.via, "llm");
  assert.equal(result.exchanges[0].response.body, response);
});
for (const kind of ["false-empty", "negated-claim", "missing-limit"] as const) test(`${kind} keeps contradictory evidence and explicit refusal criteria in the one facts request`, async () => {
  const record = semanticCase(kind), expected = Buffer.from(JSON.stringify(record));
  const result = await runReview({ record, response: fixedReply(false, 96, kind) });
  assertCompleteEvidence(result, expected);
  assert.equal(result.verdict.approved, false); assert.equal(result.verdict.status, "failed"); assert.equal(result.verdict.score, 96);
  assert.match(ruleText(result), /虚假空值[^\n]*不实[^\n]*noEvidenceReason[^\n]*拒绝/);
  assert.match(ruleText(result), /否定、限定、型号[^\n]*冲突[^\n]*拒绝/);
  assert.match(ruleText(result), /来源限制[^\n]*遗漏[^\n]*拒绝/);
});

test("missing facts model stays unverified even for an honest empty record", async () => {
  const result = await runReview({ unavailable: true });
  assert.equal(result.verdict.status, "unverified"); assert.equal(result.verdict.approved, false);
  assert.equal(result.requests.length, 0); assert.equal(result.exchanges.length, 0);
});
test("facts cannot acquire image or storyboard qualification before any model call", async () => {
  for (const input of [{ artifactKind: "image" }, { contracts: { shots: [{ shotId: "S1", scene: "产品特写" }] } }]) {
    const result = await runReview(input);
    assert.equal(result.verdict.status, "unverified"); assert.equal(result.verdict.approved, false); assert.equal(result.requests.length, 0);
    assert.match(result.verdict.reason, /事实审核只接受完整文本|事实审核不消费镜头合同/);
  }
});
test("archive failure preserves refusal without obtaining a replacement model decision", async () => {
  const result = await runReview({ archiveFailure: true });
  assert.equal(result.verdict.status, "unverified"); assert.equal(result.verdict.approved, false);
  assert.equal(result.requests.length, 1); assert.equal(result.exchanges.length, 1); assert.equal(result.exchanges[0].response.body, originalResponse);
  assert.match(result.verdict.reason, /原响应归档失败/);
});
for (const kind of ["invalid-json", "duplicate-approved", "truncated", "http-failure"]) test(`${kind} original response is archived once and never retried into an approval`, async () => {
  let response = fixedReply(true, 96), httpStatus = 200;
  if (kind === "invalid-json") response = JSON.stringify({ choices: [{ message: { content: '{"approved":false,' }, finish_reason: "stop" }] });
  if (kind === "duplicate-approved") response = JSON.stringify({ choices: [{ message: { content: '{"approved":false,"approved":true,"score":96,"issues":[],"suggestions":[],"reason":"ambiguous"}' }, finish_reason: "stop" }] });
  if (kind === "truncated") { const parsed = JSON.parse(response); parsed.choices[0].finish_reason = "length"; response = JSON.stringify(parsed); }
  if (kind === "http-failure") { response = "offline HTTP fixture failure"; httpStatus = 500; }
  const result = await runReview({ response, httpStatus });
  assert.equal(result.verdict.approved, false); assert.equal(result.verdict.status, "unverified");
  assert.equal(result.requests.length, 1); assert.equal(result.exchanges.length, 1); assert.equal(result.exchanges[0].response.body, response);
  assert.equal(result.exchanges[0].response.sha256, sha(response));
});
for (const stage of ["prompt", "keyframe", "subtitle"]) test(`${stage} retains its own evidence/refusal boundary without facts support-score instructions`, async () => {
  const visual = stage !== "prompt";
  const result = await runReview({ stage, ...(visual ? { originalBytes: png, artifactKind: "image" } : {}), response: fixedReply(false, 96) });
  assert.equal(result.requests.length, 1); assert.equal(result.verdict.approved, false);
  assert.equal(result.verdict.status, "failed"); assert.equal(result.verdict.score, 96);
  const rules = ruleText(result);
  assert.match(rules, /缺证据必须拒绝，不能猜测/);
  assert.match(rules, /未提供结构化镜头合同/);
  assert.doesNotMatch(rules, /score[^\n]*只评[^\n]*主张[^\n]*支持关系/);
  assert.doesNotMatch(rules, /覆盖不足[^\n]*issues\/suggestions[^\n]*不得[^\n]*支持关系[^\n]*score/);
  if (stage === "subtitle") assert.match(rules, /逐条对照原台词和时间轴/);
  if (stage === "keyframe") assert.match(rules, /主体种类、人数、可见部位/);
});
