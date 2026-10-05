import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { HyperrealitySystem } = require("../vendor/supermickey/hyperreality-system/index.js");
const modulePath = new URL("../packages/video-studio/src/native-requirement-contract.ts", import.meta.url);
const install = existsSync(fileURLToPath(modulePath))
  ? (await import(modulePath.href)).installNativeRequirementContractBridge
  : () => () => undefined;
const profile = { id: "ceo", name: "客户方CEO", identity: { gender: "female", age: "三十岁上下" },
  wardrobe: [{ name: "黑色小香风套装" }], persona: { speechRate: "3.2 字/秒" } };
const purpose = "女创始人从画右走入，身穿黑色小香风套装，抬手调节顶部摄像头角度，再以手掌摊开指向台式双屏自助机；观众完整看到角色、产品与动作，理解小机身承担前台任务的具体用途。";
const discovery = () => ({ audienceProfile: { primaryAudience: { ageRange: "40+", gender: "all", interestTags: ["酒店经营"] } },
  sceneStructure: { totalScenes: 1, totalDuration: 30, opening: { duration: 4, purpose: "前台排队停滞", keyElements: ["酒店前台"] },
    scenes: [{ name: "展示", duration: 18, purpose, keyElements: ["台式双屏自助机", "黑色小香风套装", "角度调节摄像头"] }],
    ending: { duration: 8, purpose: "女创始人收手、点头致意", keyElements: ["台式双屏自助机"] } },
  riskAssessment: { technicalRisks: [{ level: "high", risk: "屏幕与手部容易失真，产品外观必须保留完整的客户原图证据，不可改写为虚构屏幕与组件。" }], mitigationSuggestions: ["使用档案实拍与已验收真人素材"] },
  referenceCases: { films: [], styleReferences: [] } });
