import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.env.WORKLOOM_ASSERTION_MODULE_ROOT;
assert.ok(root);
const require = createRequire(path.join(root, "package.json"));
const { HyperrealitySystem } = require(path.join(root, "vendor/supermickey/hyperreality-system/index.js"));
const { RequirementListBuilder } = require(path.join(root, "vendor/supermickey/hyperreality-system/engines/script-engine/core/requirement-list-builder.js"));
const { installNativeRequirementContractBridge } = await import(pathToFileURL(path.join(root, "packages/video-studio/src/native-requirement-contract.ts")).href);
const discovery = () => ({ sceneStructure: {
  opening: { duration: 4, purpose: "前台排队停滞", keyElements: ["前台"] },
  scenes: [{ duration: 18, purpose: "女创始人抬手调节摄像头角度，再指向台式双屏自助机", keyElements: ["台式双屏自助机"] }],
  ending: { duration: 8, purpose: "女创始人点头致意", keyElements: ["台式双屏自助机"] }
} });
function fixture(duringCompile?: (fields: any, archives: any, value: any) => void) {
  const system = Object.create(HyperrealitySystem.prototype);
  system.options = {};
  system._profileResolver = { resolve: async () => ({ genre: "商业广告", profileSource: "llm", genreConfidence: "user_explicit", presetRef: "MARKETING",
    profile: { duration_target: 22, aspect_ratio: "16:9", dialogue_density: "low", special_constraints: [] } }) };
  system.requirementDiscoveryEngine = { discover: async () => discovery(), generateMarkdown: () => "原生正文" };
  const archives = { characters: [{ id: "ceo", name: "客户方CEO", identity: { gender: "female" } }], products: [{ id: "demo-t001", name: "台式双屏自助机" }] };
  const fields = { theme: "小机身撑起大前台", description: "女创始人抬手调节摄像头角度", type: "商业广告", duration_sec: 30, _originalStoryText: "现有CEO展示产品" };
  let calls = 0;
  const llm = { reasonStructured: async (prompt: string) => {
    calls++;
    const input = JSON.parse(prompt.split("NATIVE_REQUIREMENT_CONTRACT_INPUT\n")[1]!);
    const value = { characters: [{ name: "客户方CEO", role: "protagonist", sourceId: "archive:character:0", quote: JSON.stringify(input.archives.characters[0]) }],
      props: [{ name: "台式双屏自助机", sourceId: "scene:1", quote: "台式双屏自助机" }],
      actions: [{ description: "女创始人抬手调节摄像头角度", sourceId: "scene:1", quote: "女创始人抬手调节摄像头角度" }], noHumanActors: false };
    await Promise.resolve();
    duringCompile?.(fields, archives, value);
    return { success: true, data: value };
  } };
  const dispose = installNativeRequirementContractBridge(system, { llm, intent: fields._originalStoryText, archives, brief: { duration: 30, aspectRatio: "9:16", platform: "wechat-channels" } });
  return { system, fields, dispose, calls: () => calls };
}
test("mutable converted duration cannot change the G3 contract and downstream ScriptEngine metadata", async () => {
  const f = fixture();
  try {
    const d = await f.system.requirementDiscoveryEngine.discover(f.fields);
    const list = f.system._convertDiscoveryToRequirementList(d, f.fields);
    list.targetDuration = 31;
    const actual = { calls: f.calls(), targetDuration: list.targetDuration, nativeSceneDuration: list._nativeRequirementContract.scenes.reduce((sum: number, row: any) => sum + row.duration, 0),
      scriptEngineDuration: new RequirementListBuilder().toScriptEngineMetadata(list).target_duration };
    process.stdout.write(`DURATION_MUTATION_OBSERVATION ${JSON.stringify(actual)}\n`);
    assert.throws(() => f.system._renderRequirementContract("", {}, list, d), /NATIVE_REQUIREMENT_CONTRACT_UNVERIFIED/);
  } finally { f.dispose(); }
});
test("upstream data changed while the compiler awaits cannot bind old source text to new input", async () => {
  const f = fixture(fields => { fields.description = "已改变为另一份需求"; });
  try {
    const d = await f.system.requirementDiscoveryEngine.discover(f.fields);
    let result: any;
    const consume = () => { result = f.system._convertDiscoveryToRequirementList(d, f.fields); return result; };
    try { consume(); process.stdout.write(`UPSTREAM_MUTATION_OBSERVATION ${JSON.stringify({ calls: f.calls(), currentDescription: f.fields.description, compiledUpstream: JSON.parse(result._nativeRequirementContract.sources.upstream).description, accepted: true })}\n`); }
    catch (error) { process.stdout.write(`UPSTREAM_MUTATION_OBSERVATION ${JSON.stringify({ accepted: false, error: String(error) })}\n`); throw error; }
    assert.throws(consume, /NATIVE_REQUIREMENT_CONTRACT_UNVERIFIED/);
  } finally { f.dispose(); }
});
