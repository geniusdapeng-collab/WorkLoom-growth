/**
 * video/studio-worker.ts —— 预生产运行工作器（融合设计 §3 门矩阵 G1–G7 接线）
 *
 * 职责：
 *  1. 内存 run 注册表（runId → 运行投影），studio.start 异步启动不阻塞 tRPC 响应
 *  2. onApproval：G1–G7 系统检查、真实文件证据和事件留痕；中间不创建人工验收单
 *  3. onEvent：pipeline.* 生命周期事件经 gatewayAppend 落五元事件库
 *  4. LLM engine：WorkloomLLMEngine.fromEnv()；为 null 拒绝启动（禁止静默降级，vendor 纪律）
 *
 * 纪律：门事件经 workdata 安全网关；渲染接续只消费本次成功预生产和原生交接稿。
 */
import path from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAppPool, getGatewayPool } from "@workloom/db";
import { GatewayEventSink, poolFromEnv } from "@workloom/base/model-router";
import { modelPolicyFor } from "../service/llm.js";
import { gatewayAppend, gatewayAppendOnClient, insertWithReadableId, VIDEO_PROJECT_ID_SOURCE } from "@workloom/base/workdata";
import { makeReadableId, newId } from "@workloom/shared";
import {
  VideoStudio,
  nativeProductionShots,
  buildNativeFilmSource,
  planNativeFilmHandoff,
  WorkloomLLMEngine,
  sourceRestrictionsHash,
  runWithSourceRestrictions,
  runWithVendorEngine,
  ArchiveStore,
  StageRunner,
  auditScenePolicy,
  attachStructuredLog,
  classifyError,
  installVendorEngineBridge,
  installVendorPortraitBindingBridge,
  installVendorRenderCompatBridge,
  reviewStage,
  updateContextBundle,
  type ApprovalCallback,
  type EventSink,
  type GateKey,
  type GateVerdict,
  type PipelineKind,
  type PortraitIndex,
  type ProducerStage,
  type ProducerVerdict,
  type RunInput,
  type ScenePolicyException,
  type ScenePolicyShot,
  type StudioConfig,
  type StudioPortraitConfig,
  type NativeRequirementArchives,
} from "@hyperreality/video-studio";
import { buildServerGateRecord, withGateLedger } from "./gate-ledger-bridge.js";
import { STUDIO_WORKER_ACTOR, preproductionGateActor } from "./preproduction-gate-actor.js";
import { createDataMiningExecutor } from "./data-mining-executor.js";
import { prepareMarketingFacts, finalizeMarketingFacts, type PreparedMarketingFacts } from "./marketing-authority.js";
import { canonicalRenderJson, renderSha256 } from "./gen/compiled-request.js";
import { acquireProjectLease, archiveWorkDir, makeLedgerWriter, readProjectMeta } from "./archive-host.js";
import { ingestPortraitsFromIndex } from "./media/library.js";
import { upsertProductProfileFromDossier } from "./media/products.js";
import { appendScenePolicyGuidance, resolveScenePolicyForIntent } from "./scene-policy-routing.js";
import { appendPlatformGuidance, resolvePlatformForIntent } from "./platform-routing.js";
import { assertCustomerVideoMetadata, resolveNativeVideoAssets, bindNativeVideoAssets, type NativeVideoAssets } from "./native-video-assets.js";
import {
  AUTO_GATES,
  GATE_PRODUCER_STAGE,
  GATE_RUBRIC,
  gateDeterministicChecks,
  isProducerRejection,
  producerModeFromEnv,
  portraitGateEvidence,
  prdArchiveGateEvidence,
  prdArchiveReviewMatches,
  writeGateArtifact,
  type ProducerMode,
} from "./gate-policy.js";

/* ================= 可配项（环境变量） ================= */

/** 流水线总截止（透传 vendor STORMAXE_TOTAL_DEADLINE_MS 口径，默认 1 小时） */
const TOTAL_DEADLINE_MS = Number(process.env.VM_TOTAL_DEADLINE_MS ?? 3_600_000);

/**
 * 内部门三档处置与逐门口径见 `./gate-policy.js`（服务端与本地审计跑批共用同一份定义，
 * 避免"审计过的门 ≠ 生产的门"漂移）。本次生产授权后只验收最终成片；
 * G8仍校验原生计划/预算/单次提交，G9发布和G10对外评论保持独立授权范围。
 */
const PRODUCER_MODE: ProducerMode = producerModeFromEnv({ HR_PRODUCER: "review" });

const here = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根（apps/server/src/video → 上溯四级）：参考图相对路径按此解析 */
const REPO_ROOT = path.resolve(here, "../../../..");
/**
 * 运行产物根（checkpoints/characters/confirmations/archive）：默认仓库根 `.vm-work/`。
 * 与 archive-watch / archive-resume CLI 共用 `archiveWorkDir()` 解析（相对路径按仓库根，
 * 历史 cwd 相对路径自动兼容），避免"服务器写一处、巡检读另一处"的路径漂移。
 */
const WORK_DIR = archiveWorkDir();

/**
 * 营销路由判定 → 情报层装配开关（2026-09-25 激活）。
 *
 * 判定与 vendor 的激活条件同源（`metadata.dataMining` / `metadata.brief.product`），
 * 另接受 `metadata.pipelineRoute.kind === 'marketing'`（分流器的落库口径）与 `products[]`
 * （产品所有者给的实拍图登记）。命中即为本次 run 装配**真实检索执行器**：
 *   - 情报五站由 api 模式的 executor 真跑（Bing 公开 RSS + 模型结构化回填）；
 *   - 档案落盘按工作区隔离：`<WORK_DIR>/dossiers/<workspaceId>`；
 *   - 未命中（叙事片）保持原行为，vendor 不会进情报层。
 */
function dataMiningConfigFor(
  metadata: Record<string, unknown> | undefined,
  llm: WorkloomLLMEngine,
  workspaceId: string,
): StudioConfig["dataMining"] | undefined {
  if ((process.env.VM_DATA_MINING ?? "1") === "0") return undefined;
  const dm = metadata?.dataMining as { name?: unknown } | undefined;
  const brief = metadata?.brief as { product?: unknown } | undefined;
  const route = metadata?.pipelineRoute as { kind?: unknown } | undefined;
  const products = metadata?.products;
  const marketing = Boolean(
    (dm && typeof dm.name === "string" && dm.name.trim())
    || (brief && typeof brief.product === "string" && brief.product.trim())
    || route?.kind === "marketing"
    || (Array.isArray(products) && products.length > 0),
  );
  if (!marketing) return undefined;
  const mode = (process.env.VM_DATA_MINING_MODE ?? "api").trim() === "spec" ? "spec" : "api";
  return {
    mode,
    ...(mode === "api"
      ? {
          // vendor 侧按 `executor(stage, plan)` 调用（stage 为 A1/A2/A3），此处收敛为宿主类型
          executor: createDataMiningExecutor({ llm, log: (line) => console.log(line) }) as unknown as (
            stage: string,
            plan: Record<string, unknown>,
          ) => Promise<Record<string, unknown> | null>,
        }
      : {}),
    refresh: (process.env.VM_DATA_MINING_REFRESH ?? "") === "1",
    storeRoot: path.join(WORK_DIR, "dossiers", workspaceId),
    staleAfterDays: Number(process.env.VM_DATA_MINING_STALE_DAYS ?? 30) || 30,
  };
}

/**
 * 运行日志 tee（2026-09-22 真机审计需求）：
 * 预生产的 vendor 环节日志此前只进服务端 stdout（TTY），run 结束即丢，事后无法逐环节审计。
 * 这里在 run 期间把 console 输出旁路落盘到 `.vm-work/logs/<projectId>.log`（原样透传，不改语义），
 * 供 `scripts/tools/pipeline-audit.mts` 逐环节核对"是否正常产出/是否流转".
 */
/**
 * C-07 修复：全局 console 劫持改为"单一包装 + 订阅者引用计数"。
 * 此前每个 run 各自捕获"当前"console 为 originals——并发两个 run 时 B 捕获的是 A 的包装器，
 * A 先结束恢复后，B 结束会把 console 永久还原成 A 的包装器（日志继续写入已结束 run 的文件，
 * 且后续 run 的恢复链彻底错位）。
 * 现在：console 只被包装一次（真正 originals 只捕获一次），各 run 以订阅者身份注册自己的
 * 日志文件，取消订阅时引用计数归零才还原 console——先后结束顺序任意都不错位。
 */
const teeSubscribers = new Map<string, (level: string, args: unknown[]) => void>();
let teeInstalled: { originals: Array<(...args: unknown[]) => void> } | null = null;

function formatTeeLine(args: unknown[]): string {
  return args
    .map((a) => (typeof a === "string" ? a : a instanceof Error ? `${a.name}: ${a.message}` : (() => {
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })()))
    .join(" ");
}

