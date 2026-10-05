import { describe, expect, it } from "vitest";
import { FilmServiceClient, FilmServiceClientError, type FilmJobStatus } from "./film-service-client.js";
import { NATIVE_FILM_STAGES } from "./native-film-source.js";

const hash = (char: string) => char.repeat(64);
const sourceVersion = { sourceStageRunId: "preproduction-1", promptsSha256: hash("d"), filmSourceSha256: hash("e") };

function startReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: "FJ-1", projectId: "VID-1", attempt: 1, runId: "film-run-1", status: "running",
    inputSha256: hash("a"), workerEntrySha256: hash("b"), stages: [...NATIVE_FILM_STAGES],
    startedAt: "2026-09-28T00:00:00.000Z", budgetCny: 12.5, ...overrides,
  };
}

function jobStatus(overrides: Partial<FilmJobStatus> = {}): FilmJobStatus {
  return {
    jobId: "FJ-1", projectId: "VID-1", attempt: 1, runId: "film-run-1", workerName: "full-chain-film",
    status: "running", stages: ["plates"], startedAt: "2026-09-28T00:00:00.000Z", finishedAt: null,
    errorClass: null, errorMessage: null, resultRef: null, resultSha256: null,
    components: [{ component: "image", stepKey: "plates:SC-01", shotId: "SC-01", state: "accepted", reservedCny: 0.3, actualCny: null, updatedAt: "2026-09-28T00:01:00.000Z" }],
    reservedCny: 0.3, spentCny: 0.3, ...overrides,
  };
}

