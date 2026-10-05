import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { MockProvider } from "@workloom/base/model-router";
import { WorkloomLLMEngine, runWithVendorEngine } from "../packages/video-studio/src/llm-adapter.js";
import { runWithSourceRestrictions } from "../packages/video-studio/src/source-restrictions.js";

const { LLMEngine } = createRequire(import.meta.url)("../vendor/supermickey/systems/llm-reasoning-engine.js");
const vendor = () => new LLMEngine({ apiKey: "fixture-vendor-never-used" });
const engine = (label: string) => new WorkloomLLMEngine({ baseUrl: `https://${label}.example.test`, apiKey: `fixture-${label}`, model: `${label}-main`, fastModel: `${label}-fast` });
async function withTransport(run: (observed: any[]) => Promise<void>) {
  const original = globalThis.fetch, observed: any[] = [];
  globalThis.fetch = async (url, init) => {
    observed.push({ url: String(url), ...JSON.parse(String(init?.body)) });
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  };
  try { await run(observed); } finally { globalThis.fetch = original; }
}
test("interleaved native vendor interfaces retain provider, options and complete source restrictions", async () => {
  await withTransport(async observed => {
    const tasks = ["tenant-a", "tenant-b"].map(label => runWithVendorEngine(engine(label), () => runWithSourceRestrictions([label + " original limits"], async () => {
      const v = vendor();
      await Promise.resolve();
      await v.reason(label + ":reason"); await v.reasonRaw(label + ":raw");
      await v.reasonStructured(label + ":structured", { type: "object" }, { model: label + "-fast", systemPrompt: label + " custom system", maxTokens: 123, temperature: 0 });
      await v.chat(label + " custom chat", label + ":chat", 0); await v.generate(label + ":generate");
    })));
    await Promise.all(tasks); assert.equal(observed.length, 10);
    for (const call of observed) {
      const label = call.messages[1].content.split(":")[0];
      assert.equal(call.url, `https://${label}.example.test/chat/completions`);
      assert.ok(call.messages[0].content.includes(JSON.stringify([label + " original limits"])));
      assert.ok(!call.messages[0].content.includes(label === "tenant-a" ? "tenant-b original" : "tenant-a original"));
      assert.equal(call.model, label + (call.messages[1].content.endsWith(":structured") ? "-fast" : "-main"));
    }
    for (const call of observed.filter(call => call.messages[1].content.endsWith(":structured"))) {
      assert.equal(call.max_tokens, 123); assert.equal(call.temperature, 0);
      assert.ok(call.messages[0].content.startsWith(call.messages[1].content.split(":")[0] + " custom system"));
      assert.equal(call.response_format.type, "json_object");
    }
    for (const call of observed.filter(call => call.messages[1].content.endsWith(":chat"))) assert.equal(call.temperature, 0);
  });
});
test("concurrent routed vendor requests preserve each tenant sink and primary/fast billing tier", async () => {
  const observations: any[] = [], traces = new Map<string, any[]>();
  class Provider extends MockProvider {
    constructor(private readonly label: string, id: string) { super(id); }
    override async chat(messages: Parameters<MockProvider["chat"]>[0], options: Parameters<MockProvider["chat"]>[1]) {
      observations.push({ label: this.label, prompt: messages[1]!.content }); return super.chat(messages, options);
    }
  }
  await Promise.all(["tenant-a", "tenant-b"].map(label => {
    const e = engine(label), rows: any[] = []; traces.set(label, rows);
    e.attachRouter({ providers: new Map([["deepseek-v4-pro", new Provider(label, "deepseek-v4-pro")], ["deepseek-v4-flash", new Provider(label, "deepseek-v4-flash")]]),
      sink: { recordModelTrace: async trace => { rows.push(trace); }, recordDegradation: async () => undefined, recordCircuitBreak: async () => undefined } });
    return runWithVendorEngine(e, async () => {
      const v = vendor(); await Promise.resolve();
      assert.equal((await v.reason(label + ":primary")).success, true);
      assert.equal((await v.reasonRaw(label + ":fast", { model: label + "-fast" })).success, true);
    });
  }));
  assert.equal(observations.length, 4);
  for (const call of observations) assert.ok(call.prompt.startsWith(call.label + ":"));
  for (const rows of traces.values()) { assert.equal(rows.length, 2); assert.deepEqual(rows.map(row => row.tier), ["L2", "L1"]); }
});
test("fixed bridge rejects every unscoped interface without contacting any provider", async () => {
  await withTransport(async observed => {
    await runWithVendorEngine(engine("scope"), () => undefined);
    const v = vendor();
    for (const invoke of [() => v.reason("x"), () => v.reasonRaw("x"), () => v.reasonStructured("x", {}), () => v.chat("x", "x"), () => v.generate("x")]) {
      await assert.rejects(invoke(), /VENDOR_ENGINE_SCOPE_MISSING/);
    }
    assert.equal(observed.length, 0);
  });
});
test("nested native tasks restore the parent engine after child failure", async () => {
  await withTransport(async observed => {
    await runWithVendorEngine(engine("parent"), async () => {
      const v = vendor(); await v.reason("before");
      await assert.rejects(runWithVendorEngine(engine("child"), async () => { await v.reason("child"); throw new Error("child failed"); }), /child failed/);
      await v.reason("after");
    });
    assert.deepEqual(observed.map(call => call.model), ["parent-main", "child-main", "parent-main"]);
  });
});
test("completed and failed run scopes reject detached late submissions", async () => {
  await withTransport(async observed => {
    for (const fail of [false, true]) {
      let trigger!: () => void, late!: Promise<unknown>;
      const task = runWithVendorEngine(engine("ended"), async () => {
        const pending = new Promise<void>(done => { trigger = done; });
        late = pending.then(() => vendor().reason("late"));
        if (fail) throw new Error("failed");
      });
      if (fail) await assert.rejects(task, /failed/); else await task;
      trigger(); await assert.rejects(late, /VENDOR_ENGINE_SCOPE_CLOSED/);
    }
    assert.equal(observed.length, 0);
  });
});
test("a response arriving after its detached run closes cannot resume the native chain", async () => {
  const original = globalThis.fetch;
  let respond!: () => void, inflight!: Promise<unknown>;
  globalThis.fetch = async () => { await new Promise<void>(done => { respond = done; }); return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }); };
  try {
    await runWithVendorEngine(engine("closed"), () => { inflight = vendor().reason("started during scope"); });
    const rejection = assert.rejects(inflight, /VENDOR_ENGINE_SCOPE_CLOSED/);
    respond(); await rejection;
  } finally { globalThis.fetch = original; }
});
test("a replaced dispatcher prevents task entry and does not silently route to another engine", async () => {
  await runWithVendorEngine(engine("installed"), () => undefined);
  const original = LLMEngine.prototype.reason;
  LLMEngine.prototype.reason = async () => ({ success: true, content: "unauthorized" });
  let entered = false;
  try { await assert.rejects(runWithVendorEngine(engine("blocked"), () => { entered = true; }), /VENDOR_ENGINE_DISPATCHER_CONFLICT/); }
  finally { LLMEngine.prototype.reason = original; }
  assert.equal(entered, false);
});