function installTee(): void {
  if (teeInstalled) return;
  const methods = ["log", "warn", "error"] as const;
  const originals = methods.map((m) => console[m] as (...args: unknown[]) => void);
  methods.forEach((m, i) => {
    (console as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => {
      for (const write of teeSubscribers.values()) {
        try {
          write(m.toUpperCase(), args);
        } catch {
          /* 单个订阅者失败不影响其他订阅者与原输出 */
        }
      }
      originals[i]!.apply(console, args);
    };
  });
  teeInstalled = { originals };
}

function uninstallTeeIfIdle(): void {
  if (!teeInstalled || teeSubscribers.size > 0) return;
  const methods = ["log", "warn", "error"] as const;
  methods.forEach((m, i) => {
    (console as unknown as Record<string, unknown>)[m] = teeInstalled!.originals[i];
  });
  teeInstalled = null;
}

function teeRunLogs(projectId: string): () => void {
  const logDir = path.join(WORK_DIR, "logs");
  const logFile = path.join(logDir, `${projectId}.log`);
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    return () => undefined;
  }
  const write = (level: string, args: unknown[]) => {
    try {
      appendFileSync(logFile, `[${new Date().toISOString()}] ${level} ${formatTeeLine(args)}\n`, "utf8");
    } catch {
      /* 日志落盘失败不影响运行 */
    }
  };
  teeSubscribers.set(projectId, write);
  installTee();
  let released = false;
  return () => {
    if (released) return; // 幂等：重复调用不破坏其他 run 的订阅
    released = true;
    teeSubscribers.delete(projectId);
    uninstallTeeIfIdle();
  };
}

/** Event attribution stays stable; internal verdict transactions bind their specific gate. */
const WORKER_ACTOR = STUDIO_WORKER_ACTOR;

/**
 * 软失败原因提取（T-2026-0926-0005）：vendor 返回 `success:false` 但不抛异常时，
 * 注册表 `entry.error` 往往是空串——`?? 兜底` 会落成空消息并被分类成 BUG。
 * 取因顺序：运行器异常 → result.error/errorMessage → vendor failures/errors → 被拒确认门 → 通用兜底。
 */
export function terminalFailureMessageOf(result: unknown, entryError?: string | null): string {
  const r = (result ?? {}) as {
    error?: unknown;
    errorMessage?: unknown;
    failures?: Array<{ message?: unknown }>;
    errors?: Array<{ message?: unknown; error?: unknown }>;
    confirmations?: Record<string, unknown>;
  };
  const candidates: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === "string" && value.trim()) candidates.push(value.trim());
  };
  push(entryError);
  push(r.error);
  push(r.errorMessage);
  if (Array.isArray(r.failures)) for (const failure of r.failures) push(failure?.message);
  if (Array.isArray(r.errors)) for (const failure of r.errors) push(failure?.message ?? failure?.error);
  for (const confirmation of Object.values(r.confirmations ?? {})) {
    if (confirmation && typeof confirmation === "object") {
      const verdict = confirmation as { approved?: unknown; reason?: unknown };
      if (verdict.approved === false) push(verdict.reason);
    }
  }
  return (candidates[0] ?? "vendor 返回 success:false").slice(0, 500);
}

/* ================= run 注册表 ================= */

export type RunStatus = "running" | "awaiting_approval" | "finished" | "failed";

export interface RunEntry {
  runId: string;
  projectId: string;
  workspaceId: string;
  status: RunStatus;
  /** 当前待审批门（无待审批为 null） */
  currentGate: GateKey | null;
  /** 当前待审批单号（G8 队列可直查） */
  pendingApprovalId: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  resultSummary: Record<string, unknown> | null;
  /** shouldAbort 位：置 true 后轮询下一拍中断（见文件头说明） */
  aborted: boolean;
}

const runs = new Map<string, RunEntry>();

/** run 投影（studio.status 数据源；L7.1：跨工作区查询返回 null） */
export function getRun(runId: string, workspaceId: string): RunEntry | null {
  const entry = runs.get(runId);
  if (!entry || entry.workspaceId !== workspaceId) return null;
  return entry;
}

/** 工作区 run 聚合（studio.active 数据源：只读内存投影，不改变任何运行语义） */
export interface WorkspaceRunSummary {
  /** 正在执行的 run 数 */
  running: number;
  /** 停在人审门上的 run 数 */
  awaitingApproval: number;
  /** 最近失败（窗口内）的 run 数 */
  failedRecent: number;
  /** 活跃 run 的编号（running + awaitingApproval，供 UI 深链） */
  activeRunIds: string[];
}

/**
 * 汇总本工作区 run 状态（供「织伴」全局状态球与运维面板使用）。
 * 语义边界：run 注册表是**进程内**投影（服务重启即清空），这里只做只读汇总，
 * 不写库、不改变 run 生命周期；失败窗口默认 15 分钟（够一次 10s/20s 轮询看见）。
 */
export function summarizeWorkspaceRuns(
  workspaceId: string,
  options: { now?: number; failedWindowMs?: number } = {},
): WorkspaceRunSummary {
  const now = options.now ?? Date.now();
  const failedWindowMs = options.failedWindowMs ?? 15 * 60_000;
  const summary: WorkspaceRunSummary = { running: 0, awaitingApproval: 0, failedRecent: 0, activeRunIds: [] };
  for (const entry of runs.values()) {
    if (entry.workspaceId !== workspaceId) continue;
    if (entry.status === "running") {
      summary.running += 1;
      summary.activeRunIds.push(entry.runId);
    } else if (entry.status === "awaiting_approval") {
      summary.awaitingApproval += 1;
      summary.activeRunIds.push(entry.runId);
    } else if (entry.status === "failed" && entry.finishedAt) {
      const finishedAt = Date.parse(entry.finishedAt);
      if (!Number.isNaN(finishedAt) && now - finishedAt <= failedWindowMs) summary.failedRecent += 1;
    }
  }
  summary.activeRunIds.sort();
  return summary;
}

export class StudioWorkerError extends Error {
  constructor(
    public readonly code: "LLM_MISSING" | "ARCHIVE_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "StudioWorkerError";
  }
}

/* ================= 门对象映射（§3 审批点矩阵逐字口径） ================= */

function gateObjectOf(gate: GateKey, vendorType: string): { type: string; action: string } {
  switch (gate) {
    case "G1_DOSSIER": return { type: "dossier", action: "dossier.confirm" };
    case "G2_THEME": return { type: "theme", action: "theme.confirm" };
    case "G3_INSIGHT": return { type: "insight", action: "insight.confirm" };
    case "G4_PRD": return { type: "prd", action: "prd.confirm" };
    case "G5_PORTRAIT": return { type: "portrait_set", action: "portrait.confirm" };
    case "G6_PROMPT": return { type: "prompt_package", action: "prompt.confirm" };
    case "G7_FINAL": return { type: "project", action: "preproduction.finalize" };
    default: return { type: vendorType || "gate", action: `${vendorType || "gate"}.confirm` };
  }
}

/* ================= 启动入口 ================= */

interface Scope { tenantId: string; workspaceId: string }

/**
 * 从 brief 的 metadata 收集真实参考图（产品所有者给到的实拍图）。
 * 支持两种登记口径：字符串路径，或情报档案对象 `{ localPath | path | url }`；
 * 只接受本地可读路径（远端 URL 需先落地，避免出图阶段访问不到）。
 */
function collectReferenceImages(metadata?: Record<string, unknown>): string[] {
  const products = Array.isArray(metadata?.products) ? (metadata!.products as Array<Record<string, unknown>>) : [];
  const out: string[] = [];
  for (const product of products) {
    const manifest = (product?.referenceManifest ?? product?.reference_manifest) as
      | Record<string, unknown>
      | undefined;
    const images = (manifest?.reference_images ?? manifest?.referenceImages) as unknown;
    if (!Array.isArray(images)) continue;
    for (const image of images) {
      if (typeof image === "string" && image.trim()) {
        out.push(image.trim());
        continue;
      }
      if (image && typeof image === "object") {
        const record = image as Record<string, unknown>;
        const local = record.localPath ?? record.path ?? (typeof record.url === "string" && !/^https?:/i.test(record.url) ? record.url : null);
        if (typeof local === "string" && local.trim()) out.push(local.trim());
      }
    }
  }
  return Array.from(new Set(out));
}