function clientWith(handler: (route: string, body: unknown) => { status?: number; body: unknown }): { client: FilmServiceClient; calls: Array<{ route: string; init: RequestInit }> } {
  const calls: Array<{ route: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const route = url.split("/trpc/")[1]!.split("?")[0]!;
    calls.push({ route, init: init ?? {} });
    const body = init?.body ? JSON.parse(String(init.body)) : JSON.parse(decodeURIComponent(new URL(url).searchParams.get("input") ?? "{}"));
    const reply = handler(route, body);
    return new Response(JSON.stringify({ result: { data: reply.body } }), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { client: new FilmServiceClient({ api: "http://127.0.0.1:8787", token: "test-only-workspace-token", fetchImpl }), calls };
}

describe("film-service-client（公开 CLI 只做提交与状态查询）", () => {
  it("原生预生产只提交客户意图与档案身份，之后读取真实执行状态", async () => {
    const { client, calls } = clientWith((route) => ({ body: route === "video.studio.start"
      ? { kind: "routed", projectId: "VID-1", runId: "R1", pipeline: "marketing" }
      : { projectId: "VID-1", runId: "R1", status: "finished", currentGate: "G7", pendingApprovalId: null, error: null } }));
    await expect(client.prepare({ intent: "30秒自助入住机宣传片", characterId: "ceo", productId: "product" })).resolves.toMatchObject({ projectId: "VID-1" });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ metadata: { characterId: "ceo", productId: "product" } });
    await expect(client.preproductionStatus("R1")).resolves.toMatchObject({ status: "finished" });
    await expect(client.prepare({ intent: "需求", shots: [] } as never)).rejects.toThrow("CALLER_SOURCE_FORBIDDEN");
    expect(calls).toHaveLength(2);
    const { client: human } = clientWith(() => ({ body: { projectId: "VID-1", runId: "R1", status: "awaiting_approval", pendingApprovalId: "AP1" } }));
    await expect(human.preproductionStatus("R1")).rejects.toThrow("中间人工验收");
  });
  it("拒绝非回环 http、带凭据 URL 与空 token", () => {
    expect(() => new FilmServiceClient({ api: "http://example.com", token: "x" })).toThrow(FilmServiceClientError);
    expect(() => new FilmServiceClient({ api: "https://user:pass@example.com", token: "x" })).toThrow(/不得携带凭据/);
    expect(() => new FilmServiceClient({ api: "http://127.0.0.1:8787/", token: "  " })).toThrow(/WORKLOOM_TOKEN/);
  });
  it("保留原生需求澄清原因，不把未立项的澄清误报为畸形回执或自动重发", async () => {
    const { client, calls } = clientWith(() => ({ body: { kind: "clarify", question: "缺少商品身份" } }));
    await expect(client.prepare({ intent: "宣传片" })).rejects.toThrow("PREPRODUCTION_CLARIFY_REQUIRED: 缺少商品身份");
    expect(calls).toHaveLength(1);
  });

  it("start 提交作业并校验回执身份与阶段清单", async () => {
    const { client, calls } = clientWith(() => ({ body: startReceipt() }));
    const receipt = await client.start({ projectId: "VID-1", workerName: "full-chain-film", sourceVersion, stages: [...NATIVE_FILM_STAGES] });
    expect(receipt.jobId).toBe("FJ-1");
    expect(calls[0]!.route).toBe("video.film.start");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body)).stages).toEqual(NATIVE_FILM_STAGES);
    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty("document");
  });

  it("start 拒绝被服务改写的阶段清单或畸形回执", async () => {
    const { client } = clientWith(() => ({ body: startReceipt({ stages: ["videos"] }) }));
    await expect(client.start({ projectId: "VID-1", workerName: "full-chain-film", sourceVersion }))
      .rejects.toMatchObject({ code: "START_RECEIPT_INVALID" });
    const { client: broken } = clientWith(() => ({ body: startReceipt({ inputSha256: "short" }) }));
    await expect(broken.start({ projectId: "VID-1", workerName: "full-chain-film", sourceVersion }))
      .rejects.toMatchObject({ code: "START_RECEIPT_INVALID" });
  });

  it("在请求前拒绝调用方分镜与不完整的制作阶段", async () => {
    const { client, calls } = clientWith(() => ({ body: startReceipt() }));
    await expect(client.start({ projectId: "VID-1", workerName: "full-chain-film", sourceVersion, document: { shots: [] } } as never))
      .rejects.toMatchObject({ code: "CALLER_SOURCE_FORBIDDEN" });
    await expect(client.start({ projectId: "VID-1", workerName: "full-chain-film", sourceVersion, stages: ["videos", "deliver"] }))
      .rejects.toMatchObject({ code: "REQUEST_INVALID" });
    expect(calls).toHaveLength(0);
  });

  it("plan 要求当前原生来源、完整阶段与真实预算", async () => {
    const plan = { projectId: "VID-1", pipelineKind: "marketing", sourceVersion, sourceAttempt: 1,
      shots: [{ shotId: "SC-01", durationSec: 10, promptSha256: hash("f") }], stages: [...NATIVE_FILM_STAGES],
      totalSeconds: 10, estimatedReserveCny: 25, humanAcceptance: "final-film-only" };
    const { client, calls } = clientWith(() => ({ body: plan }));
    await expect(client.plan("VID-1")).resolves.toEqual(plan);
    expect(calls[0]!.route).toBe("video.film.plan");
    const { client: invalid } = clientWith(() => ({ body: { ...plan, totalSeconds: 30 } }));
    await expect(invalid.plan("VID-1")).rejects.toMatchObject({ code: "PLAN_RECEIPT_INVALID" });
  });

  it("status 校验作业/组件回执；已完成作业必须有结果引用与摘要", async () => {
    const { client, calls } = clientWith(() => ({ body: jobStatus() }));
    await expect(client.status("FJ-1")).resolves.toMatchObject({ jobId: "FJ-1", status: "running" });
    expect(calls[0]!.route).toBe("video.film.status");
    const { client: badFinish } = clientWith(() => ({ body: jobStatus({ status: "finished", resultRef: null, resultSha256: null }) }));
    await expect(badFinish.status("FJ-1")).rejects.toMatchObject({ code: "STATUS_RECEIPT_INVALID" });
    const { client: badComponent } = clientWith(() => ({ body: jobStatus({ components: [{ component: "image", stepKey: "p", shotId: null, state: "whatever" as never, reservedCny: 0, actualCny: null, updatedAt: "x" }] }) }));
    await expect(badComponent.status("FJ-1")).rejects.toMatchObject({ code: "STATUS_RECEIPT_INVALID" });
  });

  it("服务拒绝与网络失败都按未核实处理，且不回显 token", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "PRECONDITION_FAILED: 作业不存在 test-only-workspace-token" } }), { status: 412 })) as typeof fetch;
    const client = new FilmServiceClient({ api: "http://127.0.0.1:8787", token: "test-only-workspace-token", fetchImpl });
    await expect(client.status("FJ-1")).rejects.toMatchObject({ code: "SERVICE_REJECTED" });
    const failed = await client.status("FJ-1").catch((error: FilmServiceClientError) => error);
    expect(String(failed)).not.toContain("test-only-workspace-token");
    expect(String(failed)).toContain("[redacted]");
  });

  it("wait 轮询到终态后停止（不因超时自动重发）", async () => {
    let round = 0;
    const { client } = clientWith(() => {
      round += 1;
      return { body: jobStatus(round >= 3 ? { status: "finished", finishedAt: "2026-09-28T00:10:00.000Z", resultRef: "stages/film/attempt-1/film-result.json", resultSha256: hash("c") } : {}) };
    });
    const seen: string[] = [];
    const final = await client.wait("FJ-1", { pollRounds: 10, pollIntervalMs: 0, onProgress: (status) => { seen.push(status.status); } });
    expect(final.status).toBe("finished");
    expect(final.resultSha256).toBe(hash("c"));
    expect(seen).toEqual(["running", "running", "finished"]);
  });
});
