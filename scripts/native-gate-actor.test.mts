import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = path.resolve(process.env.WORKLOOM_ASSERTION_MODULE_ROOT ?? new URL("../", import.meta.url).pathname);
const at = (file: string) => import(pathToFileURL(path.join(root, file)).href);
const { STUDIO_WORKER_ACTOR, preproductionGateActor } = await at("apps/server/src/video/preproduction-gate-actor.ts");
const { checkPermission, registerWriteActions, isWhitelistedSystemActor } = await at("packages/base/workdata/gateway.ts");
const pairs = [["G1_DOSSIER", "dossier.confirm"], ["G2_THEME", "theme.confirm"], ["G3_INSIGHT", "insight.confirm"],
  ["G4_PRD", "prd.confirm"], ["G5_PORTRAIT", "portrait.confirm"], ["G6_PROMPT", "prompt.confirm"], ["G7_FINAL", "preproduction.finalize"]];
registerWriteActions([...pairs.map(([, action]) => action), "render.submit", "content.publish", "comment.reply"]);
const event = (action = "dossier.confirm", who: any = { id: "video-studio", type: "system" }) => ({ who,
  context: { tenant_id: "tenant-fixture", workspace_id: "ws-fixture", time: new Date().toISOString(), channel: "inapp" },
  object: { type: "dossier", id: "VID-fixture:g1_dossier" }, decision: { action, effect: "write" }, rule_impact: [] });
test("all seven internal gate actors pass the actual registered write permission guard with stable attribution", () => {
  for (const [gate, action] of pairs) {
    const actor = preproductionGateActor(gate);
    assert.equal(actor.id, "video-studio"); assert.equal(actor.type, "system");
    assert.deepEqual(actor.fenceBindings, [gate.slice(0, 2)]);
    assert.equal(isWhitelistedSystemActor(actor), false);
    assert.doesNotThrow(() => checkPermission(actor, event(action)));
  }
});
test("every binding exists in the current producer declaration without adding an external gate", () => {
  const text = readFileSync(path.join(root, "bundles/ai-video/presets/producer.yml"), "utf8");
  const declaration = text.match(/^fence_bindings:\s*\[([^\]]+)\]/m)?.[1]?.split(",").map((value: string) => value.trim());
  assert.ok(declaration?.length);
  for (const [gate] of pairs) for (const binding of preproductionGateActor(gate).fenceBindings) assert.ok(declaration.includes(binding));
  assert.deepEqual(declaration, ["G1", "G2", "G3", "G4", "G5", "G6", "G7"]);
});
test("render, publication, comments, unknown and inherited property names cannot obtain an internal actor", () => {
  for (const gate of ["G8_RENDER", "G9_PUBLISH", "G10_COMMENT", "G8", "G9", "G10", "", "G1", "G1_DOSSIER ", "__proto__", "constructor", "toString"]) {
    assert.throws(() => preproductionGateActor(gate), /PREPRODUCTION_GATE_ACTOR_INVALID/);
  }
});
test("the base system identity stays unbound and mismatched event attribution still fails the real guard", () => {
  assert.deepEqual(STUDIO_WORKER_ACTOR, { id: "video-studio", type: "system" });
  assert.ok(Object.isFrozen(STUDIO_WORKER_ACTOR)); assert.equal(isWhitelistedSystemActor(STUDIO_WORKER_ACTOR), false);
  for (const action of ["dossier.confirm", "render.submit", "content.publish", "comment.reply"]) {
    assert.throws(() => checkPermission(STUDIO_WORKER_ACTOR, event(action)), /未声明 fence_bindings/);
  }
  for (const who of [{ id: "MEM-owner", type: "human" }, { id: "system", type: "system" }, { id: "video-studio", type: "agent" }]) {
    assert.throws(() => checkPermission(preproductionGateActor("G1_DOSSIER"), event("dossier.confirm", who)), /身份不一致/);
  }
});
test("a mutated per-call binding cannot change a later gate actor or the shared base identity", () => {
  const actor = preproductionGateActor("G1_DOSSIER"); actor.fenceBindings.push("G9"); actor.id = "wrong";
  assert.deepEqual(preproductionGateActor("G1_DOSSIER"), { id: "video-studio", type: "system", fenceBindings: ["G1"] });
  assert.deepEqual(preproductionGateActor("G7_FINAL"), { id: "video-studio", type: "system", fenceBindings: ["G7"] });
  assert.deepEqual(STUDIO_WORKER_ACTOR, { id: "video-studio", type: "system" });
});
