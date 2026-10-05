/** 发布门禁的 QUEST 证据契约；仅正常派遣一次，不重试或替业务决定审批。 */
export type ReleaseQuestCall = (path: string, token: string, body?: unknown, timeoutMs?: number, method?: "mutation" | "query") => Promise<unknown>;
export interface ReleaseQuestEvidence {
  threadId: string;
  status: "completed" | "pending_review";
  stepsTotal: number;
  stepsDone: number;
  pendingApprovalId?: string;
}
export interface ReleaseQuestEvent {
  session_id: string;
  event_id: string;
  payload: unknown;
  approval_id?: string | null;
  approval_status?: string | null;
  approval_snapshot?: unknown;
}
function requireProof(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`RELEASE_QUEST_PROOF：${message}`);
}
function record(value: unknown): Record<string, any> {
  requireProof(value && typeof value === "object" && !Array.isArray(value), "结果不是有效对象");
  return value as Record<string, any>;
}
/** 分类 12s + 规划最多三次各120s + 传输/数据库18s；保持单次请求和有限预算。 */
export const RELEASE_QUEST_TIMEOUT_MS = 390_000;
export async function runReleaseQuestCheck(input: { call: ReleaseQuestCall; token: string }): Promise<ReleaseQuestEvidence> {
  const routed = record(await input.call("threads.dispatch", input.token,
    { title: "生成一份本周运行复盘，并列出三项下一步任务", runImmediately: true }, RELEASE_QUEST_TIMEOUT_MS));
  requireProof(routed.kind === "routed" && routed.mode === "quest", "目标未按 QUEST 路由");
  requireProof(typeof routed.threadId === "string" && routed.threadId.trim(), "未建线程");
  requireProof(Number.isInteger(routed.stepsTotal) && routed.stepsTotal >= 2, "没有有效多步骤计划");
  requireProof(Number.isInteger(routed.stepsDone) && routed.stepsDone >= 0 && routed.stepsDone <= routed.stepsTotal, "步骤进度非法");
  requireProof(!routed.error && !routed.blockedBy, "任务错误或被阻断");
  requireProof(routed.unverified === undefined || (Array.isArray(routed.unverified) && routed.unverified.length === 0), "存在未核实步骤");
  requireProof(routed.status === "completed" || routed.status === "pending_review", `任务未完成或合规挂起（${routed.status}）`);
  if (routed.status === "completed") requireProof(routed.stepsDone === routed.stepsTotal, "完成状态与步骤数不符");
  else requireProof(routed.stepsDone < routed.stepsTotal && typeof routed.pendingApprovalId === "string" && routed.pendingApprovalId.trim(), "挂起缺当前审批引用");
  const thread = record(await input.call("threads.get", input.token, { threadId: routed.threadId }, 30_000, "query"));
  requireProof(thread.id === routed.threadId && thread.mode === "quest" && thread.status === routed.status, "线程回读身份、模式或状态不符");
  requireProof(thread.progress_total === routed.stepsTotal && thread.progress_done === routed.stepsDone, "线程回读进度不符");
  if (routed.status === "pending_review") requireProof(thread.pending_approval_id === routed.pendingApprovalId, "审批不属于当前待办线程");
  return { threadId: routed.threadId, status: routed.status, stepsTotal: routed.stepsTotal, stepsDone: routed.stepsDone,
    ...(routed.status === "pending_review" ? { pendingApprovalId: routed.pendingApprovalId } : {}) };
}
export function verifyReleaseQuestEvents(proof: ReleaseQuestEvidence, rows: ReleaseQuestEvent[]): string {
  requireProof(rows.length > 0 && rows.every(row => row.session_id === proof.threadId), "无线程事件或混入其他线程");
  const events = rows.map(row => ({ row, payload: record(row.payload) }));
  requireProof(events.some(({ payload }) => payload.decision?.action === "thread.dispatch"
    && payload.decision.after?.threadId === proof.threadId && payload.decision.after?.mode === "quest"), "缺本次线程派遣事件");
  const verified = new Set<string>();
  const modes = new Set<string>();
  for (const { payload } of events) {
    if (payload.decision?.kind !== "execute") continue;
    requireProof(payload.decision.outcome !== "error" && !payload.decision.error && payload.receipt?.synced === true
      && !payload.receipt.error && ["real", "simulated"].includes(payload.receipt.mode), "执行事件存在失败、未核实或未知回执模式");
    requireProof(typeof payload.decision.step_id === "string" && payload.decision.step_id.trim(), "执行事件缺步骤引用");
    verified.add(payload.decision.step_id); modes.add(payload.receipt.mode);
  }
  requireProof(verified.size === proof.stepsDone, "已完成步骤与不同步骤的核实回执数不符");
  if (proof.status === "completed") {
    requireProof(verified.size === proof.stepsTotal, "未取得全部步骤回执");
    return `线程 ${proof.threadId} · 已完成 ${verified.size}/${proof.stepsTotal} 步 · 回执模式 ${[...modes].join("、")} · 事件 ${rows.length} 条`;
  }
  const pending = events.find(({ row, payload }) => row.approval_id === proof.pendingApprovalId
    && row.approval_status === "pending" && payload.decision?.kind === "review");
  requireProof(pending, "缺同线程待审批事件与审批行");
  const snapshot = record(pending.row.approval_snapshot), decision = record(pending.payload.decision);
  requireProof(typeof decision.step_id === "string" && decision.step_id.trim() && !verified.has(decision.step_id), "待审批步骤引用非法");
  requireProof(typeof decision.fingerprint === "string" && decision.fingerprint.trim()
    && snapshot.step_fingerprint === decision.fingerprint && snapshot.step_id === decision.step_id && snapshot.tool === decision.tool, "审批快照与当前步骤不符");
  requireProof(!snapshot.params_incomplete && !snapshot.plan_unverified, "挂起计划缺参数或相关性未核实");
  return `线程 ${proof.threadId} · 核实执行 ${verified.size}/${proof.stepsTotal} 步 · 合规挂起 ${proof.pendingApprovalId}（任务尚未完成） · 回执模式 ${[...modes].join("、") || "未执行工具"} · 事件 ${rows.length} 条`;
}
