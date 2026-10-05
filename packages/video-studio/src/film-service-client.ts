/**
 * film-service-client.ts —— 公开 full-chain 入口的服务侧客户端（T-2026-0927-0039）。
 *
 * 公开 CLI 只做三件事：提交作业（服务读取并冻结原稿）、查询作业状态、按状态给出诚实退出码。
 * 它不编译供应商请求、不持有密钥、不解释"门是否通过"——那些全部在服务与固定工位内发生。
 * 与 `production-client.ts` 同一纪律：HTTPS 或本机回环、token 不落盘、超时按 `unknown` 处理、
 * 收到畸形回执一律拒绝而不是猜测。
 */
import { NATIVE_FILM_STAGES } from "./native-film-source.js";

export interface FilmSourceVersion { sourceStageRunId: string; promptsSha256: string; filmSourceSha256: string }
export interface NativePreproductionReceipt { kind: "routed"; projectId: string; runId: string; pipeline: "narrative" | "marketing" }
export interface NativePreproductionStatus { projectId: string; runId: string; status: "running" | "finished" | "failed"; currentGate: string | null; pendingApprovalId: null; error: string | null }
export interface FilmProductionPlan {
  projectId: string; pipelineKind: "narrative" | "marketing"; sourceVersion: FilmSourceVersion; sourceAttempt: number;
  shots: Array<{ shotId: string; durationSec: number; promptSha256: string }>;
  stages: string[]; totalSeconds: number; estimatedReserveCny: number; humanAcceptance: "final-film-only";
}
export interface FilmJobStartReceipt {
  jobId: string;
  projectId: string;
  attempt: number;
  runId: string;
  status: "running";
  inputSha256: string;
  workerEntrySha256: string;
  stages: string[];
  startedAt: string;
  budgetCny: number;
}

export interface FilmJobComponentSummary {
  component: string;
  stepKey: string;
  shotId: string | null;
  state: "reserved" | "dispatched" | "accepted" | "failed" | "unknown";
  reservedCny: number;
  actualCny: number | null;
  updatedAt: string;
}

export interface FilmJobStatus {
  jobId: string;
  projectId: string;
  attempt: number;
  runId: string;
  workerName: string;
  status: "running" | "finished" | "failed" | "interrupted";
  stages: string[];
  startedAt: string;
  finishedAt: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  resultRef: string | null;
  resultSha256: string | null;
  components: FilmJobComponentSummary[];
  reservedCny: number;
  spentCny: number;
}

export class FilmServiceClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "FilmServiceClientError";
  }
}

const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const COMPONENT_STATES = new Set(["reserved", "dispatched", "accepted", "failed", "unknown"]);
const JOB_STATES = new Set(["running", "finished", "failed", "interrupted"]);

export class FilmServiceClient {
  private readonly url: string;
  private readonly secrets: Set<string>;

  constructor(private readonly options: { api: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    let api: URL;
    try {
      api = new URL(options.api);
    } catch {
      throw new FilmServiceClientError("API_ENDPOINT_INVALID", "服务地址不是合法 URL");
    }
    if (api.username || api.password || api.search || api.hash
      || (api.protocol !== "https:" && !(api.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(api.hostname)))) {
      throw new FilmServiceClientError("API_ENDPOINT_INVALID", "只接受 HTTPS 或本机回环地址，且不得携带凭据或查询串");
    }
    if (!options.token.trim() || /[\r\n]/.test(options.token)) throw new FilmServiceClientError("AUTH_REQUIRED", "缺少 WORKLOOM_TOKEN（受权工作区凭据）");
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new FilmServiceClientError("TIMEOUT_INVALID", "请求超时必须为正数");
    }
    this.url = api.toString().replace(/\/$/, "");
    this.secrets = new Set([options.token]);
  }

