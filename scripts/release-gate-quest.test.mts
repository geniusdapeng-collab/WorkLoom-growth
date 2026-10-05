import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const root = resolve(process.env.WORKLOOM_ASSERTION_MODULE_ROOT ?? new URL("../", import.meta.url).pathname);
const moduleAt = () => import(pathToFileURL(resolve(root, "scripts/tools/release-gate-quest.ts")).href);
const routed = (change: any = {}) => ({ kind: "routed", mode: "quest", threadId: "new-thread", status: "completed", stepsTotal: 2, stepsDone: 2, unverified: [], ...change });
const thread = (change: any = {}) => ({ id: "new-thread", mode: "quest", status: "completed", progress_total: 2, progress_done: 2, ...change });
const proof = (change: any = {}) => ({ threadId: "new-thread", status: "completed", stepsTotal: 2, stepsDone: 2, ...change });
const dispatch = () => ({ session_id: "new-thread", event_id: "E1", payload: { decision: { action: "thread.dispatch", after: { threadId: "new-thread", mode: "quest" } } } });
const execution = (step: string, mode = "real") => ({ session_id: "new-thread", event_id: `E-${step}`, payload: { decision: { kind: "execute", step_id: step }, receipt: { synced: true, mode } } });
const review = () => ({ session_id: "new-thread", event_id: "E-review", payload: { decision: { kind: "review", step_id: "step2", tool: "growth.review", fingerprint: "fingerprint2" } },
  approval_id: "apr-new", approval_status: "pending", approval_snapshot: { step_id: "step2", tool: "growth.review", step_fingerprint: "fingerprint2" } });
