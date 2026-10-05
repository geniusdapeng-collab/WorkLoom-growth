import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const sourceRoot = process.env.NATIVE_PRD_SOURCE_ROOT;
if (!sourceRoot) throw new Error("NATIVE_PRD_SOURCE_ROOT is required");
const sourceUrl = (path: string) => pathToFileURL(join(sourceRoot, path)).href;
const { installNativeRequirementContractBridge } = await import(sourceUrl("packages/video-studio/src/native-requirement-contract.ts"));
const { readPortraitArtifact } = await import(sourceUrl("packages/video-studio/src/character-archive.ts"));
const { withNativePortraitArchives } = await import(sourceUrl("packages/video-studio/src/portrait-archive-bridge.ts"));

const require = createRequire(import.meta.url);
const { HyperrealitySystem } = require(join(sourceRoot, "vendor/supermickey/hyperreality-system/index.js"));
const { PRDGenerator } = require(join(sourceRoot, "vendor/supermickey/hyperreality-system/engines/prd-generator/prd-generator.js"));
const { RequirementListBuilder } = require(join(sourceRoot, "vendor/supermickey/hyperreality-system/engines/script-engine/core/requirement-list-builder.js"));
const { ScriptEngine } = require(join(sourceRoot, "vendor/supermickey/hyperreality-system/engines/script-engine/index.js"));
const { PortraitStudio } = require(join(sourceRoot, "vendor/supermickey/hyperreality-system/engines/portrait-studio/index.js"));
const denied = /NATIVE_PRD_CONTRACT_UNVERIFIED|NATIVE_REQUIREMENT_CONTRACT_UNVERIFIED/;
const bridge = await import(sourceUrl("packages/video-studio/src/native-prd-contract.ts"));
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const angles = ["front", "threeQuarter", "closeup", "side", "back", "actionPose", "emotionCloseup", "handDetail"];
const creative = { coreTheme: "原生创意：小机身撑起大前台", creativeHook: "原生钩子：第一帧前台排队，观众想知道小机器能否解开拥堵",
  emotionalArc: "setup→climax→resolution", keyMessages: ["P0: 自助入住，前台从容"], twistPoint: "原生反转", endingType: "闭合式" };
const production = { visualSpecification: { primaryStyle: "电影级写实", colorPalette: { dominant: "深蓝", accent: "暖白", mood: "从容" },
  lightingDirection: "原生柔和侧光", cameraLanguage: "原生稳定推进", visualReferences: ["实际酒店前台"], textureQuality: "写实", specialVisualEffects: [] },
  audioSpecification: { musicStyle: "原生音乐说明", soundDesign: "原生环境音说明", voicePolicy: "旁白+对白", audioMood: "从容", audioReferences: [] },
  characterSystem: { characters: [{ characterId: "char_001", name: "客户方CEO", role: "主角", ageRange: "中年", appearance: "原生误推外貌",
    personality: "原生误推性格", costume: "原生误推服装", portraitPath: "", consistencyRequirements: "跨镜头一致" }] },
  scenePlan: { scenes: [{ sceneId: "SC01", sequence: 1, purpose: "原生场景目的", duration: 30, emotionalBeat: "climax", setting: "原生酒店场景",
    timeOfDay: "上午", keyProps: ["台式双屏自助机"], visualRequirements: ["原生视觉要求"], audioRequirements: ["原生音频要求"], dialogue: "原生台词不得由桥重写。" }],
    shotMapping: [{ sceneId: "SC01", estimatedShots: 4, shotBreakdownHint: ["wide", "medium", "close-up"] }] } };