  safeError(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of this.secrets) message = message.split(secret).join("[redacted]");
    return message.slice(0, 1200);
  }

  private async request<T>(route: "video.film.plan" | "video.film.start" | "video.film.status" | "video.studio.start" | "video.studio.status", input: unknown, method: "GET" | "POST"): Promise<T> {
    const suffix = method === "GET" ? `?input=${encodeURIComponent(JSON.stringify(input))}` : "";
    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(`${this.url}/trpc/${route}${suffix}`, {
        method,
        redirect: "error",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.token}` },
        ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
      });
    } catch (error) {
      throw new FilmServiceClientError("SERVICE_OUTCOME_UNKNOWN", this.safeError(error));
    }
    const bytes = await response.text();
    if (bytes.length > 8_000_000) throw new FilmServiceClientError("SERVICE_RESPONSE_INVALID", "服务响应超出完整解析预算");
    let envelope: unknown;
    try {
      envelope = JSON.parse(bytes);
    } catch {
      throw new FilmServiceClientError("SERVICE_RESPONSE_INVALID", `HTTP ${response.status}：响应不是合法 JSON`);
    }
    if (!response.ok || !isObject(envelope) || envelope.error) {
      const detail = isObject(envelope) && isObject(envelope.error) && typeof envelope.error.message === "string"
        ? envelope.error.message
        : `HTTP ${response.status}`;
      throw new FilmServiceClientError("SERVICE_REJECTED", this.safeError(detail));
    }
    if (!isObject(envelope.result) || !("data" in envelope.result)) {
      throw new FilmServiceClientError("SERVICE_RESPONSE_INVALID", "缺少 tRPC result.data");
    }
    return envelope.result.data as T;
  }

  async prepare(input: { intent: string; characterId?: string; productId?: string; platform?: string; route?: "auto" | "marketing" | "narrative" }): Promise<NativePreproductionReceipt> {
    if (Object.keys(input).some(key => !["intent", "characterId", "productId", "platform", "route"].includes(key))) throw new FilmServiceClientError("CALLER_SOURCE_FORBIDDEN", "预生产只接受客户意图及档案身份，不接受阶段产物");
    if (!isText(input.intent) || input.intent.length > 2000) throw new FilmServiceClientError("REQUEST_INVALID", "客户意图须为1–2000字");
    const metadata: Record<string, string> = {};
    for (const key of ["characterId", "productId", "platform"] as const) if (input[key] !== undefined) {
      if (!isText(input[key]) || input[key]!.length > 200 || /[\0\r\n]/.test(input[key]!)) throw new FilmServiceClientError("REQUEST_INVALID", `${key}非法`);
      metadata[key] = input[key]!;
    }
    const value = await this.request<unknown>("video.studio.start", { intent: input.intent, metadata, route: input.route ?? "auto" }, "POST");
    if (isObject(value) && value.kind === "clarify") throw new FilmServiceClientError("PREPRODUCTION_CLARIFY_REQUIRED",
      this.safeError(typeof value.question === "string" ? value.question : "服务尚未立项；缺少可核实的客户需求"));
    if (!isObject(value) || value.kind !== "routed" || !isText(value.projectId) || !isText(value.runId) || !["narrative", "marketing"].includes(String(value.pipeline))) {
      throw new FilmServiceClientError("PREPRODUCTION_RECEIPT_INVALID", "原生预生产没有返回可核实的营销/叙事项目与执行身份；不重发");
    }
    return value as unknown as NativePreproductionReceipt;
  }
  async preproductionStatus(runId: string): Promise<NativePreproductionStatus> {
    const value = await this.request<NativePreproductionStatus>("video.studio.status", { runId }, "GET");
    if (!isObject(value) || value.runId !== runId || !isText(value.projectId) || !["running", "finished", "failed"].includes(String(value.status))
      || value.pendingApprovalId !== null) throw new FilmServiceClientError("PREPRODUCTION_RECEIPT_INVALID", "原生预生产状态未核实或误入中间人工验收");
    return value;
  }

  async plan(projectId: string): Promise<FilmProductionPlan> {
    if (!isText(projectId)) throw new FilmServiceClientError("REQUEST_INVALID", "projectId必填");
    const plan = await this.request<FilmProductionPlan>("video.film.plan", { projectId }, "GET");
    if (!isObject(plan) || plan.projectId !== projectId || !["narrative", "marketing"].includes(String(plan.pipelineKind))
      || !isObject(plan.sourceVersion) || !isText(plan.sourceVersion.sourceStageRunId)
      || !isHash(plan.sourceVersion.promptsSha256) || !isHash(plan.sourceVersion.filmSourceSha256)
      || !Number.isSafeInteger(plan.sourceAttempt) || plan.sourceAttempt < 1 || plan.humanAcceptance !== "final-film-only"
      || !Array.isArray(plan.stages) || plan.stages.join("\0") !== NATIVE_FILM_STAGES.join("\0")
      || !Array.isArray(plan.shots) || !plan.shots.length || new Set(plan.shots.map(shot => shot.shotId)).size !== plan.shots.length
      || plan.shots.some(shot => !isObject(shot) || !isText(shot.shotId) || !Number.isSafeInteger(shot.durationSec) || shot.durationSec <= 0 || !isHash(shot.promptSha256))
      || plan.totalSeconds !== plan.shots.reduce((sum, shot) => sum + shot.durationSec, 0)
      || !Number.isFinite(plan.estimatedReserveCny) || plan.estimatedReserveCny <= 0) {
      throw new FilmServiceClientError("PLAN_RECEIPT_INVALID", "服务计划缺少本次原生来源、完整步骤或预算证据");
    }
    return plan;
  }

  /** Submit only a source version returned by the service; the service freezes its own current native document. */
  async start(input: {
    projectId: string;
    workerName: string;
    sourceVersion: FilmSourceVersion;
    stages?: string[];
    options?: Record<string, unknown>;
    maxBudgetCny?: number;
  }): Promise<FilmJobStartReceipt> {
    if (Object.hasOwn(input, "document") || Object.hasOwn(input, "shots") || Object.hasOwn(input, "prompt")) throw new FilmServiceClientError("CALLER_SOURCE_FORBIDDEN", "公开影片入口不接受调用方分镜或提示词");
    if (!isText(input.projectId) || !isText(input.workerName)) throw new FilmServiceClientError("REQUEST_INVALID", "projectId 与 workerName 必填");
    if (input.stages !== undefined && (!Array.isArray(input.stages) || input.stages.join("\0") !== NATIVE_FILM_STAGES.join("\0"))) {
      throw new FilmServiceClientError("REQUEST_INVALID", "stages 必须是非空字符串数组");
    }
    if (!isObject(input.sourceVersion) || !isText(input.sourceVersion.sourceStageRunId) || !isHash(input.sourceVersion.promptsSha256)
      || !isHash(input.sourceVersion.filmSourceSha256)) throw new FilmServiceClientError("NATIVE_FILM_SOURCE_REQUIRED", "先读取服务原生制作计划");
    const receipt = await this.request<FilmJobStartReceipt>("video.film.start", {
      projectId: input.projectId,
      workerName: input.workerName,
      sourceVersion: input.sourceVersion,
      ...(input.stages ? { stages: input.stages } : {}),
      options: input.options ?? {},
      ...(input.maxBudgetCny !== undefined ? { maxBudgetCny: input.maxBudgetCny } : {}),
    }, "POST");
    if (!isObject(receipt) || !isText(receipt.jobId) || receipt.projectId !== input.projectId
      || !Number.isInteger(receipt.attempt) || receipt.attempt <= 0 || !isText(receipt.runId)
      || receipt.status !== "running" || !isHash(receipt.inputSha256) || !isHash(receipt.workerEntrySha256)
      || !Array.isArray(receipt.stages) || receipt.stages.join("\u0000") !== NATIVE_FILM_STAGES.join("\u0000")
      || !Number.isFinite(Date.parse(String(receipt.startedAt ?? "")))
      || typeof receipt.budgetCny !== "number" || !Number.isFinite(receipt.budgetCny) || receipt.budgetCny < 0) {
      throw new FilmServiceClientError("START_RECEIPT_INVALID", "服务回执不完整或与提交内容不一致");
    }
    return receipt;
  }

  async status(jobId: string): Promise<FilmJobStatus> {
    if (!isText(jobId)) throw new FilmServiceClientError("REQUEST_INVALID", "jobId 必填");
    const value = await this.request<FilmJobStatus>("video.film.status", { jobId }, "GET");
    if (!isObject(value) || value.jobId !== jobId || !isText(value.projectId) || !Number.isInteger(value.attempt) || value.attempt <= 0
      || !isText(value.runId) || !isText(value.workerName) || !JOB_STATES.has(String(value.status))
      || !Array.isArray(value.stages) || !value.stages.every(isText) || !Number.isFinite(Date.parse(String(value.startedAt ?? "")))
      || (value.finishedAt !== null && !Number.isFinite(Date.parse(String(value.finishedAt))))
      || (value.resultSha256 !== null && !isHash(value.resultSha256))
      || !Array.isArray(value.components) || typeof value.reservedCny !== "number" || typeof value.spentCny !== "number") {
      throw new FilmServiceClientError("STATUS_RECEIPT_INVALID", "作业状态回执不完整");
    }
    for (const row of value.components) {
      if (!isObject(row) || !isText(row.component) || !isText(row.stepKey) || !COMPONENT_STATES.has(String(row.state))
        || typeof row.reservedCny !== "number" || (row.actualCny !== null && typeof row.actualCny !== "number")) {
        throw new FilmServiceClientError("STATUS_RECEIPT_INVALID", "组件台账行不完整");
      }
    }
    if (value.status === "finished" && (!isText(value.resultRef) || !isHash(value.resultSha256))) {
      throw new FilmServiceClientError("STATUS_RECEIPT_INVALID", "已完成作业缺少结果引用与摘要");
    }
    return value;
  }

  /** 轮询到终态；轮询上限用尽返回最新状态（调用方按 running 处理，不得自动重发）。 */
  async wait(jobId: string, options: {
    pollRounds?: number;
    pollIntervalMs?: number;
    onProgress?: (status: FilmJobStatus) => void | Promise<void>;
    wait?: (ms: number) => Promise<void>;
  } = {}): Promise<FilmJobStatus> {
    const rounds = options.pollRounds ?? 240;
    const interval = options.pollIntervalMs ?? 10_000;
    if (!Number.isInteger(rounds) || rounds <= 0 || rounds > 1_000 || !Number.isFinite(interval) || interval < 0 || interval > 120_000) {
      throw new FilmServiceClientError("POLL_INVALID", "轮询参数非法");
    }
    const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let status = await this.status(jobId);
    await options.onProgress?.(status);
    for (let round = 0; round < rounds && status.status === "running"; round += 1) {
      await wait(interval);
      status = await this.status(jobId);
      await options.onProgress?.(status);
    }
    return status;
  }
}