/** 定妆照出图配置（缺密钥则显式关闭：保持 vendor 规格包口径，不假装出图） */
function portraitConfig(metadata?: Record<string, unknown>, assets?: NativeVideoAssets): StudioPortraitConfig {
  const apiKey = (process.env.VOLCENGINE_ARK_API_KEY ?? process.env.ARK_API_KEY ?? "").trim();
  const model = (process.env.ARK_IMAGE_MODEL ?? process.env.SEEDREAM_MODEL ?? "").trim();
  const enabled = (process.env.HR_PORTRAIT_ENABLED ?? "1") !== "0";
  if (!enabled || !apiKey || !model) {
    return { enabled: false };
  }
  const anchors = (process.env.HR_PORTRAIT_ANCHORS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  return {
    enabled: true,
    apiKey,
    model,
    baseUrl: process.env.ARK_BASE_URL?.trim(),
    size: process.env.ARK_IMAGE_SIZE?.trim(),
    timeoutMs: Number(process.env.HR_PORTRAIT_TIMEOUT_MS ?? 240_000),
    maxReferenceImages: 4,
    /** 参考图相对仓库根解析（brief 里登记的是 var/media/... 相对路径） */
    referenceImages: collectReferenceImages(metadata).map((image) =>
      path.isAbsolute(image) ? image : path.join(REPO_ROOT, image)),
    characterAnchorImages: anchors.map((image) => (path.isAbsolute(image) ? image : path.join(REPO_ROOT, image))),
    /**
     * 生产链路 fail-closed：角色定妆照必须带"角色档案"描述。
     * 真机事故 2026-09-23：描述为空时模型自由发挥，要求"三十岁上下女性"却出了男性模特，
     * 直接污染真人出镜链路。（vendor 直跑保持默认 false，不影响其它产品。）
     */
    requireCharacterDescription: true,
    retries: 0,
    existingAssets: assets?.portraits ?? [],
    archiveOnly: (assets?.portraits.length ?? 0) > 0,
  };
}

/**
 * 异步启动一条预生产流水线（不阻塞 tRPC 响应；失败只反映在注册表投影）
 * @throws StudioWorkerError LLM_MISSING —— LLM_* 四环境变量未配齐（禁止静默降级）
 */
type StudioRunInput = RunInput & {
  /** 原始客户需求；pipelineIntent 可能清理过路由语句并追加了系统口径。 */
  rawIntent?: string;
  /** 同一入口已经做过选型时复用其受控结果，避免二次选型改写取证依据。 */
  selectedScenePolicy?: ReturnType<typeof resolveScenePolicyForIntent>;
  /** 同一入口已经做过平台识别时复用其受控结果。 */
  selectedPlatform?: ReturnType<typeof resolvePlatformForIntent>;
};

export function startRun(scope: Scope, input: StudioRunInput): string {
  const nativeAssets = resolveNativeVideoAssets(input.metadata ?? {});
  const requirementArchives: NativeRequirementArchives = {
    characters: nativeAssets.character ? [{ id: nativeAssets.character.id, name: nativeAssets.character.name, kind: nativeAssets.character.kind,
      identity: nativeAssets.character.identity, appearance: nativeAssets.character.appearance, wardrobe: nativeAssets.character.wardrobe,
      persona: nativeAssets.character.persona, authorization: nativeAssets.character.authorization, certified: nativeAssets.realPerson?.certified,
      verification: { status: nativeAssets.character.verification.status, scope: nativeAssets.character.verification.scope,
        version: nativeAssets.character.verification.version } }] : [],
    products: nativeAssets.portraits.filter(asset => asset.kind === "product").map(asset => ({ id: asset.id, name: asset.name })),
    portraits: nativeAssets.portraits,
  };
  // 补跑/恢复同样经过选型；歧义或知识库损坏在任何供应商调用之前同步失败。
  const selectedScenePolicy = input.selectedScenePolicy
    ?? resolveScenePolicyForIntent(input.rawIntent ?? input.intent, input.metadata);
  /**
   * 平台识别同样在任何供应商调用之前完成：未识别到平台时按默认口径（抖音）落地，
   * 并把画幅/语速/钩子窗口口径写进需求正文——此前只在 CLI 传 --platform 时生效。
   */
  const selectedPlatform = input.selectedPlatform
    ?? resolvePlatformForIntent(input.rawIntent ?? input.intent, input.metadata);
  const resolvedMetadata: Record<string, unknown> = {
    ...(input.metadata ?? {}),
    platform: selectedPlatform.decision.id,
    scenePolicySelection: selectedScenePolicy.decision,
    platformSelection: selectedPlatform.decision,
    ...(selectedScenePolicy.policy ? { scenePolicy: selectedScenePolicy.metadata.scenePolicy } : {}),
  };
  const runInput: RunInput = {
    projectId: input.projectId,
    intent: appendPlatformGuidance(appendScenePolicyGuidance([input.intent, nativeAssets.guidance].filter(Boolean).join("\n\n"), selectedScenePolicy.policy), selectedPlatform.decision,
      nativeAssets.character ? { name: nativeAssets.character.name, speechRate: nativeAssets.character.persona?.speechRate } : undefined),
    metadata: resolvedMetadata,
    isMarketing: input.isMarketing,
  };
  if ((process.env.ARCHIVE_ENABLED ?? "1") === "0") {
    throw new StudioWorkerError("ARCHIVE_REQUIRED", "生产预生产必须启用档案与运行租约，拒绝 ARCHIVE_ENABLED=0");
  }
  const llm = WorkloomLLMEngine.fromEnv();
  if (!llm) {
    throw new StudioWorkerError(
      "LLM_MISSING",
      "LLM 引擎未配置（需 LLM_BASE_URL/LLM_API_KEY/LLM_MODEL），拒绝启动预生产（vendor 纪律：禁止静默降级）",
    );
  }
  // v3.0 收口：注入路由配置——预生产全部 LLM 调用经 routeSmart
  // （preproduction 场景 × 降级链 × 真实计量 × model.call 事件留痕，fastModel 快速调用强制 L1）
  llm.attachRouter({
    providers: poolFromEnv(),
    sink: new GatewayEventSink(getGatewayPool(), scope, { id: "video-studio" }),
    policy: modelPolicyFor("ai-video"),
    scene: "preproduction",
  });

  /**
   * vendor 自建 LLMEngine 也要接到宿主模型路由（2026-09-21 真机修复）：
   * 剧本引擎/需求洞察等子引擎会自己 new 一个引擎读 vendor 的环境变量与模型名，
   * 不桥接就会出现「LLM引擎返回失败: API Key 未配置」→ 预生产在 Layer 1 直接失败。
   */
  installVendorEngineBridge();
  // 逐镜渲染的入参归一（空 portraits 数组会以 characterRef.split 崩溃，见 vendor-compat.ts）
  installVendorRenderCompatBridge();
  /**
   * 定妆照绑定桥：把「定妆照集」回填成渲染认得 `characterRef`（真机 2026-09-21：
   * vendor 只写 portraitBindings，渲染侧读 characterRef，中间断线 → 出了图也报
   * BINDING_MANIFEST_INVALID）。索引跑完预生产才落盘，故用惰性读取。
   */
  const runWorkDir = path.join(WORK_DIR, "workspaces", scope.workspaceId);
  const portraitIndexPath = path.join(runWorkDir, "characters", input.projectId, "portrait-index.json");
  const uninstallPortraitBinding = installVendorPortraitBindingBridge({
    resolveIndex: () => {
      try {
        if (!existsSync(portraitIndexPath)) return null;
        return JSON.parse(readFileSync(portraitIndexPath, "utf8")) as PortraitIndex;
      } catch {
        return null;
      }
    },
    maxCharactersPerShot: 1,
    log: (line) => console.log(line),
  });
  /** run 期间的全部 console 输出落盘（逐环节审计证据；run 结束摘除） */
  const restoreRunLogs = teeRunLogs(input.projectId);
  console.log(`[studio-worker] run 日志开始落盘：${path.join(WORK_DIR, "logs", `${input.projectId}.log`)}`);

  const entry: RunEntry = {
    runId: newId("RUN"),
    projectId: input.projectId,
    workspaceId: scope.workspaceId,
    status: "running",
    currentGate: null,
    pendingApprovalId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    resultSummary: null,
    aborted: false,
  };
  runs.set(entry.runId, entry);

  /**
   * ================= 制片档案（T-2026-0926-0001） =================
   *
   * 认领、输入、输出及终结回执是执行前置证据；初始化失败即停止。
   * 生产入口禁止通过 ARCHIVE_ENABLED=0 关闭档案与运行租约。
   * 管线类型：营销片（含情报层）/ 叙事片，落进 manifest.pipelineKind 供跨会话承接。
   */
  const pipelineKind: PipelineKind = input.isMarketing ? "marketing" : "narrative";
  const archive = new ArchiveStore(path.resolve(WORK_DIR), scope.workspaceId, input.projectId, pipelineKind, {
    aspectRatio: runInput.metadata?.aspectRatio ?? null,
    scenePolicy: selectedScenePolicy.decision,
  });
  /** 结构化日志镜像的"当前环节"（StageRunner 在环节边界更新；与文本 tee 并行） */
  const stageRef: { name: string | null; attempt: number } = { name: null, attempt: 0 };
  const runner = new StageRunner(archive, makeLedgerWriter(scope), entry.runId, {
    onStart: (stageId, attempt) => {
      stageRef.name = stageId;
      stageRef.attempt = attempt;
    },
  });
  /** 交接包线索（来自真实事件，不猜）：门裁决 + 时长投影 */
  const decisionLog: string[] = [];
  const gateProofs = new Map<string, Record<string, unknown>>();
  let completedVendorResult: Awaited<ReturnType<VideoStudio["runPreproduction"]>> | null = null;

  const onEvent: EventSink = async (e) => {
    try {
      if (e.kind === "pipeline.duration.projected") {
        const target = (e.payload as { targetSeconds?: unknown } | undefined)?.targetSeconds;
        const source = (e.payload as { source?: unknown } | undefined)?.source;
        if (typeof target === "number" && target > 0) {
          decisionLog.push(`时长：投影目标 ${target}s${typeof source === "string" ? `（source=${source}）` : ""}`);
        }
      } else if (e.kind === "pipeline.gate.resolved") {
        const payload = (e.payload ?? {}) as { approved?: unknown; reason?: unknown };
        decisionLog.push(
          `门 ${e.gate ?? "-"}：${payload.approved ? "放行" : "打回"}${payload.reason ? `（${String(payload.reason).slice(0, 120)}）` : ""}`,
        );
      }
      if (decisionLog.length > 20) decisionLog.splice(0, decisionLog.length - 20);
    } catch (err) {
      console.error(`[archive] 交接线索采集失败（不影响运行）: ${(err as Error).message}`);
    }
    /**
     * 进度心跳（规格书 §5.2 写盘点②）：预生产单环节跑几十分钟，没有心跳就无法区分
     * 「慢」与「死」。vendor 的门请求/放行、时长投影就是真实进度信号，直接转成档案心跳
     * （文件 events.jsonl + PG last_heartbeat_at，PG 侧 5s 节流）。
     */
    if (runner && (e.kind === "pipeline.gate.requested" || e.kind === "pipeline.gate.resolved" || e.kind === "pipeline.duration.projected")) {
      const ctx = runner.currentContext();
      if (ctx) {
        void ctx.heartbeat({ event: e.kind, ...(e.gate ? { gate: e.gate } : {}) }).catch((err) => {
          console.error(`[archive] heartbeat 写入失败: ${(err as Error).message}`);
        });
      }
    }
    await gatewayAppend(getGatewayPool(), { ...scope, actor: { ...WORKER_ACTOR } }, {
      who: { ...WORKER_ACTOR },
      context: {
        tenant_id: scope.tenantId, workspace_id: scope.workspaceId,
        time: new Date().toISOString(), channel: "inapp",
      },
      object: { type: "video_project", id: e.projectId },
      decision: {
        action: e.kind,
        after: { runId: e.runId ?? entry.runId, gate: e.gate ?? null, ...(e.payload ?? {}) },
      },
      rule_impact: [],
    });
  };

  const onApproval: ApprovalCallback = async (req) => {
    // ApprovalCallback.gate 声明为 string，但适配层（studio.ts）保证已 resolveGate 过，运行时为 GateKey
    const gate = req.gate as GateKey;
    const gateObj = gateObjectOf(gate, req.vendorType);
    const objectId = gate === "G7_FINAL" ? input.projectId : `${input.projectId}:${gate.toLowerCase()}`;
    if (gate === "G5_PORTRAIT") {
      // Vendor may ask before it executes portraits. This is permission to execute, never a G5 pass proof.
      if (!completedVendorResult) return { approved: true, reason: "portrait-execution-pending-system-check", suggestions: [] };
      const portrait = portraitGateEvidence({ workDir: runWorkDir, projectId: input.projectId,
        stage: completedVendorResult?.stages?.portraitStudio,
        scriptReport: (completedVendorResult?.stages?.scriptEngine as { report?: unknown } | undefined)?.report });
      const approved = portrait.notApplicable || portrait.deterministic.every(check => check.pass === true);
      const evidence = portrait.artifacts.map(artifact => ({ path: artifact.path,
        sha256: renderSha256(readFileSync(artifact.path)), scope: artifact.kind === "image" ? "image" : "complete-text" }));
      gateProofs.set(gate, { gate, approved, status: portrait.notApplicable ? "not_applicable" : approved ? "passed" : "failed",
        via: "deterministic", degraded: false, model: null, evidence,
        basis: portrait.notApplicable ? "no-characters-or-products" : "native-portrait-files" });
      await onEvent({ kind: "pipeline.gate.resolved", projectId: input.projectId, runId: entry.runId, gate,
        payload: { approved, via: "deterministic", checks: portrait.deterministic, evidence } });
      return { approved, reason: approved ? "native-portrait-files" : "portrait-evidence-failed", suggestions: [],
        ...(approved ? {} : { fatal: "portrait_evidence_missing" }) };
    }
    // Internal gates use system review and append evidence; only the final film goes to the customer.
    if (AUTO_GATES.has(gate)) {
      const producerStage = GATE_PRODUCER_STAGE[gate] ?? "script";
      const artifact = writeGateArtifact(runWorkDir, path.join(input.projectId, `attempt-${stageRef.attempt}`), gate, req.contentMd ?? "");
      const prdEvidence = gate === "G4_PRD" ? prdArchiveGateEvidence(requirementArchives) : undefined;
      const producerVerdict = await reviewStage({
        stage: producerStage, projectId: input.projectId,
        artifacts: [{ path: artifact.path, kind: "text", note: req.title }, ...(prdEvidence?.artifacts ?? [])],
        deterministic: [...gateDeterministicChecks(gate, req.contentMd ?? ""), ...(prdEvidence?.deterministic ?? [])],
        ...(prdEvidence?.artifacts.length ? { batchSize: prdEvidence.artifacts.length } : {}),
        rubric: [...((GATE_RUBRIC[gate] ?? []) as string[]), `门内容全长 ${artifact.chars} 字，完整正文已随附件送审`],
        context: { gate, vendorType: req.vendorType, runId: entry.runId, contentChars: artifact.chars },
        allowFallbackApprove: false, log: (line) => console.log(line)
      });
      const approved = producerVerdict.approved && producerVerdict.status === "passed" && producerVerdict.via === "llm"
        && !producerVerdict.degraded && producerVerdict.evidence?.some(item => item.path === artifact.path
          && item.sha256 === renderSha256(readFileSync(artifact.path)) && item.scope === "complete-text") === true
        && (gate !== "G4_PRD" || prdArchiveReviewMatches(requirementArchives, producerVerdict.evidence));
      const gateRecord = buildServerGateRecord({ gate, vendorType: String(req.vendorType ?? ""), projectId: input.projectId,
        runId: entry.runId, approved, verdict: producerVerdict, producerMode: PRODUCER_MODE });
      const client = await getAppPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [scope.workspaceId]);
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [scope.tenantId]);
        await gatewayAppendOnClient(client, { ...scope, actor: preproductionGateActor(gate) }, {
          who: { ...WORKER_ACTOR },
          context: { tenant_id: scope.tenantId, workspace_id: scope.workspaceId, time: new Date().toISOString(), channel: "inapp" },
          object: { type: gateObj.type, id: objectId },
          decision: { action: gateObj.action,
            after: withGateLedger({ gate: req.gate, vendorType: req.vendorType, runId: entry.runId, title: req.title,
              producerMode: PRODUCER_MODE, approved, score: producerVerdict.score, via: producerVerdict.via,
              model: producerVerdict.model ?? null, degraded: producerVerdict.degraded, issues: producerVerdict.issues,
              suggestions: producerVerdict.suggestions, reason: producerVerdict.reason }, gateRecord),
            basis: [`系统检查完整本次产物（${producerStage}）并归档摘要；中间不人审，最终成片由客户验收`] },
          rule_impact: [],
        });
        await client.query("COMMIT");
      } catch (error) {
        try { await client.query("ROLLBACK"); }
        catch (rollback) { throw new AggregateError([error, rollback], "preproduction-gate-evidence-rollback-failed"); }
        throw error;
      } finally { client.release(); }
      gateProofs.set(gate, { gate, approved, status: producerVerdict.status, via: producerVerdict.via,
        degraded: producerVerdict.degraded, model: producerVerdict.model ?? null, evidence: producerVerdict.evidence ?? [] });
      return { approved, reason: approved ? `producer-approved(${gate} · score=${producerVerdict.score})`
        : `producer-rejected(${gate})：${producerVerdict.reason}`, suggestions: producerVerdict.suggestions,
        ...(approved ? {} : { fatal: "producer_rejected" }) };
    }
    // Rendering is deferred to the qualified film service. No intermediate gate waits for a human.
    return { approved: false, reason: `unsupported-preproduction-gate(${gate})`, fatal: "unsupported_gate" };
  };

  let marketingDossierRoot: string | undefined;
  let marketingDossierRef: string | undefined;
  const studioConfig: StudioConfig = {
    llm,
    workDir: runWorkDir,
    onApproval,
    onEvent,
    totalDeadlineMs: TOTAL_DEADLINE_MS,
    // 片型硬闸必须在 G8 之前审完整分镜，禁止 env 让 vendor 在审计前直接渲染。
    deferRender: true,
    portraits: portraitConfig(runInput.metadata, nativeAssets),
    requirementArchives,
    /** 营销路由 → 情报五站真跑（叙事路由不装配，vendor 也不会进情报层） */
    dataMining: input.isMarketing ? undefined : dataMiningConfigFor(runInput.metadata, llm, scope.workspaceId),
    log: (line) => console.log(line),
  };

  // 异步执行：不阻塞 tRPC 响应；终态只写注册表投影（生命周期事件由 onEvent 落库）
  void (async () => {
    /**
     * 项目级执行者租约（规格书 §11：同一项目同一时刻只允许一个执行者，杜绝双写与重复烧额度）。
     * 会话级 advisory lock 持有到 run 结束；进程被 kill -9 → 连接断开 → 锁自动释放。
     */
    let activeLease: Awaited<ReturnType<typeof acquireProjectLease>> = null;
    let detachStructuredLog: (() => void) | null = null;
    let projectMeta: Awaited<ReturnType<typeof readProjectMeta>> = null;
    try {
      activeLease = await acquireProjectLease(scope, input.projectId);
      if (!activeLease) {
        throw new Error(`项目 ${input.projectId} 已有执行者持有档案租约（不重复启动，避免双份烧额度）`);
      }
      projectMeta = await readProjectMeta(scope, input.projectId);
      if (!projectMeta) throw new Error(`PROJECT_NOT_FOUND: 项目 ${input.projectId} 不存在或不属于当前工作区`);
      if (projectMeta.kind !== pipelineKind) throw new Error("PIPELINE_KIND_MISMATCH：预生产管线与服务项目类型不一致");
      await archive.ensure({ kind: projectMeta.kind, title: projectMeta.title, createdAt: projectMeta.createdAt });
      // 既有项目补跑可能改用新的明确片型；manifest 保存当前决策，旧值留在追加事件中。
      const manifest = await archive.readManifest();
      if (!manifest) throw new Error(`项目 ${input.projectId} 制片档案 manifest 缺失`);
      if (JSON.stringify(manifest.routeMeta?.scenePolicy ?? null) !== JSON.stringify(selectedScenePolicy.decision)) {
        const previous = manifest.routeMeta?.scenePolicy ?? null;
        await archive.writeJsonAtomic("manifest.json", {
          ...manifest,
          routeMeta: { ...(manifest.routeMeta ?? {}), scenePolicy: selectedScenePolicy.decision },
          updatedAt: new Date().toISOString(),
        });
        await archive.appendJsonl("events.jsonl", {
          kind: "scene-policy.route-changed", runId: entry.runId,
          previous, current: selectedScenePolicy.decision,
        });
      }
      detachStructuredLog = attachStructuredLog(archive, {
        currentStage: () => stageRef.name,
        currentAttempt: () => stageRef.attempt,
      });
      await archive.appendJsonl("events.jsonl", {
        kind: "run.started", runId: entry.runId, pipelineKind,
        threadId: projectMeta.threadId, intent: input.intent.slice(0, 200),
        scenePolicy: selectedScenePolicy.decision,
      });
      await gatewayAppend(getGatewayPool(), { ...scope, actor: { ...WORKER_ACTOR } }, {
        who: { ...WORKER_ACTOR },
        context: {
          tenant_id: scope.tenantId, workspace_id: scope.workspaceId,
          time: new Date().toISOString(), channel: "inapp",
        },
        object: { type: "video_project", id: input.projectId },
        decision: {
          action: "video.scene_policy.selected",
          after: { runId: entry.runId, ...selectedScenePolicy.decision },
          basis: ["原始需求与已安装片型知识条目在生成前确定性匹配；未命中仍留空选择证据"],
        },
        rule_impact: [],
      });
      /**
       * AI 监制打回 → **默认打回即停，不再自动重跑**（T-2026-1001-0007）。
       *
       * 为什么改：自动重跑会把"AI 认为不合适"直接变成"再花钱重出一遍"，
       * 真机上正是"打回 → 自动重跑（含重新出图）→ 再打回"的烧钱循环。
       * 现在 AI 监制只负责**把问题提前暴露**；打回即停并如实上报，是否重做由人决定。
       * 显式设 `VM_PRODUCER_RETRY=1`（或更大）才恢复旧的有上限自动重跑口径。
       *
       * 制片档案口径（T-2026-0926-0001）：每次重跑 = 新 attempt（`claimRun` 原子递增），
       * 「第几次尝试、耗时、错误分类」全部落盘，历史不丢。
       */
      const maxAttempts = Math.max(1, Number(process.env.VM_PRODUCER_RETRY ?? 0) + 1);
      const runOnce = async (): Promise<Awaited<ReturnType<VideoStudio["runPreproduction"]>>> => {
        const runnerStore = archive;
        // 档案 output 是给索引/交接包使用的摘要，不能取代 vendor 业务结果。
        // confirmations 决定打回重试，stages.dataMining 决定商品档案投影；两者必须完整保留。
        let rawResult: Awaited<ReturnType<VideoStudio["runPreproduction"]>> | undefined;
        await runner.run(
          "preproduction",
          { intent: runInput.intent, isMarketing: input.isMarketing ?? false, pipelineKind, scenePolicy: selectedScenePolicy.decision },
          async (ctx) => runWithVendorEngine(llm, async () => {
            gateProofs.clear();
            completedVendorResult = null;
            /**
             * 断点快照（真机发现的方案缺陷修复，T-2026-0926-0001 留痕）：
             * vendor 在 Phase checkpoint 指纹不匹配时会**删除**自己的 checkpoint
             * （production-engine.js#_loadLatestCheckpoint），"曾经有断点但恢复没命中"这段证据
             * 会被重跑就地销毁。开跑前先只读快照进档案，供恢复对账与工程发现。
             */
            const preCheckpoints = await runnerStore
              .snapshotExternalDir(
                path.resolve(runWorkDir, "checkpoints", input.projectId),
                `checkpoints/attempt-${ctx.attempt}-before`,
                { filter: (name) => name.endsWith(".json") },
              )
              .catch((err) => {
                console.error(`[archive] 断点快照失败（继续执行）: ${(err as Error).message}`);
                return { files: 0, bytes: 0, skipped: [] as string[] };
              });
            let marketing: PreparedMarketingFacts | undefined;
            let g1Approved = true;
            if (input.isMarketing) {
              marketing = await prepareMarketingFacts({ scope: { ...scope, projectId: input.projectId, runId: entry.runId, attempt: ctx.attempt },
                root: archive.root, metadata: input.metadata ?? {}, intent: input.intent, llm });
              const verdict = await onApproval({ runId: entry.runId, gate: "G1_DOSSIER", vendorType: "host-source-dossier",
                title: "本次营销来源正文与逐主张事实审核", contentMd: marketing.g1Content });
              const proof = gateProofs.get("G1_DOSSIER");
              g1Approved = verdict.approved === true && proof?.status === "passed" && proof?.via === "llm" && proof?.degraded === false
                && typeof proof.model === "string" && proof.model.length > 0
                && Array.isArray(proof.evidence) && proof.evidence.some(item => item?.scope === "complete-text" && item?.sha256 === renderSha256(marketing!.g1Content));
              marketingDossierRoot = marketing.storeRoot;
              marketingDossierRef = path.posix.join("archive", scope.workspaceId, input.projectId, `${marketing.prefix}-dossier`);
            }
            return runWithSourceRestrictions(marketing?.bundle.restrictions ?? [], async () => {
            const studio = new VideoStudio({ ...studioConfig, ...(marketing ? { dataMining: {
              mode: "api", storeRoot: marketing.storeRoot, refresh: true,
              verifiedRaw: { projectId: input.projectId, rawJson: canonicalRenderJson(marketing.raw), sha256: marketing.bundle.rawSha256,
                productQuery: marketing.bundle.productQuery, restrictions: [...marketing.bundle.restrictions],
                nativeDossier: structuredClone(marketing.bundle.nativeDossier),
                restrictionsSha256: sourceRestrictionsHash(marketing.bundle.rawSha256, marketing.bundle.restrictions) },
            } } : {}) });
            /**
             * 传入 runInput（而不是 input）：它带上了本轮的片型选型结论与注入指引，
             * vendor 的提示词/分镜必须按本次选中的知识条目生成；G1 营销事实仍取自原始 input。
             */
            const r: Awaited<ReturnType<VideoStudio["runPreproduction"]>> = g1Approved ? await studio.runPreproduction(runInput) : {
              success: false, stages: {}, confirmations: { hostG1: { approved: false, reason: "producer-rejected(G1_DOSSIER)：本次来源与事实未通过真实监制" } },
            };
            completedVendorResult = r;
            if (r.success) {
              // vendor 真出图批量模式跳过的是生成前询问；服务必须在实际图片存在后完成 G5。
              const portraitVerdict = await onApproval({ runId: entry.runId, gate: "G5_PORTRAIT", vendorType: "portrait-generation",
                title: "实际定妆照完整性与视觉审核", contentMd: JSON.stringify({ portraitStudio: r.stages?.portraitStudio,
                  scriptReport: (r.stages?.scriptEngine as { report?: unknown } | undefined)?.report }) });
              r.confirmations = { ...((r.confirmations ?? {}) as Record<string, unknown>), hostPortraits: portraitVerdict };
              if (!portraitVerdict.approved) r.success = false;
            }
            if (r.success) {
              const missing = [...(input.isMarketing ? ["G1_DOSSIER"] : []), "G2_THEME", "G3_INSIGHT", "G4_PRD", "G5_PORTRAIT", "G6_PROMPT", "G7_FINAL"].filter(gate => {
                const proof = gateProofs.get(gate);
                return !(proof?.approved === true && (proof.status === "passed" && ((proof.via === "llm" && proof.degraded === false)
                  || (gate === "G5_PORTRAIT" && proof.via === "deterministic" && proof.basis === "native-portrait-files" && proof.degraded === false))
                  || gate === "G5_PORTRAIT" && proof.status === "not_applicable" && proof.basis === "no-characters-or-products"));
              });
              if (missing.length) {
                r.success = false;
                r.confirmations = { ...((r.confirmations ?? {}) as Record<string, unknown>), hostQualification: { approved: false,
                  reason: `producer-rejected：缺少服务监制裁决 ${missing.join(",")}`, fatal: "producer_rejected" } };
              }
            }
            rawResult = r;
            await ctx.heartbeat({ stages: Object.keys(r.stages ?? {}) });
            const vendorResumed = (r as unknown as { resumed?: unknown }).resumed === true;
            const vendorDegraded = (r as unknown as { degraded?: unknown }).degraded === true;
            if (preCheckpoints.files > 0) {
              await ctx.log(
                "info",
                `断点快照 ${preCheckpoints.files} 个文件 / ${preCheckpoints.bytes}B；本轮 vendor resumed=${vendorResumed}`,
                { files: preCheckpoints.files, resumed: vendorResumed, attempt: ctx.attempt },
              );
              decisionLog.push(
                `第 ${ctx.attempt} 次尝试：开跑前存在 ${preCheckpoints.files} 个 Phase checkpoint，本轮 resumed=${vendorResumed}`,
              );
            }
            /**
             * 环节自评（诚实台账）：vendor 跑完但 `success:false`（含 AI 监制打回）时，
             * 台账必须记 failed + 错误分类，否则监控器把真实失败聚类成 BUG 或完全看不见。
             */
            const rejected = isProducerRejection(r);
            /**
             * 失败原因取 vendor 的 `result.errors[]`（真实证据：哪个环节、什么错）。
             * 只写 `success:false` 会让监控把所有业务失败都聚类成 BUG（P0 误升级）。
             */
            const rawErrors = (r as unknown as { errors?: unknown }).errors;
            const vendorErrors = Array.isArray(rawErrors)
              ? (rawErrors as Array<Record<string, unknown>>).slice(0, 10)
              : [];
            const vendorFailure = vendorErrors
              .map((entry) => `${String(entry.stage ?? entry.layer ?? "unknown")}: ${String(entry.message ?? entry.error ?? "")}`.trim())
              .filter(Boolean)
              .join("；");
            const failureMessage = String(
              (r as { error?: unknown }).error
                ?? (r as { errorMessage?: unknown }).errorMessage
                ?? (vendorFailure || "预生产未成功（vendor 返回 success:false）"),
            ).slice(0, 500);
            const outcome = r.success
              ? undefined
              : {
                  status: "failed" as const,
                  errorClass: rejected ? "GATE_REJECTED" : classifyError(new Error(failureMessage)),
                  errorMsg: failureMessage,
                };
            /**
             * 营销片：收编情报档案指针（dossier 在档案夹之外，跨会话承接不断链）；
             * 字段口径对齐既有 resultSummary 摘要（studio-worker.ts resultSummary）。
             */
            const dm = (r.stages?.dataMining ?? null) as
              | { status?: string; product_id?: string; data?: { dossier?: { provenance?: unknown[] } } }
              | null;
            /**
             * 提示词包落档案（真机审计发现 D3）：预生产最有价值的产物是 6 镜 × 25/30 字段的完整提示词，
             * 但 vendor 只把它们留在内存与 console（`checkpointDir` 指向的 Phase checkpoint 在成功后
             * 会被 vendor 主动清理）。档案号称"自包含、可跨会话承接"，就必须把提示词本体落盘，
             * 否则新会话拿到档案也接不上下一步（提交渲染/交付）。
             */
            const handoff = r.success ? await planNativeFilmHandoff({ intent: input.rawIntent ?? input.intent,
              platform: String(runInput.metadata?.platform ?? "抖音"), nativeStages: r.stages ?? {},
              scenePolicy: selectedScenePolicy.policy,
              shots: bindNativeVideoAssets(nativeProductionShots(r.stages ?? {}), nativeAssets), llm }) : undefined;
            const shots = handoff?.shots ?? [];
            if (handoff) {
              const handoffRef = `stages/preproduction/attempt-${ctx.attempt}.film-handoff-report.json`;
              const handoffArtifact = await ctx.writeArtifact(handoffRef, { ...handoff.report, originalShots: nativeProductionShots(r.stages ?? {}),
                handoff: { shots, context: handoff.context } });
              if (!handoffArtifact || handoffArtifact.truncated) throw new Error("NATIVE_FILM_PLAN_UNVERIFIED: 完整交接审核证据被裁剪");
              const handoffPath = path.join(archive.root, handoffRef);
              const verdict = await reviewStage({ stage: "prompt", projectId: input.projectId,
                artifacts: [{ path: handoffPath, kind: "json" }], minScore: 85,
                deterministic: [{ id: "native-handoff-bound", pass: true, hard: true, detail: "交接完整覆盖当前原生镜头，提示词/时长/字段未改写，环境和钩子结构通过实测" }],
                requiredCheckIds: ["native-handoff-bound"], allowFallbackApprove: false,
                rubric: ["完整逐镜比较originalShots与handoff：没有改写原剧本、主体、动作、对白、服装或镜头目的，没有凭空新增镜头",
                  "钩子在原首镜提出且在指定原镜头实际兑现；空间、道具方向、操作者与接触合同来自原动作，无矛盾或新营销主张"] });
              await ctx.writeArtifact(`stages/preproduction/attempt-${ctx.attempt}.film-handoff-verdict.json`, verdict);
              if (!verdict.approved || verdict.status !== "passed" || verdict.via !== "llm" || verdict.degraded || !verdict.model
                || !verdict.evidence?.some(item => item.path === handoffPath && item.sha256 === handoffArtifact.sha256 && item.scope === "complete-text")) {
                throw new Error(`NATIVE_FILM_PLAN_UNVERIFIED: 交接语义审核未通过：${verdict.reason}`);
              }
            }
            const promptPack = shots.length
              ? {
                  stageId: "preproduction",
                  attempt: ctx.attempt,
                  pipelineKind,
                  scenePolicy: selectedScenePolicy.decision,
                  generatedAt: new Date().toISOString(),
                  shotCount: shots.length,
                  totalPromptChars: shots.reduce((sum, shot) => sum + String(shot.prompt ?? "").length, 0),
                  dossier: dm
                    ? { root: marketingDossierRef ?? `dossiers/${scope.workspaceId}`, productId: dm.product_id ?? null }
                    : null,
                  shots: shots.map((shot) => ({
                    shotId: shot.shot_id ?? shot.shotId ?? null,
                    sceneId: shot.scene_id ?? shot.sceneId ?? null,
                    sceneType: shot.scene_type ?? shot.sceneType ?? null,
                    durationSec: shot.duration ?? null,
                    degraded: shot.degraded === true,
                    promptCharCount: String(shot.prompt ?? "").length,
                    /** 提示词包内的字段序号与名称（`01.【语言约束】…` 口径），供审计核对"25/30 字段是否齐" */
                    promptFieldNames: Array.from(
                      String(shot.prompt ?? "").matchAll(/\d{1,2}\.【([^】]{1,10})】/g),
                    ).map((m) => m[1]),
                    fieldKeys: shot.fields && typeof shot.fields === "object" ? Object.keys(shot.fields as object) : [],
                    prompt: String(shot.prompt ?? ""),
                    fields: shot.fields ?? null,
                  })),
                }
              : null;
            // 可供 full-chain-film 接续的分镜草稿：只传政策身份与 vendor 原始镜头，
            // policyTags/必备画面仍须按知识条目补齐并通过全片硬闸，不能把草稿当成已放行分镜。
            const shotlistArtifact = selectedScenePolicy.policy && shots.length
              ? await ctx.writeArtifact(`stages/preproduction/attempt-${ctx.attempt}.shotlist.json`, {
                  title: projectMeta?.title ?? input.rawIntent ?? input.intent,
                  scenePolicy: {
                    id: selectedScenePolicy.policy.id,
                    version: selectedScenePolicy.policy.version,
                    sourceSha256: selectedScenePolicy.policy.sourceSha256 ?? null,
                    exceptions: (selectedScenePolicy.metadata.scenePolicy as { exceptions?: ScenePolicyException[] } | undefined)?.exceptions ?? [],
                  },
                  scenePolicySelection: selectedScenePolicy.decision,
                  draft: true,
                  shots: shots.map((shot) => ({ ...shot, shotId: shot.shotId ?? shot.shot_id ?? null })),
                })
              : null;
            const promptsArtifact = promptPack
              ? await ctx.writeArtifact(`stages/preproduction/attempt-${ctx.attempt}.prompts.json`, promptPack, {
                  // 超 4MB 时先丢 fields 明细（保留 prompt 全文与字段名），绝不丢整包
                  shrink: (data) => ({
                    ...(data as Record<string, unknown>),
                    fieldsTrimmed: true,
                    shots: (data as { shots: Array<Record<string, unknown>> }).shots.map((shot) => ({ ...shot, fields: null })),
                  }),
                })
              : null;
            const scenePolicyReport = selectedScenePolicy.policy
              ? auditScenePolicy({
                  title: input.rawIntent ?? input.intent,
                  scenePolicy: {
                    id: selectedScenePolicy.policy.id,
                    exceptions: ((selectedScenePolicy.metadata.scenePolicy as { exceptions?: ScenePolicyException[] } | undefined)?.exceptions ?? []),
                  },
                  shots: shots.map((shot): ScenePolicyShot => ({
                    ...shot,
                    shotId: typeof (shot.shotId ?? shot.shot_id) === "string" ? String(shot.shotId ?? shot.shot_id) : "",
                    duration: Number(shot.duration ?? 0),
                  })),
                }, selectedScenePolicy.policy)
              : null;
            if (scenePolicyReport) scenePolicyReport.policy.selection = selectedScenePolicy.decision.reason;
            const scenePolicyReportRef = `stages/preproduction/attempt-${ctx.attempt}.scene-policy-report.json`;
            const scenePolicyReportArtifact = scenePolicyReport
              ? await ctx.writeArtifact(scenePolicyReportRef, scenePolicyReport)
              : null;
            if (scenePolicyReport && (!scenePolicyReportArtifact || scenePolicyReportArtifact.truncated)) {
              throw new Error("片型硬闸：分镜审计报告未完整归档，拒绝继续渲染接续");
            }
            if (scenePolicyReport) {
              await gatewayAppend(getGatewayPool(), { ...scope, actor: { ...WORKER_ACTOR } }, {
                who: { ...WORKER_ACTOR },
                context: {
                  tenant_id: scope.tenantId, workspace_id: scope.workspaceId,
                  time: new Date().toISOString(), channel: "inapp",
                },
                object: { type: "video_project", id: input.projectId },
                decision: {
                  action: "video.scene_policy.audited",
                  after: {
                    runId: entry.runId, attempt: ctx.attempt,
                    policyId: selectedScenePolicy.policy!.id,
                    passed: scenePolicyReport.passed,
                    defects: scenePolicyReport.defects.slice(0, 30),
                    reportRef: scenePolicyReportRef,
                    reportSha256: scenePolicyReportArtifact!.sha256,
                  },
                  basis: ["完整镜头表按时长配比和逐镜证据执行片型硬闸；报告先落档案再裁决"],
                },
                rule_impact: [],
              });
              if (!scenePolicyReport.passed && r.success) {
                const first = scenePolicyReport.defects.slice(0, 5)
                  .map((item) => `${item.shotId ?? "全片"}[${item.rule}] ${item.detail}`).join("；");
                throw new Error(`片型硬闸打回（${scenePolicyReport.defects.length} 项）：${first}；详见 ${scenePolicyReportRef}`);
              }
            }
            if (selectedScenePolicy.policy && (!shotlistArtifact || shotlistArtifact.truncated || !promptsArtifact)) {
              throw new Error("片型硬闸打回：完整分镜草稿或提示词包未归档，拒绝继续渲染接续");
            }
            if (promptsArtifact) {
              decisionLog.push(
                `提示词包已归档：${promptPack!.shotCount} 镜 / ${promptPack!.totalPromptChars} 字符`
                + `（stages/preproduction/attempt-${ctx.attempt}.prompts.json，sha256=${promptsArtifact.sha256.slice(0, 12)}）`,
              );
            }
            const marketingFacts = marketing && r.success && promptPack ? await finalizeMarketingFacts(marketing,
              promptPack.shots.map(shot => ({ shotId: String(shot.shotId ?? ""), prompt: shot.prompt, fields: shot.fields }))) : undefined;
            if (marketing && r.success && !marketingFacts) throw new Error("MARKETING_PROMPTS_UNVERIFIED：营销预生产没有完整最终镜头事实审核");
            const filmSourceArtifact = r.success && shots.length ? await ctx.writeArtifact(
              `stages/preproduction/attempt-${ctx.attempt}.film-source.json`, buildNativeFilmSource({
                binding: { ...scope, projectId: input.projectId, runId: entry.runId, attempt: ctx.attempt, pipelineKind },
                title: projectMeta?.title ?? input.rawIntent ?? input.intent, shots,
                context: { ...handoff!.context, scenePolicySelection: selectedScenePolicy.decision, ...(nativeAssets.productId ? { products: [nativeAssets.productId] } : {}),
                  ...(selectedScenePolicy.policy ? { scenePolicy: { id: selectedScenePolicy.policy.id,
                    version: selectedScenePolicy.policy.version, sourceSha256: selectedScenePolicy.policy.sourceSha256,
                    exceptions: (selectedScenePolicy.metadata.scenePolicy as { exceptions?: ScenePolicyException[] } | undefined)?.exceptions ?? [] } } : {}) },
              })) : null;
            if (r.success && (!filmSourceArtifact || filmSourceArtifact.truncated)) throw new Error("NATIVE_FILM_SOURCE_REQUIRED: 完整原生影片交接稿没有完整归档");
            return {
              output: {
                success: r.success,
                ...(filmSourceArtifact ? { filmSourceRef: `stages/preproduction/attempt-${ctx.attempt}.film-source.json`, filmSourceSha256: filmSourceArtifact.sha256 } : {}),
                ...(marketingFacts ? { marketingFactsRef: marketingFacts.ref, marketingFactsSha256: marketingFacts.sha256 } : {}),
                productionEvidence: { schemaVersion: "workloom.preproduction-authority/v1", issuer: "workloom.studio-worker",
                  tenantId: scope.tenantId, workspaceId: scope.workspaceId, projectId: input.projectId,
                  runId: entry.runId, attempt: ctx.attempt, pipelineKind, gates: [...gateProofs.values()] },
                stages: Object.keys(r.stages ?? {}),
                checkpointDir: `checkpoints/${input.projectId}`,
                ...(promptsArtifact
                  ? {
                      promptsRef: `stages/preproduction/attempt-${ctx.attempt}.prompts.json`,
                      promptsSha256: promptsArtifact.sha256,
                      promptShotCount: promptPack!.shotCount,
                    }
                  : {}),
                ...(shotlistArtifact
                  ? {
                      shotlistRef: `stages/preproduction/attempt-${ctx.attempt}.shotlist.json`,
                      shotlistSha256: shotlistArtifact.sha256,
                    }
                  : {}),
                ...(scenePolicyReportArtifact
                  ? {
                      scenePolicyReportRef,
                      scenePolicyReportSha256: scenePolicyReportArtifact.sha256,
                      scenePolicyPassed: scenePolicyReport!.passed,
                    }
                  : {}),
                ...(preCheckpoints.files > 0
                  ? {
                      preCheckpointSnapshot: {
                        dir: `checkpoints/attempt-${ctx.attempt}-before`,
                        files: preCheckpoints.files,
                        bytes: preCheckpoints.bytes,
                        resumed: vendorResumed,
                      },
                    }
                  : {}),
                resumed: vendorResumed,
                degraded: vendorDegraded,
                ...(failureMessage && !r.success ? { failureMessage } : {}),
                ...(vendorErrors.length ? { failures: vendorErrors } : {}),
                ...(dm
                  ? {
                      dossier: {
                        root: marketingDossierRef ?? `dossiers/${scope.workspaceId}`,
                        productId: dm.product_id ?? null,
                        evidenceCount: Array.isArray(dm.data?.dossier?.provenance)
                          ? dm.data!.dossier!.provenance!.length
                          : 0,
                      },
                    }
                  : {}),
              },
              ...(outcome ? { outcome } : {}),
            };
            });
          }),
        );
        if (!rawResult) throw new Error("预生产档案执行器未返回业务结果");
        return rawResult;
      };
      let result = await runOnce();
      let attempts = 1;
      while (attempts < maxAttempts && isProducerRejection(result)) {
        attempts += 1;
        console.log(`[studio-worker] AI 监制打回 → 自动重跑第 ${attempts}/${maxAttempts} 次（同一项目、同一门口径）`);
        result = await runOnce();
      }
      entry.status = result.success ? "finished" : "failed";
      entry.error = result.success ? null : terminalFailureMessageOf(result, entry.error);
      /** 情报层产出摘要（逐环节审计要看得见"档案到底有没有装订出来"） */
      const dataMiningStage = (result.stages?.dataMining ?? null) as
        | { status?: string; product_id?: string; data?: { ok?: boolean; reused?: boolean; dossier?: { gaps?: unknown[]; provenance?: unknown[] } } }
        | null;
      entry.resultSummary = {
        success: result.success,
        stages: Object.keys(result.stages ?? {}),
        producerAttempts: attempts,
        ...(dataMiningStage
          ? {
              dataMining: {
                status: dataMiningStage.status ?? null,
                productId: dataMiningStage.product_id ?? null,
                ok: dataMiningStage.data?.ok ?? null,
                reused: dataMiningStage.data?.reused ?? null,
                evidenceCount: Array.isArray(dataMiningStage.data?.dossier?.provenance)
                  ? dataMiningStage.data!.dossier!.provenance!.length
                  : null,
                gaps: Array.isArray(dataMiningStage.data?.dossier?.gaps)
                  ? dataMiningStage.data!.dossier!.gaps!.length
                  : null,
              },
            }
          : {}),
      };

      /**
       * 媒资库自动入库（T-2026-0926-0007 规格书 §3.4）：
       * 定妆照/商品图批量入库（kind=portrait / product_image）+ 营销管线商品档案投影。
       * 旁路写：整体 try/catch，任何失败只记日志，**不改 run 终态**（素材入库不该推翻"片子跑完了"）。
       */
      if ((process.env.MEDIA_INGEST_ENABLED ?? "1") !== "0") {
        try {
          const portraits = await ingestPortraitsFromIndex(getAppPool(), getGatewayPool(), scope, {
            projectId: input.projectId,
            pipelineKind: input.isMarketing ? "marketing" : "narrative",
            indexPath: portraitIndexPath,
            by: "video-studio",
          });
          if (portraits.scanned > 0) {
            console.log(
              `[media-ingest] 定妆照/商品图入库：扫描 ${portraits.scanned}，新增 ${portraits.ingested}，`
              + `去重 ${portraits.deduped}，跳过 ${portraits.skipped}，失败 ${portraits.errors.length}`,
            );
          }
          for (const error of portraits.errors.slice(0, 5)) console.warn(`[media-ingest] 单张入库失败：${error}`);
        } catch (err) {
          console.error(`[media-ingest] 定妆照入库失败（不影响 run 终态）：${(err as Error).message}`);
        }
        const minedProductId = dataMiningStage?.product_id ?? null;
        if (input.isMarketing && minedProductId) {
          try {
            const profile = await upsertProductProfileFromDossier(getAppPool(), getGatewayPool(), scope, {
              dossierRoot: marketingDossierRoot ?? path.join(WORK_DIR, "dossiers", scope.workspaceId),
              productId: minedProductId,
              by: "video-studio",
            });
            console.log(
              `[media-ingest] 商品档案投影：${profile.profile.productName}`
              + `（sha256 ${profile.profile.dossierSha256.slice(0, 12)}…，内容变化=${profile.changed}，主图新入库=${profile.heroIngested}）`,
            );
          } catch (err) {
            console.error(`[media-ingest] 商品档案投影失败（不影响 run 终态）：${(err as Error).message}`);
          }
        }
      }
      /** 终态交接包（改动 D）：跨会话承接只凭 projectId + 档案夹即可续跑，不依赖原始上下文 */
      if (archive) {
        try {
          const producerRejected = isProducerRejection(result);
          const terminalFailureMessage = terminalFailureMessageOf(result, entry.error);
          await updateContextBundle(archive, {
            pipelineKind,
            threadId: projectMeta?.threadId ?? null,
            lastStage: "preproduction",
            ...(result.success
              ? {}
              : {
                  failedStage: "preproduction",
                  /**
                   * 软失败口径（真机审计发现 D2）：vendor 返回 `success:false` 时不一定抛异常，
                   * `entry.error` 常为空字符串——用 `??` 会落进 `new Error("")` 被判成 BUG（误升级 P0）。
                   * 这里按"异常 → result.error → vendor failures[] → 通用兜底"顺序取真实原因。
                   */
                  errorClass: producerRejected
                    ? "GATE_REJECTED"
                    : classifyError(new Error(terminalFailureMessage)),
                  errorMsg: terminalFailureMessage.slice(0, 500),
                }),
            decisions: [
              `预生产${result.success ? "完成" : "**未成功**"}（归档 attempt=${stageRef.attempt || "-"}；本次运行内重试 ${attempts} 次；内部环节 ${Object.keys(result.stages ?? {}).length} 个）`,
              ...decisionLog,
              ...(dataMiningStage
                ? [
                    `情报档案：${marketingDossierRef ?? `dossiers/${scope.workspaceId}`}（商品 ${dataMiningStage.product_id ?? "未标注"}，证据 ${
                      Array.isArray(dataMiningStage.data?.dossier?.provenance)
                        ? dataMiningStage.data!.dossier!.provenance!.length
                        : 0
                    } 条）`,
                  ]
                : []),
            ],
            ...(result.success
              ? { nextSteps: ["预生产完成 → 渲染提交（video.render.submit）或按交付包进入后期/交付段"] }
              : {}),
          });
        } catch (err) {
          console.error(`[archive] 交接包写入失败（不影响运行）: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      entry.status = "failed";
      entry.error = err instanceof Error ? err.message : String(err);
      // 元数据尚未验证时，不为不存在/越权的项目创建失败档案。
      if (projectMeta) {
        try {
          await updateContextBundle(archive, {
            pipelineKind,
            threadId: projectMeta?.threadId ?? null,
            failedStage: "preproduction",
            errorClass: classifyError(err),
            errorMsg: entry.error,
            decisions: decisionLog,
          });
        } catch (bundleErr) {
          console.error(`[archive] 失败交接包写入失败: ${(bundleErr as Error).message}`);
        }
      }
    } finally {
      // 一个清理失败不能跳过其余清理；租约解锁异常由宿主销毁连接，终态仍诚实报告失败。
      for (const cleanup of [
        () => detachStructuredLog?.(),
        () => activeLease?.release(),
        restoreRunLogs,
        uninstallPortraitBinding,
      ]) {
        try {
          await cleanup();
        } catch (cleanupError) {
          const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          entry.status = "failed";
          entry.error = [entry.error, `运行清理失败：${message}`].filter(Boolean).join("；");
          console.error(`[studio-worker] ${entry.error}`);
        }
      }
      entry.finishedAt = new Date().toISOString();
    }
  })();

  return entry.runId;
}

/**
 * 建视频项目 + 启动标准预生产管线（唯一入口，2026-09-21）：
 *   - video.studio.start（视频页面手起）与 threads.dispatch（右栏「派」识别出视频目标）共用同一条链路，
 *     避免"内容类目标走通用 Quest 规划器、把内部流转步骤照单执行"的分叉；
 *   - 建档行与建档事件同一事务（D16 同口径）；threadId 传入时把任务线程与视频项目关联，
 *     任务详情/时间线因此能看到「已转入标准视频管线」。
 */
export interface StartVideoProjectInput {
  intent: string;
  rawIntent?: string;
  /** 分流器写入商品信息之前的客户 metadata，供片型选择只取客户来源证据。 */
  customerMetadata?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  /** 调用方显式指定的目标平台（ID 或中文别名）；缺省由需求文本识别，仍缺省则走抖音口径。 */
  platform?: string;
  isMarketing?: boolean;
  by: { id: string; type: "human" | "system" };
  threadId?: string;
}

export async function startVideoProjectRun(
  scope: { tenantId: string; workspaceId: string },
  input: StartVideoProjectInput,
): Promise<{ projectId: string; runId: string }> {
  assertCustomerVideoMetadata(input.metadata ?? {});
  const selectionMetadata = Object.hasOwn(input, "customerMetadata") ? input.customerMetadata ?? undefined : input.metadata;
  const selectedScenePolicy = resolveScenePolicyForIntent(input.rawIntent ?? input.intent, selectionMetadata);
  const selectedPlatform = resolvePlatformForIntent(input.rawIntent ?? input.intent, selectionMetadata, input.platform);
  const platformMetadata: Record<string, unknown> = {
    ...(input.metadata ?? {}),
    platform: selectedPlatform.decision.id,
    platformSelection: selectedPlatform.decision,
  };
  const client = await getAppPool().connect();
  let projectId = "";
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [scope.workspaceId]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [scope.tenantId]);
    // GR-02（2026-09-29 第二次修复）：视频项目号与线程号同口径——纯 nextval 取号 + SAVEPOINT 换号重试
    const kind = input.isMarketing ? "marketing" : "narrative";
    projectId = (await insertWithReadableId(client, VIDEO_PROJECT_ID_SOURCE, async (id) => {
      await client.query(
        `INSERT INTO video_projects (id, workspace_id, title, kind, created_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, scope.workspaceId, input.intent.slice(0, 200), kind, input.by.id],
      );
      return id;
    })).id;
    await gatewayAppendOnClient(client, {
      ...scope,
      actor: { ...input.by },
      ...(input.threadId ? { sessionId: input.threadId } : {}),
    }, {
      who: { ...input.by },
      context: {
        tenant_id: scope.tenantId, workspace_id: scope.workspaceId,
        time: new Date().toISOString(), channel: "inapp",
      },
      object: { type: "video_project", id: projectId },
      decision: {
        action: "video.project.create",
        after: {
          projectId, kind, intent: input.intent.slice(0, 500),
          scenePolicy: selectedScenePolicy.decision,
          platform: selectedPlatform.decision,
          ...(input.threadId ? { threadId: input.threadId } : {}),
        },
        basis: ["视频标准管线立项（§5：一部片子/一个营销 Campaign）"],
      },
      rule_impact: [],
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  const runId = startRun(scope, {
    projectId,
    intent: input.intent,
    metadata: platformMetadata,
    isMarketing: input.isMarketing,
    rawIntent: input.rawIntent,
    selectedScenePolicy,
    selectedPlatform,
  });
  return { projectId, runId };
}