function fixture(config: { noArchives?: boolean; actorName?: string; mutate?: (f: any) => void; afterScript?: (f: any, result: any) => void; configure?: (value: any) => void; nativeProduction?: (f: any, output: any) => void } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "native-prd-contract-"));
  const character = { id: "demo-character", name: "客户方CEO", kind: "authorized-real", identity: { gender: "female", age: "三十岁上下", role: "公司CEO" },
    appearance: { face: "受控五官描述" }, wardrobe: { outfit: "受控商务装" }, persona: { speechRate: "平稳", demeanor: "从容" },
    authorization: { consented: true, scope: "internal-film", evidence: "asset://fixture-real-person" }, certified: { identity: "source-profile" } };
  const files = Object.fromEntries(angles.map((angle, index) => {
    const file = join(directory, `${angle}.png`); writeFileSync(file, Buffer.alloc(2048, index + 1)); return [angle, readPortraitArtifact(file)];
  }));
  const archives = { characters: config.noArchives ? [] : [character], products: [], portraits: config.noArchives ? [] :
    [{ kind: "character", id: character.id, name: character.name, aliases: ["客户已选CEO"], files }] };
  config.configure?.({ archives, character, files, directory });
  const brief = { duration: 30, aspectRatio: "9:16", platform: "wechat-channels" };
  const fields = { type: "商业广告", theme: "台式双屏自助机", duration_sec: 22, difficulty: "medium", _originalStoryText: "客户原始需求完整保留。" };
  let discovery: any, f: any;
  const system = Object.create(HyperrealitySystem.prototype);
  system.options = {};
  system._profileResolver = { resolve: async () => ({ genre: "商业广告", profileSource: "fixture-model", profile: { duration_target: 22, aspect_ratio: "16:9", special_constraints: [] } }) };
  system.requirementListBuilder = new RequirementListBuilder();
  system.requirementDiscoveryEngine = { discover: async () => {
    discovery = { upstreamFields: fields, sceneStructure: { totalDuration: 30, sceneCount: 1, opening: { duration: 4, purpose: "原生开场", keyElements: ["酒店前台"] },
      scenes: [{ duration: 18, purpose: "客户方CEO指向台式双屏自助机", keyElements: ["台式双屏自助机"] }], ending: { duration: 8, purpose: "原生收束", keyElements: ["酒店前台"] } },
      audienceProfile: { primaryAudience: { ageRange: "25-50", gender: "all", interestTags: ["酒店经营"] }, emotionTriggers: ["从容"], contentExpectations: ["可信"] },
      riskAssessment: { technicalRisks: [], businessConstraints: ["既有事实红线必须保留"] }, referenceCases: { filmReferences: [] } };
    return discovery;
  }, generateMarkdown: () => "完整原生需求正文" };
  const requirement = installNativeRequirementContractBridge(system, { intent: fields._originalStoryText, archives, brief, llm: { reasonStructured: async (prompt: string) => {
    const input = JSON.parse(prompt.split("NATIVE_REQUIREMENT_CONTRACT_INPUT\n")[1]!);
    return { success: true, data: { characters: input.archives.characters.map((actor: any, index: number) => ({ name: actor.name, role: "protagonist", sourceId: `archive:character:${index}`, quote: JSON.stringify(actor) })),
      props: [], actions: [], noHumanActors: input.archives.characters.length === 0 } };
  } } });
  const prompts: string[] = [];
  system.prdGenerator = new PRDGenerator({});
  // Replace only external LLM responses and the vendor's uncancelled test timer; all five native processors and parsers execute.
  system.prdGenerator._runWithTimeout = async (fn: () => Promise<any>) => fn();
  system.prdGenerator.agent2._callLLM = async (prompt: string) => { prompts.push(prompt); await Promise.resolve(); return { result: structuredClone(creative) }; };
  system.prdGenerator.agent3._callLLM = async (prompt: string) => {
    prompts.push(prompt); await Promise.resolve(); config.mutate?.(f);
    const output = structuredClone(production); output.characterSystem.characters[0]!.name = config.actorName ?? character.name;
    config.nativeProduction?.(f, output);
    return { result: output };
  };
  system._waitForExternalConfirmation = async () => ({ approved: true, suggestions: [], reason: "fixture-system-G4", waitTimeMs: 0 });
  system.scriptEngine = new ScriptEngine({ scriptGenerator: { model: "fixture-model" }, adapter: { charactersDir: directory } });
  system.scriptEngine.scriptGenerator._callLLM = async () => JSON.stringify({ meta: { title: "原生剧本" }, character_system: { characters: [{ character_id: "model-guess", name: "原生模型名", role: "protagonist" }] },
    structure: { acts: [{ act_id: "ACT1", name: "原生叙事" }], scenes: [{ scene_id: "SC01", scene_name: "原生场景", scene_type: "opening", act_id: "ACT1", scene_function: "原生开场",
      timing: { start: 0, duration: 30, end: 30 }, characters: ["model-guess"], setting: { location: "酒店" }, dialogue: { has_dialogue: false, lines: [] }, visual_notes: ["原生镜头"],
      emotional_target: { valence: 0.5, arousal: 0.5, dominance: 0.5 } }] }, world_setting: { world_id: "default" } });
  const originalScript = system.scriptEngine.process;
  system.scriptEngine.process = async function(...args: any[]) { const output = await originalScript.apply(this, args); config.afterScript?.(f, output); return output; };
  const dispose = bridge.installNativePrdContractBridge(system, { requirement: (d: any) => {
    if (typeof (requirement as any).requirements === "function") return (requirement as any).requirements(d);
    return system._convertDiscoveryToRequirementList(d, fields);
  }, archives, brief, subtitleMode: "sidecar" });
  f = { system, fields, archives, brief, prompts, character, directory, files, dispose, requirement, discovery: () => discovery,
    cleanup: () => { try { dispose(); } finally { requirement(); rmSync(directory, { recursive: true, force: true }); } } };
  return f;
}
async function generated(f: any) {
  const discovery = await f.system.requirementDiscoveryEngine.discover(f.fields);
  const requirements = f.system._convertDiscoveryToRequirementList(discovery, f.fields);
  const prd = await f.system.prdGenerator.generate(discovery);
  return { discovery, requirements, prd };
}
async function approved(f: any) {
  const value = await generated(f), markdown = f.system.prdGenerator.generateMarkdown(value.prd);
  await f.system._confirmPRD(markdown, value.prd);
  return { ...value, markdown };
}
function metadata(f: any, requirements: any, prd: any) {
  return { ...f.system.requirementListBuilder.toScriptEngineMetadata(requirements), _prd: prd };
}
async function scoped(config: Parameters<typeof fixture>[0], run: (f: any) => Promise<void>) {
  const f = fixture(config); try { await run(f); } finally { f.cleanup(); }
}