async function fixture(change?: (value: any) => void, name = "客户方CEO") {
  const system = Object.create(HyperrealitySystem.prototype);
  system.options = {};
  let profileCalls = 0, contractCalls = 0;
  system._profileResolver = { resolve: async () => { profileCalls++; await Promise.resolve(); return {
    genre: "商业广告", genreConfidence: "user_explicit", presetRef: "MARKETING", profileSource: "llm",
    profile: { duration_target: 22, aspect_ratio: "16:9", dialogue_density: "low", world_setting: "现实世界", special_constraints: [] } }; } };
  system.requirementDiscoveryEngine = { discover: async () => discovery(), _fastMode: () => discovery(), generateMarkdown: () => "# 完整需求洞察\n## 三、最终业务需求确认\n□ 以上清单确认无误，进入 PRD 环节\n**请回复：确认 / 修改：xxx / 重新生成**" };
  const sourcesSeen: any[] = [];
  const llm = { reasonStructured: async (prompt: string) => {
    contractCalls++; const input = JSON.parse(prompt.split("NATIVE_REQUIREMENT_CONTRACT_INPUT\n")[1]!); sourcesSeen.push(input);
    const value = { characters: [{ name, role: "protagonist", sourceId: "archive:character:0", quote: JSON.stringify(input.archives.characters[0]) }],
      props: [{ name: "台式双屏自助机", sourceId: "scene:1", quote: "台式双屏自助机" }],
      actions: [{ description: "抬手调节顶部摄像头角度", sourceId: "scene:1", quote: "抬手调节顶部摄像头角度" }],
      noHumanActors: false };
    change?.(value); return { success: true, data: value };
  } };
  const archives = { characters: [{ ...profile, name }], products: [{ id: "product", name: "台式双屏自助机" }] };
  const fields = { theme: "小机身撑起大前台", description: purpose, type: "商业广告", duration_sec: 30, visual_style: "精密商业", creative_style: 0.6, _originalStoryText: "系统已有出镜人物为主角，不新增模特。" };
  const dispose = install(system, { llm, intent: fields._originalStoryText, archives, brief: { duration: 30, aspectRatio: "9:16", platform: "wechat-channels" } });
  return { system, fields, dispose, sourcesSeen, counts: () => ({ profileCalls, contractCalls }) };
}
test("native discovery returns a resolved requirement object before the vendor's synchronous conversion call", async () => {
  const f = await fixture(); try {
    const d = await f.system.requirementDiscoveryEngine.discover(f.fields);
    const list = f.system._convertDiscoveryToRequirementList(d, f.fields);
    assert.equal(typeof list?.then, "undefined"); assert.equal(list.targetDuration, 30);
    assert.equal(list.platform, "wechat-channels"); assert.equal(list.aspectRatio, "9:16");
    assert.equal(list.productionProfile.duration_target, 30); assert.equal(list.genre, "商业广告");
    assert.deepEqual(f.counts(), { profileCalls: 1, contractCalls: 1 });
  } finally { f.dispose(); }
});
test("current archive actor reaches G3 and the actual native ScriptEngine metadata without guessing identity", async () => {
  const f = await fixture(); try {
    const d = await f.system.requirementDiscoveryEngine.discover(f.fields), list = f.system._convertDiscoveryToRequirementList(d, f.fields);
    const markdown = f.system._renderRequirementContract("", {}, list, d);
    assert.match(markdown, /客户方CEO/); assert.doesNotMatch(markdown, /无真人角色/);
    assert.match(markdown, /female/); assert.match(markdown, /黑色小香风套装/);
    const { RequirementListBuilder } = require("../vendor/supermickey/hyperreality-system/engines/script-engine/core/requirement-list-builder.js");
    const metadata = new RequirementListBuilder().toScriptEngineMetadata(list);
    assert.equal(metadata.characters[0].name, "客户方CEO"); assert.equal(metadata.target_duration, 30);
  } finally { f.dispose(); }
});
test("full scene purposes, source-backed props and actions survive conversion without keyword fragments", async () => {
  const f = await fixture(); try {
    const d = await f.system.requirementDiscoveryEngine.discover(f.fields), list = f.system._convertDiscoveryToRequirementList(d, f.fields);
    const markdown = f.system._renderRequirementContract("", {}, list, d);
    assert.ok(markdown.includes(purpose)); assert.ok(markdown.includes("抬手调节顶部摄像头角度"));
    assert.deepEqual(list.structure.scenes[0].keyElements, d.sceneStructure.scenes[0].keyElements);
    assert.equal(list.structure.scenes[0].duration, 18); assert.deepEqual(list._nativeRequirementContract.props.map((p: any) => p.name), ["台式双屏自助机"]);
    assert.match(markdown, /主体场景 1/); assert.match(markdown, /段落 3/);
  } finally { f.dispose(); }
});
test("invented sources, unrelated quotes and missing selected actors stop before G3", async () => {
  for (const mutate of [(v: any) => { v.actions[0].sourceId = "other-project"; }, (v: any) => { v.props[0].quote = "不存在的飞船"; },
    (v: any) => { v.characters = []; v.noHumanActors = true; }]) {
    const f = await fixture(mutate); try { await assert.rejects(() => f.system.requirementDiscoveryEngine.discover(f.fields), /NATIVE_REQUIREMENT_CONTRACT_UNVERIFIED/); }
    finally { f.dispose(); }
  }
});
test("conversion fallback cannot consume an uncompiled or different discovery object", async () => {
  const f = await fixture(); try {
    await f.system.requirementDiscoveryEngine.discover(f.fields);
    assert.throws(() => f.system._convertDiscoveryToRequirementList(discovery(), f.fields), /NATIVE_REQUIREMENT_CONTRACT_UNVERIFIED/);
  } finally { f.dispose(); }
});
test("concurrent native instances retain their own actors, sources and conversion caches", async () => {
  const a = await fixture(undefined, "CEO-A"), b = await fixture(undefined, "CEO-B"); try {
    const [da, db] = await Promise.all([a.system.requirementDiscoveryEngine.discover(a.fields), b.system.requirementDiscoveryEngine.discover(b.fields)]);
    b.dispose(); const la = a.system._convertDiscoveryToRequirementList(da, a.fields);
    assert.equal(la.characters[0].name, "CEO-A"); assert.match(a.system._renderRequirementContract("", {}, la, da), /CEO-A/);
    assert.throws(() => a.system._convertDiscoveryToRequirementList(db, b.fields), /NATIVE_REQUIREMENT_CONTRACT_UNVERIFIED/);
  } finally { a.dispose(); b.dispose(); }
});
