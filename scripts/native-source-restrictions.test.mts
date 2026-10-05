import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { WorkloomLLMEngine, installVendorEngineBridge } from "../packages/video-studio/src/llm-adapter.js";
import { sourceRestrictionsHash, runWithSourceRestrictions, currentSourceRestrictionPrompt } from "../packages/video-studio/src/source-restrictions.js";
import { MockProvider } from "@workloom/base/model-router";

const limits = ["原声明：对外投放前客户确认；机器商品图片映射未核实", "无评分来源，禁止评分主张；特殊字符\"\\\n完整保留"];
const engine = () => new WorkloomLLMEngine({ baseUrl: "https://source.example.test", apiKey: "test-only", model: "main", fastModel: "fast", timeoutMs: 240_000 });
async function withTransport(run: (e: WorkloomLLMEngine, bodies: any[]) => Promise<void>) {
  const original = globalThis.fetch, bodies: any[] = [];
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })); };
  try { await run(engine(), bodies); } finally { globalThis.fetch = original; }
}
test("all native adapter interfaces carry complete restrictions despite custom system prompts", async () => {
  await withTransport(async (e, bodies) => {
    await runWithSourceRestrictions(limits, async () => {
      await e.reason("creative", { systemPrompt: "custom creative" });
      await e.reasonRaw("insight", { systemPrompt: "custom insight" });
      await e.reasonStructured("prd", {}, { systemPrompt: "custom prd" });
      await e.chat("custom script", "script"); await e.generate("prompts");
    });
    assert.equal(bodies.length, 5);
    for (const body of bodies) assert.ok(body.messages[0].content.includes(JSON.stringify(limits)));
    assert.ok(bodies[0].messages[0].content.startsWith("custom creative"));
  });
});
test("vendor-owned engine prototype calls inherit the native run limits", async () => {
  await withTransport(async (e, bodies) => {
    const dispose = installVendorEngineBridge(e), require = createRequire(import.meta.url);
    const { LLMEngine } = require("../vendor/supermickey/systems/llm-reasoning-engine.js");
    try { await runWithSourceRestrictions(limits, async () => { await new LLMEngine().reason("vendor script"); }); }
    finally { dispose(); }
    assert.equal(bodies.length, 1); assert.ok(bodies[0].messages[0].content.includes(JSON.stringify(limits)));
  });
});
test("routed primary/fast calls retain restrictions, timeout and model billing traces", async () => {
  const observed: any[] = [], traces: any[] = [];
  class ObservedProvider extends MockProvider {
    async chat(messages: Parameters<MockProvider["chat"]>[0], options: Parameters<MockProvider["chat"]>[1]) {
      observed.push({ messages, timeout: options?.timeoutMs }); return super.chat(messages, options);
    }
  }
  const e = engine(); e.attachRouter({ providers: new Map([
    ["deepseek-v4-pro", new ObservedProvider("deepseek-v4-pro")], ["deepseek-v4-flash", new ObservedProvider("deepseek-v4-flash")],
  ]), sink: { recordModelTrace: async t => { traces.push(t); }, recordDegradation: async () => undefined, recordCircuitBreak: async () => undefined } });
  await runWithSourceRestrictions(limits, async () => { await e.reason("creative"); await e.reasonRaw("fast", { model: "fast" }); });
  assert.equal(observed.length, 2); assert.equal(traces.length, 2);
  assert.deepEqual(traces.map(t => t.tier), ["L2", "L1"]);
  for (const item of observed) { assert.equal(item.timeout, 240_000); assert.ok(item.messages[0].content.includes(JSON.stringify(limits))); }
});
test("concurrent scopes and later narrative requests do not share source limitations", async () => {
  await withTransport(async (e, bodies) => {
    await Promise.all(["A", "B"].map(label => runWithSourceRestrictions([label], async () => { await Promise.resolve(); await e.reason(label); })));
    for (const body of bodies) {
      const label = body.messages[1].content; assert.ok(body.messages[0].content.includes(JSON.stringify([label])));
      assert.ok(!body.messages[0].content.includes(JSON.stringify([label === "A" ? "B" : "A"])));
    }
    await runWithSourceRestrictions([], () => e.reason("narrative"));
    assert.ok(!bodies[2].messages[0].content.includes("来源的完整用途限制"));
    assert.equal(currentSourceRestrictionPrompt(), "");
  });
});
test("mutated input cannot change a running restriction snapshot and raw binding changes its hash", async () => {
  const copy = [...limits], first = sourceRestrictionsHash("a".repeat(64), copy);
  await runWithSourceRestrictions(copy, async () => { copy[0] = "modified"; assert.ok(currentSourceRestrictionPrompt().includes(JSON.stringify(limits))); });
  assert.notEqual(first, sourceRestrictionsHash("a".repeat(64), copy));
  assert.notEqual(first, sourceRestrictionsHash("b".repeat(64), limits));
});
test("missing, malformed and oversized limits stop before the model callback without truncation", async () => {
  for (const value of [undefined, null, [false], [""], ["x".repeat(30_001)]]) {
    let calls = 0;
    await assert.rejects(runWithSourceRestrictions(value as any, () => { calls += 1; }), /MARKETING_RESTRICTIONS_REQUIRED/);
    assert.equal(calls, 0);
  }
  assert.throws(() => sourceRestrictionsHash("invalid", limits), /MARKETING_RESTRICTIONS_REQUIRED/);
});
test("failed and completed scopes close, preventing detached late model submissions", async () => {
  await withTransport(async (e, bodies) => {
    for (const fails of [false, true]) {
      let trigger!: () => void;
      let late!: Promise<unknown>;
      const scoped = runWithSourceRestrictions(limits, async () => {
        const pending = new Promise<void>(done => { trigger = done; });
        late = pending.then(() => e.reason("late"));
        if (fails) throw new Error("run failed");
      });
      if (fails) await assert.rejects(scoped, /run failed/); else await scoped;
      trigger(); await assert.rejects(late, /MARKETING_RESTRICTIONS_SCOPE_CLOSED/);
    }
    assert.equal(bodies.length, 0);
  });
});