function secondActor(value: any) {
  const actor = structuredClone(value.character); actor.id = "controlled-second-actor"; actor.name = "受控前台员工"; actor.identity.role = "前台员工";
  const files = Object.fromEntries(angles.map((angle, index) => {
    const file = join(value.directory, `second-${angle}.png`); writeFileSync(file, Buffer.alloc(2048, index + 31));
    return [angle, readPortraitArtifact(file)];
  }));
  value.archives.characters.push(actor); value.archives.portraits.push({ kind: "character", id: actor.id, name: actor.name, aliases: ["受控第二人物"], files });
}
test("independent actual native two-character PRD, parser and production-shaped PortraitStudio keep both identities and sixteen current views", () => scoped({
  configure: secondActor,
  nativeProduction: (f, output) => { output.characterSystem.characters.push({ ...structuredClone(output.characterSystem.characters[0]), characterId: "char_002", name: f.archives.characters[1].name }); }
}, async f => {
  const { requirements, prd } = await approved(f);
  assert.deepEqual(prd.characterSystem.characters.map((actor: any) => [actor.characterId, actor.name]), f.archives.characters.map((actor: any) => [actor.id, actor.name]));
  const input = metadata(f, requirements, prd), result = await f.system.scriptEngine.process(f.fields._originalStoryText, input);
  assert.deepEqual(result.adapted.characters.map((actor: any) => [actor.character_id, actor.name]), f.archives.characters.map((actor: any) => [actor.id, actor.name]));
  const plan = await withNativePortraitArchives(f.archives.portraits, async () => new PortraitStudio({}).plan({
    characters: result.blueprint.character_system.characters, products: [], prompts: [], prd, blueprint: result.adapted, sceneContext: { typicalScene: "酒店前台" }
  }));
  assert.equal(plan.characterTasks.length, 2);
  for (const asset of f.archives.portraits) {
    const task = plan.characterTasks.find((task: any) => task.characterId === asset.id);
    assert.ok(task); assert.equal(task.characterName, asset.name); assert.equal(task.source, "controlled-existing-archive");
    assert.deepEqual(task.portraits.map((portrait: any) => [portrait.angle, portrait.outputFile]), angles.map(angle => [angle, asset.files[angle].path]));
  }
  const rows = bridge.nativePrdPortraitEvidence(f.archives); assert.equal(rows.length, 16); assert.equal(new Set(rows.map((row: any) => row.receipt.path)).size, 16);
}));
test("independent selected same-name profiles with different IDs fail before native agent prompts", async () => {
  const f = fixture({ configure: value => { secondActor(value); value.archives.characters[1].name = value.character.name; value.archives.portraits[1].name = value.character.name; } });
  try { await assert.rejects(() => generated(f), denied); assert.equal(f.prompts.length, 0); } finally { f.cleanup(); }
});
test("independent a selected profile cannot be dropped by an empty native character output", () => scoped({ nativeProduction: (_f, output) => { output.characterSystem.characters = []; } }, async f => {
  await assert.rejects(() => generated(f), denied);
}));
test("independent a native ID naming the other selected archive cannot be rebound by matching only its name", () => scoped({
  configure: secondActor,
  nativeProduction: (f, output) => { output.characterSystem.characters[0].characterId = f.archives.characters[1].id;
    output.characterSystem.characters.push({ ...structuredClone(output.characterSystem.characters[0]), name: f.archives.characters[1].name }); }
}, async f => { await assert.rejects(() => generated(f), denied); }));
test("independent foreign-instance approved PRDs cannot be consumed by another actual ScriptEngine", async () => {
  const first = fixture(), second = fixture();
  try { const [a, b] = await Promise.all([approved(first), approved(second)]);
    await assert.rejects(() => second.system.scriptEngine.process("客户需求", metadata(second, b.requirements, a.prd)), denied);
  } finally { first.cleanup(); second.cleanup(); }
});
test("independent a non-front original photo changed during actual G4 await invalidates approval", () => scoped({}, async f => {
  f.system._waitForExternalConfirmation = async () => { writeFileSync(f.files.back.path, Buffer.alloc(2048, 115)); return { approved: true, suggestions: [] }; };
  const { prd } = await generated(f), md = f.system.prdGenerator.generateMarkdown(prd);
  await assert.rejects(() => f.system._confirmPRD(md, prd), denied);
}));
test("independent a non-front original photo changed during actual ScriptEngine await invalidates output", () => scoped({ afterScript: f => { writeFileSync(f.files.handDetail.path, Buffer.alloc(2048, 116)); } }, async f => {
  const { requirements, prd } = await approved(f); await assert.rejects(() => f.system.scriptEngine.process("客户需求", metadata(f, requirements, prd)), denied);
}));
test("independent G4 native confirmation exceptions leave the PRD unapproved", () => scoped({}, async f => {
  f.system._waitForExternalConfirmation = async () => { throw new Error("independent-confirmation-transport-failure"); };
  const { requirements, prd } = await generated(f), md = f.system.prdGenerator.generateMarkdown(prd);
  await assert.rejects(() => f.system._confirmPRD(md, prd), /independent-confirmation-transport-failure/);
  await assert.rejects(() => f.system.scriptEngine.process("客户需求", metadata(f, requirements, prd)), denied);
}));

