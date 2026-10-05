import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
const root = resolve(new URL("./growth-native-pipeline/", import.meta.url).pathname);
const esbuild = createRequire(realpathSync(resolve(root, "node_modules/tsx/package.json")))("esbuild");
const text = readFileSync(resolve(root, "scripts/release-gate.ts"), "utf8");
function callback(id: string, bindings: Record<string, unknown>) {
  const start = text.indexOf(`await check("${id}"`), end = text.indexOf("\n});", start) + 4;
  assert.ok(start >= 0 && end > start, "actual check callback exists");
  const block = text.slice(start, end), body = block.slice(block.indexOf("async () =>"), block.lastIndexOf(")"));
  const code = esbuild.transformSync("const fn=" + body + ";fn;", { loader: "ts", target: "es2022" }).code;
  return runInNewContext(code, { assert: (cond: unknown, message: string) => assert.ok(cond, message), TARGET: { tenantId: "T", workspaceId: "W", presetKey: "ads-optimizer" }, token: "test-session", ...bindings });
}
test("actual Q01 must reject a failed task even when it has a persisted multistep plan", async () => {
  const fn = callback("Q-01", { call: async (path: string) => path === "threads.dispatch"
    ? { kind: "routed", mode: "quest", threadId: "failed-thread", status: "failed", stepsTotal: 3, stepsDone: 0 }
    : { id: "failed-thread", status: "failed" } });
  await assert.rejects(fn);
});
test("actual Q02 cannot prove this run with another session's old events", async () => {
  const queries: any[] = [];
  const fn = callback("Q-02", { pg: { Client: class { async connect() {} async end() {}
    async query(sql: string, args?: unknown[]) { queries.push({ sql, args }); return { rows: [{ tc: 1, ec: 4 }] }; } } }, APP_URL: "test-only", questThreadId: "new-thread" });
  await fn();
  const query = queries.find(entry => /FROM biz_events/.test(entry.sql));
  assert.ok(/session_id\s*=\s*\$2/.test(query.sql), "the actual query must bind the new thread");
  assert.equal(query.args?.[1], "new-thread");
});