test("dispatch uses normal semantic routing once with a finite planner-compatible budget and reads the exact thread", async () => {
  const { runReleaseQuestCheck, RELEASE_QUEST_TIMEOUT_MS } = await moduleAt(), calls: any[] = [];
  const result = await runReleaseQuestCheck({ token: "session", call: async (...args: any[]) => { calls.push(args); return calls.length === 1 ? routed() : thread(); } });
  assert.deepEqual(result, proof()); assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "threads.dispatch"); assert.equal(calls[0][2].runImmediately, true);
  assert.equal("presetKey" in calls[0][2], false); assert.equal(calls[0][3], RELEASE_QUEST_TIMEOUT_MS); assert.equal(RELEASE_QUEST_TIMEOUT_MS, 390_000);
  assert.deepEqual(calls[1].slice(2), [{ threadId: "new-thread" }, 30_000, "query"]);
});
test("failed, paused, queued, running, cancelled, errored and unverified tasks reject before readback without retry", async () => {
  const { runReleaseQuestCheck } = await moduleAt();
  for (const change of [...["failed", "paused", "queued", "running", "cancelled"].map(status => ({ status })), { error: "failure" }, { blockedBy: "fence" }, { unverified: ["step1"] }, { unverified: {} }]) {
    let calls = 0; await assert.rejects(() => runReleaseQuestCheck({ token: "session", call: async () => { calls++; return routed(change); } }), /RELEASE_QUEST_PROOF/); assert.equal(calls, 1);
  }
});
test("malformed identities, fractional or impossible progress and incomplete completion reject", async () => {
  const { runReleaseQuestCheck } = await moduleAt();
  for (const change of [{ threadId: "" }, { kind: "clarify" }, { mode: "agent" }, { stepsTotal: 1 }, { stepsTotal: 2.5 }, { stepsDone: -1 }, { stepsDone: 3 }, { stepsDone: 1 }, { stepsDone: 1.5 }]) {
    await assert.rejects(() => runReleaseQuestCheck({ token: "session", call: async () => routed(change) }), /RELEASE_QUEST_PROOF/);
  }
});
test("missing, foreign, stale or inconsistent thread readback rejects", async () => {
  const { runReleaseQuestCheck } = await moduleAt();
  for (const response of [null, thread({ id: "old-thread" }), thread({ mode: "ask" }), thread({ status: "failed" }), thread({ progress_done: 0 }), thread({ progress_total: 3 })]) {
    await assert.rejects(() => runReleaseQuestCheck({ token: "session", call: async (path: string) => path === "threads.dispatch" ? routed() : response }), /RELEASE_QUEST_PROOF/);
  }
});
test("pending review must have a current matching approval and cannot claim completed progress", async () => {
  const { runReleaseQuestCheck } = await moduleAt();
  const change = { status: "pending_review", stepsDone: 1, pendingApprovalId: "apr-new" };
  const result = await runReleaseQuestCheck({ token: "session", call: async (path: string) => path === "threads.dispatch" ? routed(change) : thread({ status: change.status, progress_done: 1, pending_approval_id: "apr-new" }) });
  assert.deepEqual(result, proof(change));
  for (const r of [routed({ ...change, pendingApprovalId: null }), routed({ ...change, stepsDone: 2 })]) {
    await assert.rejects(() => runReleaseQuestCheck({ token: "session", call: async () => r }), /RELEASE_QUEST_PROOF/);
  }
  await assert.rejects(() => runReleaseQuestCheck({ token: "session", call: async (path: string) => path === "threads.dispatch" ? routed(change) : thread({ status: change.status, progress_done: 1, pending_approval_id: "apr-old" }) }), /RELEASE_QUEST_PROOF/);
});
test("transport failures propagate with one dispatch and no automatic resend", async () => {
  const { runReleaseQuestCheck } = await moduleAt(); let calls = 0;
  await assert.rejects(() => runReleaseQuestCheck({ token: "session", call: async () => { calls++; throw new Error("transport timeout"); } }), /transport timeout/); assert.equal(calls, 1);
});
test("completed task requires distinct verified step receipts and reports simulated mode honestly", async () => {
  const { verifyReleaseQuestEvents } = await moduleAt();
  assert.match(verifyReleaseQuestEvents(proof(), [dispatch(), execution("step1"), execution("step2", "simulated")]), /real、simulated/);
  for (const rows of [[dispatch(), execution("step1")], [dispatch(), execution("step1"), execution("step1")], [execution("step1"), execution("step2")], []]) {
    assert.throws(() => verifyReleaseQuestEvents(proof(), rows), /RELEASE_QUEST_PROOF/);
  }
});
test("wrong session, failed receipt, missing mode, error outcome and missing step cannot satisfy event evidence", async () => {
  const { verifyReleaseQuestEvents } = await moduleAt();
  for (const changed of [{ ...execution("step2"), session_id: "old-thread" }, { ...execution("step2"), payload: { decision: { kind: "execute", step_id: "step2" }, receipt: { synced: false, mode: "real" } } },
    { ...execution("step2"), payload: { decision: { kind: "execute", step_id: "step2", outcome: "error" }, receipt: { synced: true, mode: "real" } } },
    { ...execution("step2"), payload: { decision: { kind: "execute", step_id: "step2" }, receipt: { synced: true } } },
    { ...execution("step2"), payload: { decision: { kind: "execute" }, receipt: { synced: true, mode: "real" } } }]) {
    assert.throws(() => verifyReleaseQuestEvents(proof(), [dispatch(), execution("step1"), changed]), /RELEASE_QUEST_PROOF/);
  }
});
test("guarded review verifies joined approval, step fingerprint and usable plan without declaring task completion", async () => {
  const { verifyReleaseQuestEvents } = await moduleAt(), p = proof({ status: "pending_review", stepsDone: 1, pendingApprovalId: "apr-new" });
  assert.match(verifyReleaseQuestEvents(p, [dispatch(), execution("step1"), review()]), /任务尚未完成/);
  for (const change of [{ approval_id: "apr-old" }, { approval_status: "approved" }, { approval_snapshot: null },
    { approval_snapshot: { ...review().approval_snapshot, step_fingerprint: "changed" } },
    { approval_snapshot: { ...review().approval_snapshot, params_incomplete: true } },
    { approval_snapshot: { ...review().approval_snapshot, plan_unverified: true } }]) {
    assert.throws(() => verifyReleaseQuestEvents(p, [dispatch(), execution("step1"), { ...review(), ...change }]), /RELEASE_QUEST_PROOF/);
  }
});
test("actual release callbacks bind the new thread and joined approval rather than old workspace event counts", async () => {
  const { runReleaseQuestCheck, verifyReleaseQuestEvents } = await moduleAt();
  const esbuild = createRequire(realpathSync(resolve(root, "node_modules/tsx/package.json")))("esbuild");
  const text = readFileSync(resolve(root, "scripts/release-gate.ts"), "utf8");
  const queries: any[] = [], context: any = { TARGET: { tenantId: "T", workspaceId: "W" }, token: "session", APP_URL: "test",
    questEvidence: null, runReleaseQuestCheck, verifyReleaseQuestEvents, assert: (cond: any, message: string) => assert.ok(cond, message),
    call: async (path: string) => path === "threads.dispatch" ? routed() : thread(), pg: { Client: class {
      async connect() {} async end() {} async query(sql: string, args?: unknown[]) { queries.push({ sql, args }); return { rows: /FROM biz_events/.test(sql) ? [dispatch(), execution("step1"), execution("step2")] : [] }; }
    } } };
  for (const id of ["Q-01", "Q-02"]) {
    const start = text.indexOf(`await check("${id}"`), end = text.indexOf("\n});", start) + 4;
    assert.ok(start >= 0 && end > start); const block = text.slice(start, end);
    const body = block.slice(block.indexOf("async () =>"), block.lastIndexOf(")"));
    const fn = runInNewContext(esbuild.transformSync("(() => { const fn=" + body + ";return fn; })()", { loader: "ts" }).code, context);
    await fn();
  }
  const query = queries.find(row => /FROM biz_events/.test(row.sql));
  assert.match(query.sql, /e\.session_id\s*=\s*\$2/); assert.match(query.sql, /LEFT JOIN approvals/);
  assert.deepEqual(Array.from(query.args), ["W", "new-thread", null]);
});