test("independent changed complete character description cannot borrow unchanged G3 identity keys before actual ScriptEngine consumption", () => scoped({}, async f => {
  const { requirements, prd } = await approved(f), input = metadata(f, requirements, prd);
  input.characters[0].description = "另一位中年男性总经理，外貌、服装和授权与已选CEO不一致";
  await assert.rejects(() => f.system.scriptEngine.process("客户需求", input), denied);
}));

const { BaseAgent } = require(join(sourceRoot, "vendor/supermickey/hyperreality-system/engines/production-engine/agents/base-agent.js"));
test("independent actual BaseAgent PARSE retry keeps every complete source receipt in both model requests", () => scoped({}, async f => {
  const agent = f.system.prdGenerator.agent2, requests: string[] = [];
  agent._callLLM = BaseAgent.prototype._callLLM;
  agent._getLLMEngine = () => ({ reasonStructured: async (prompt: string) => {
    requests.push(prompt);
    if (requests.length === 1) return { success: false, error: "independent JSON parse failed" };
    return { success: true, data: structuredClone(creative) };
  } });
  const { requirements, prd } = await generated(f); assert.equal(requests.length, 2);
  const payload = { schema: "workloom.native-prd-contract/v1", sourceSha256: prd._nativePrdContract.sourceSha256,
    brief: { duration: requirements.targetDuration, aspectRatio: requirements.aspectRatio, platform: requirements.platform },
    characters: requirements.characters, archives: f.archives, portraits: bridge.nativePrdPortraitEvidence(f.archives),
    subtitleDelivery: prd.deliveryStandard.subtitleDelivery };
  assert.match(payload.sourceSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(payload.archives.characters, [f.character]); assert.equal(payload.portraits.length, 8);
  assert.deepEqual(payload.portraits.map((row: any) => [row.id, row.name, row.angle, row.receipt]),
    angles.map(angle => [f.character.id, f.character.name, angle, f.files[angle]]));
  assert.deepEqual(payload.brief, { duration: 30, aspectRatio: "9:16", platform: "wechat-channels" });
  const completeCurrentSource = JSON.stringify(payload);
  for (const prompt of requests) assert.ok(prompt.includes(completeCurrentSource), "each actual provider request must contain the entire same current source JSON; repeated fragments are insufficient");
}));

test("independent nested aspect alias mutation during the actual ScriptGenerator model await cannot change G3 output", () => scoped({}, async f => {
  const { requirements, prd } = await approved(f), input = metadata(f, requirements, prd);
  input._metadata = { _prd: prd, aspectRatio: "9:16" };
  const nativeResponse = f.system.scriptEngine.scriptGenerator._callLLM;
  f.system.scriptEngine.scriptGenerator._callLLM = async function(...args: any[]) {
    await Promise.resolve(); input._metadata.aspectRatio = "16:9";
    return nativeResponse.apply(this, args);
  };
  await assert.rejects(() => f.system.scriptEngine.process("客户需求", input), denied);
}));
