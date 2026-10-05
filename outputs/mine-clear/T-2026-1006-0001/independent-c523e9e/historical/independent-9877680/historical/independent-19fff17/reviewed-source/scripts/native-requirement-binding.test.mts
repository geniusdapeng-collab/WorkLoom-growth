import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { installNativeRequirementContractBridge } from "../packages/video-studio/src/native-requirement-contract.ts";

const require = createRequire(import.meta.url);
const { HyperrealitySystem } = require("../vendor/supermickey/hyperreality-system/index.js");
const { RequirementListBuilder } = require("../vendor/supermickey/hyperreality-system/engines/script-engine/core/requirement-list-builder.js");
const denied = /NATIVE_REQUIREMENT_CONTRACT_UNVERIFIED/;
const purpose = "女创始人抬手调节摄像头角度，再指向台式双屏自助机";
type Hooks = { discovery?: (f: any, d: any) => void; conversion?: (f: any, d: any) => void; compilation?: (context: any) => void };
function fixture(hooks: Hooks = {}) {
  const system = Object.create(HyperrealitySystem.prototype);
  system.options = {};
  system.requirementListBuilder = new RequirementListBuilder();
  let profileCalls = 0, contractCalls = 0, lastDiscovery: any;
  system._profileResolver = { resolve: async () => { profileCalls++; return { genre: "商业广告", profileSource: "llm", genreConfidence: "user_explicit", presetRef: "MARKETING",
    profile: { duration_target: 22, aspect_ratio: "16:9", dialogue_density: "low", special_constraints: [] } }; } };
  system.requirementDiscoveryEngine = { discover: async (f: any) => {
    lastDiscovery = { sceneStructure: { opening: { duration: 4, purpose: "前台排队停滞", keyElements: ["前台"] },
      scenes: [{ duration: 18, purpose, keyElements: ["台式双屏自助机"] }], ending: { duration: 8, purpose: "女创始人点头致意", keyElements: ["台式双屏自助机"] } } };
    await Promise.resolve(); hooks.discovery?.(f, lastDiscovery); return lastDiscovery;
  }, generateMarkdown: () => "完整原生正文" };
  const originalConvert = system._convertDiscoveryToRequirementList;
  system._convertDiscoveryToRequirementList = async (d: any, f: any) => {
    const list = await originalConvert.call(system, d, f);
    await Promise.resolve(); hooks.conversion?.(f, d); return list;
  };
  const fields = { theme: "小机身撑起大前台", description: purpose, type: "商业广告", duration_sec: 30, _originalStoryText: "现有CEO展示产品" };
  const archives = { characters: [{ id: "ceo", name: "客户方CEO", identity: { gender: "female" } }], products: [{ id: "demo-t001", name: "台式双屏自助机" }] };
  const brief = { duration: 30, aspectRatio: "9:16", platform: "wechat-channels" };
  const options = { llm: { reasonStructured: async (prompt: string) => {
    contractCalls++; const input = JSON.parse(prompt.split("NATIVE_REQUIREMENT_CONTRACT_INPUT\n")[1]!);
    const data = { characters: [{ name: "客户方CEO", role: "protagonist", sourceId: "archive:character:0", quote: JSON.stringify(input.archives.characters[0]) }],
      props: [{ name: "台式双屏自助机", sourceId: "scene:1", quote: "台式双屏自助机" }],
      actions: [{ description: "女创始人抬手调节摄像头角度", sourceId: "scene:1", quote: "女创始人抬手调节摄像头角度" }], noHumanActors: false };
    await Promise.resolve(); hooks.compilation?.({ fields, archives, brief, options, discovery: lastDiscovery });
    return { success: true, data };
  } }, intent: fields._originalStoryText, archives, brief };
  const dispose = installNativeRequirementContractBridge(system, options);
  return { system, fields, archives, brief, options, dispose, counts: () => ({ profileCalls, contractCalls }) };
}
async function compiled(f: ReturnType<typeof fixture>) {
  const discovery = await f.system.requirementDiscoveryEngine.discover(f.fields);
  return { discovery, list: f.system._convertDiscoveryToRequirementList(discovery, f.fields) };
}
function writeDenied(action: () => void) {
  assert.throws(action, /Cannot assign|Cannot add|read only|not extensible|Cannot redefine|NATIVE_REQUIREMENT_CONTRACT_UNVERIFIED/);
}
test("converted duration, platform, aspect and profile cannot diverge from the G3 and actual ScriptEngine contract", async () => {
  const f = fixture(); try {
    const { discovery, list } = await compiled(f);
    for (const action of [() => { list.targetDuration = 31; }, () => { list.aspectRatio = "16:9"; },
      () => { list.platform = "other"; }, () => { list.productionProfile.duration_target = 31; },
      () => { Object.defineProperty(list, "targetDuration", { value: 31 }); }]) writeDenied(action);
    assert.match(f.system._renderRequirementContract("", {}, list, discovery), /时长 30s/);
    assert.equal(new RequirementListBuilder().toScriptEngineMetadata(list).target_duration, 30);
    assert.deepEqual(f.counts(), { profileCalls: 1, contractCalls: 1 });
  } finally { f.dispose(); }
});
test("selected actors, full scenes and source citations cannot be replaced after conversion", async () => {
  const f = fixture(); try {
    const { discovery, list } = await compiled(f);
    for (const action of [() => { list.characters[0].name = "未选模特"; }, () => { list.structure.scenes[0].purpose = "新故事"; },
      () => { list._nativeRequirementContract.sources.upstream = "新输入"; }, () => { list.characters = []; },
      () => { list.structure.scenes.push({ duration: 5 }); }]) writeDenied(action);
    assert.match(f.system._renderRequirementContract("", {}, list, discovery), /客户方CEO/);
    assert.equal(new RequirementListBuilder().toScriptEngineMetadata(list).characters[0].name, "客户方CEO");
  } finally { f.dispose(); }
});
test("input changed during contract model await is rejected rather than binding old sources to new input", async () => {
  const f = fixture({ compilation: ({ fields }) => { fields.description = "另一份需求"; } }); try {
    await assert.rejects(() => compiled(f), denied); assert.deepEqual(f.counts(), { profileCalls: 1, contractCalls: 1 });
  } finally { f.dispose(); }
});
test("input changed during native discovery is rejected before profile or contract calls", async () => {
  const f = fixture({ discovery: fields => { fields.description = "另一份需求"; } }); try {
    await assert.rejects(() => compiled(f), denied); assert.deepEqual(f.counts(), { profileCalls: 0, contractCalls: 0 });
  } finally { f.dispose(); }
});
test("discovery changed during native async conversion is rejected before contract compilation", async () => {
  const f = fixture({ conversion: (_fields, discovery) => { discovery.sceneStructure.scenes[0].purpose = "另一份故事"; } }); try {
    await assert.rejects(() => compiled(f), denied); assert.deepEqual(f.counts(), { profileCalls: 1, contractCalls: 0 });
  } finally { f.dispose(); }
});
test("trusted archive, brief and intent changes during await cannot replace entry source authority", async () => {
  for (const mutation of [(c: any) => { c.archives.characters[0].identity.gender = "male"; },
    (c: any) => { c.brief.aspectRatio = "16:9"; }, (c: any) => { c.options.intent = "另一产品"; },
    (c: any) => { c.discovery.sceneStructure.scenes[0].keyElements.push("另一产品"); }]) {
    const f = fixture({ compilation: mutation }); try { await assert.rejects(() => compiled(f), denied); }
    finally { f.dispose(); }
  }
});
test("legitimate native creative, emotion and content extensions remain usable with protected authority", async () => {
  const f = fixture(); try {
    const { discovery, list } = await compiled(f);
    list.creativeIntensity = 0.73; list.emotionProfile = { primary: "信任" }; list.contentConstraints = ["保留真实产品外观"];
    assert.match(f.system._renderRequirementContract("", {}, list, discovery), /客户方CEO/);
    assert.equal(f.system._convertDiscoveryToRequirementList(discovery, f.fields), list);
    assert.equal(list.creativeIntensity, 0.73); assert.deepEqual(list.emotionProfile, { primary: "信任" });
    assert.deepEqual(list.contentConstraints, ["保留真实产品外观"]);
    assert.equal(new RequirementListBuilder().toScriptEngineMetadata(list).target_duration, 30);
  } finally { f.dispose(); }
});
test("finished native scope rejects a compiler result returning after cleanup", async () => {
  let f: ReturnType<typeof fixture>; f = fixture({ compilation: () => { f.dispose(); } });
  try { await assert.rejects(() => compiled(f), denied); } finally { f.dispose(); }
});
test("changed input after compilation cannot consume its earlier converted authority", async () => {
  const f = fixture(); try {
    const { discovery, list } = await compiled(f); f.fields.description = "另一份需求";
    assert.throws(() => f.system._convertDiscoveryToRequirementList(discovery, f.fields), denied);
    assert.throws(() => f.system._renderRequirementContract("", {}, list, discovery), denied);
  } finally { f.dispose(); }
});
test("actual native metadata consumption validates authority and returns an independent mutable downstream copy", async () => {
  const f = fixture(); try {
    const { discovery, list } = await compiled(f);
    const metadata = f.system.requirementListBuilder.toScriptEngineMetadata(list);
    metadata.characters[0].description = "下游合法扩展";
    metadata.structure.scenes[0].keyElements.push("下游合法扩展");
    assert.notEqual(metadata.characters, list.characters);
    assert.notEqual(metadata.structure.scenes[0].keyElements, list.structure.scenes[0].keyElements);
    assert.notEqual(list.characters[0].description, "下游合法扩展");
    assert.deepEqual(list.structure.scenes[0].keyElements, ["台式双屏自助机"]);
    assert.match(f.system._renderRequirementContract("", {}, list, discovery), /客户方CEO/);
    assert.throws(() => f.system.requirementListBuilder.toScriptEngineMetadata({ ...list, targetDuration: 31 }), denied);
  } finally { f.dispose(); }
});
