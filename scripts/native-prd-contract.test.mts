import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installNativeRequirementContractBridge } from "../packages/video-studio/src/native-requirement-contract.ts";
import { readPortraitArtifact } from "../packages/video-studio/src/character-archive.ts";
import { withNativePortraitArchives } from "../packages/video-studio/src/portrait-archive-bridge.ts";

const require = createRequire(import.meta.url);
const { HyperrealitySystem } = require("../vendor/supermickey/hyperreality-system/index.js");
const { PRDGenerator } = require("../vendor/supermickey/hyperreality-system/engines/prd-generator/prd-generator.js");
const { RequirementListBuilder } = require("../vendor/supermickey/hyperreality-system/engines/script-engine/core/requirement-list-builder.js");
const { ScriptEngine } = require("../vendor/supermickey/hyperreality-system/engines/script-engine/index.js");
const { PortraitStudio } = require("../vendor/supermickey/hyperreality-system/engines/portrait-studio/index.js");
const denied = /NATIVE_PRD_CONTRACT_UNVERIFIED|NATIVE_REQUIREMENT_CONTRACT_UNVERIFIED/;
let bridge: any;
try { bridge = await import("../packages/video-studio/src/native-prd-contract.ts"); }
catch (error) {
  // The red baseline executes the original five agents; absence of the proposed bridge is never the assertion.
  if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND" || !String(error).includes("native-prd-contract")) throw error;
  bridge = { installNativePrdContractBridge: () => () => undefined, nativePrdPortraitEvidence: () => [] };
}
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

function fixture(config: { noArchives?: boolean; actorName?: string; mutate?: (f: any) => void; afterScript?: (f: any, result: any) => void } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "native-prd-contract-"));
  const character = { id: "demo-character", name: "客户方CEO", kind: "authorized-real", identity: { gender: "female", age: "三十岁上下", role: "公司CEO" },
    appearance: { face: "受控五官描述" }, wardrobe: { outfit: "受控商务装" }, persona: { speechRate: "平稳", demeanor: "从容" },
    authorization: { consented: true, scope: "internal-film", evidence: "asset://fixture-real-person" }, certified: { identity: "source-profile" } };
  const files = Object.fromEntries(angles.map((angle, index) => {
    const file = join(directory, `${angle}.png`); writeFileSync(file, Buffer.alloc(2048, index + 1)); return [angle, readPortraitArtifact(file)];
  }));
  const archives = { characters: config.noArchives ? [] : [character], products: [], portraits: config.noArchives ? [] :
    [{ kind: "character", id: character.id, name: character.name, aliases: ["客户已选CEO"], files }] };
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

test("native five-agent PRD binds the exact selected CEO attributes and current portrait path", () => scoped({}, async f => {
  const { prd } = await generated(f), actor = prd.characterSystem.characters[0];
  assert.equal(actor.characterId, f.character.id); assert.equal(actor.name, f.character.name); assert.equal(actor.ageRange, "三十岁上下");
  assert.equal(actor.appearance, JSON.stringify(f.character.appearance)); assert.equal(actor.costume, JSON.stringify(f.character.wardrobe));
  assert.equal(actor.portraitPath, f.files.front.path); assert.equal(actor.needsPortrait, false);
}));
test("native agent2 and agent3 prompts receive the complete archive identity, authorization and every original photo hash", () => scoped({}, async f => {
  await generated(f); assert.equal(f.prompts.length, 2);
  for (const prompt of f.prompts) { assert.match(prompt, /workloom.native-prd-contract/); assert.match(prompt, /三十岁上下/); assert.match(prompt, /internal-film/);
    for (const file of Object.values(f.files) as any[]) assert.ok(prompt.includes(file.sha256)); }
}));
test("PRD positioning, duration, aspect and summary consume the same G3 authority", () => scoped({}, async f => {
  const { prd } = await generated(f); assert.equal(prd.productPositioning.targetPlatform, "wechat-channels");
  assert.equal(prd.productPositioning.targetDuration, 30); assert.equal(prd.productPositioning.aspectRatio, "9:16"); assert.equal(prd.prdSummary.duration, "30秒");
}));
test("production quality and acceptance use the strictest original threshold, including score aliases", () => scoped({}, async f => {
  const { prd } = await generated(f), expected = { visual: 0.8, audio: 0.75, narrative: 0.85, consistency: 0.75 };
  for (const [key, value] of Object.entries(expected)) { assert.equal(prd.productionConstraints.qualityThresholds[key], value);
    assert.equal(prd.deliveryStandard.acceptanceCriteria[key], value); assert.equal(prd.deliveryStandard.acceptanceCriteria[`${key}Score`], value); }
}));
test("subtitle delivery is verifiable and matches the original full-chain default sidecar mode", () => scoped({}, async f => {
  const { prd } = await generated(f); assert.equal(prd.deliveryStandard.subtitleDelivery.mode, "sidecar");
  assert.equal(prd.deliveryStandard.subtitleDelivery.masterBurnedIn, false);
  assert.deepEqual(prd.deliveryStandard.subtitleDelivery.formats, ["srt", "ass", "vtt"]); assert.equal(prd.deliveryStandard.subtitleDelivery.softSubtitleTrack, true);
  assert.match(readFileSync(new URL("../scripts/tools/full-chain-film.mts", import.meta.url), "utf8"), /arg\("--subtitle-mode", "sidecar"\)/);
}));
test("G4 markdown carries full profile, all eight original receipts, unified delivery and system-only review", () => scoped({}, async f => {
  const { markdown } = await approved(f); assert.match(markdown, /三十岁上下/); assert.match(markdown, /wechat-channels/); assert.match(markdown, /sidecar/);
  for (const file of Object.values(f.files) as any[]) { assert.ok(markdown.includes(file.path)); assert.ok(markdown.includes(file.sha256)); }
  assert.doesNotMatch(markdown, /请回复：确认/); assert.match(markdown, /人工只验收最终成片/);
}));
test("native creative core, complete scenes, shot mapping and dialogue remain byte-equivalent", () => scoped({}, async f => {
  const { prd } = await generated(f); assert.deepEqual(prd.creativeCore, creative); assert.deepEqual(prd.scenePlan, production.scenePlan);
}));
test("approved PRD reaches the actual ScriptEngine parser and adapter with current portraits and exact requirements", () => scoped({}, async f => {
  const { requirements, prd } = await approved(f), input = metadata(f, requirements, prd);
  const result = await f.system.scriptEngine.process(f.fields._originalStoryText, input);
  assert.equal(result.adapted.config._metadata._prd, prd); assert.equal(result.blueprint.meta._metadata._prd, prd);
  assert.equal(result.adapted.characters[0].character_id, f.character.id); assert.equal(result.adapted.characters[0].name, f.character.name);
  assert.deepEqual(result.blueprint.character_system.characters[0].visual_anchor.reference_images, Object.values(f.files).map((file: any) => file.path));
  assert.equal(input.target_duration, 30); assert.equal(input.aspectRatio, "9:16"); assert.deepEqual(input.target_platform, ["wechat-channels"]);
}));
test("actual native PortraitStudio plans all existing accepted views without manufacturing new image tasks", () => scoped({}, async f => {
  const { requirements, prd } = await approved(f), result = await f.system.scriptEngine.process(f.fields._originalStoryText, metadata(f, requirements, prd));
  const plan = await withNativePortraitArchives(f.archives.portraits, async () => new PortraitStudio({}).plan({ characters: result.blueprint.character_system.characters, blueprint: result.adapted, prd }));
  assert.equal(plan.characterTasks.length, 1); assert.equal(plan.characterTasks[0].source, "controlled-existing-archive");
  assert.deepEqual(plan.characterTasks[0].portraits.map((p: any) => p.angle), angles);
}));
test("native output renaming the selected CEO fails rather than guessing a singleton identity", () => scoped({ actorName: "林总" }, async f => {
  await assert.rejects(() => generated(f), denied);
}));
for (const [label, mutation] of [
  ["selected profile", (f: any) => { f.archives.characters[0].identity.age = "中年"; }],
  ["explicit Brief", (f: any) => { f.brief.platform = "douyin"; }],
  ["original discovery", (f: any) => { f.discovery().sceneStructure.scenes[0].purpose = "另一故事"; }],
  ["original input", (f: any) => { f.fields.theme = "另一商品"; }],
  ["current portrait bytes", (f: any) => { writeFileSync(f.files.front.path, Buffer.alloc(2048, 99)); }],
] as const) test(`${label} changed while native PRD agent awaits invalidates its source`, () => scoped({ mutate: mutation }, async f => {
  await assert.rejects(() => generated(f), denied);
}));
test("missing or mutated controlled portrait receipts fail before native agent generation", () => scoped({}, async f => {
  delete f.archives.portraits[0].files.side; await assert.rejects(() => generated(f), denied); assert.equal(f.prompts.length, 0);
}));
test("unapproved PRD cannot enter actual native ScriptEngine", () => scoped({}, async f => {
  const { requirements, prd } = await generated(f); await assert.rejects(() => f.system.scriptEngine.process("客户需求", metadata(f, requirements, prd)), denied);
}));
test("minimal fallback and a clone of an approved PRD cannot impersonate the G4-owned instance", () => scoped({}, async f => {
  const { requirements, prd } = await approved(f);
  for (const replacement of [f.system._generateMinimalPRD(f.discovery()), structuredClone(prd)])
    await assert.rejects(() => f.system.scriptEngine.process("客户需求", metadata(f, requirements, replacement)), denied);
}));
test("G4 rejection leaves no approved PRD for downstream consumption", () => scoped({}, async f => {
  f.system._waitForExternalConfirmation = async () => ({ approved: false, reason: "fixture-rejected", suggestions: [] });
  const { requirements, prd } = await generated(f), md = f.system.prdGenerator.generateMarkdown(prd);
  assert.equal((await f.system._confirmPRD(md, prd)).approved, false);
  await assert.rejects(() => f.system.scriptEngine.process("客户需求", metadata(f, requirements, prd)), denied);
}));
test("an approved G4 with suggestions cannot silently regenerate a different unreviewed PRD", () => scoped({}, async f => {
  f.system._waitForExternalConfirmation = async () => ({ approved: true, suggestions: ["改为另一人物"] });
  const { prd } = await generated(f), md = f.system.prdGenerator.generateMarkdown(prd);
  await assert.rejects(() => f.system._confirmPRD(md, prd), denied);
}));
test("altered PRD or different Markdown cannot borrow the generated G4 source seal", () => scoped({}, async f => {
  const { prd } = await generated(f), md = f.system.prdGenerator.generateMarkdown(prd);
  await assert.rejects(() => f.system._confirmPRD(md + "另一份正文", prd), denied);
  prd.creativeCore.creativeHook = "另一创意";
  await assert.rejects(() => f.system._confirmPRD(md, prd), denied);
}));
test("source changes during actual G4 await cannot retain approval", () => scoped({}, async f => {
  f.system._waitForExternalConfirmation = async () => { f.brief.duration = 31; return { approved: true, suggestions: [] }; };
  const { prd } = await generated(f), md = f.system.prdGenerator.generateMarkdown(prd);
  await assert.rejects(() => f.system._confirmPRD(md, prd), denied);
}));
test("source changes during the actual ScriptEngine await invalidate its output", () => scoped({ afterScript: f => { f.archives.characters[0].name = "另一人"; } }, async f => {
  const { requirements, prd } = await approved(f);
  await assert.rejects(() => f.system.scriptEngine.process("客户需求", metadata(f, requirements, prd)), denied);
}));
test("duplicate selected identities are rejected without picking the first profile", () => scoped({}, async f => {
  f.archives.characters.push(structuredClone(f.archives.characters[0])); await assert.rejects(() => generated(f), denied);
}));
test("invalid native quality thresholds are rejected instead of replaced by looser defaults", () => scoped({}, async f => {
  const original = f.system.prdGenerator.agent4.process;
  f.system.prdGenerator.agent4.process = function(...args: any[]) { const value = original.apply(this, args); value.productionConstraints.qualityThresholds.visual = 1.4; return value; };
  await assert.rejects(() => generated(f), denied);
}));
test("two independent native instances keep their own contracts when one scope finishes", async () => {
  const first = fixture(), second = fixture(); try {
    const [a, b] = await Promise.all([approved(first), approved(second)]); first.dispose();
    assert.notEqual(a.prd, b.prd); assert.ok(await second.system.scriptEngine.process("客户需求", metadata(second, b.requirements, b.prd)));
    const captured = second.system.prdGenerator.generate; second.dispose(); await assert.rejects(() => captured.call(second.system.prdGenerator, b.discovery), denied);
  } finally { first.cleanup(); second.cleanup(); }
});
test("external instance bridge replacement is detected and original methods are restored", async () => {
  const f = fixture(); try { f.system.prdGenerator.generate = async () => ({}); assert.throws(() => f.dispose(), denied); }
  finally { f.cleanup(); }
});
test("a legacy narrative without selected archives preserves its native characters and scenes", () => scoped({ noArchives: true }, async f => {
  const { prd } = await generated(f); assert.deepEqual(prd.characterSystem, production.characterSystem); assert.deepEqual(prd.scenePlan, production.scenePlan);
}));
test("G4 image evidence is the complete original-byte receipt list, never a text-only assertion", () => scoped({}, async f => {
  const rows = bridge.nativePrdPortraitEvidence(f.archives); assert.equal(rows.length, 8);
  for (const row of rows) { assert.equal(row.kind, "character"); assert.equal(row.id, f.character.id);
    assert.deepEqual(row.receipt, f.files[row.angle]); }
}));
test("native vendor generator, agents and script source bytes remain unchanged by scoped adapters", () => scoped({}, async f => {
  const paths = ["../vendor/supermickey/hyperreality-system/engines/prd-generator/prd-generator.js", "../vendor/supermickey/hyperreality-system/index.js",
    "../vendor/supermickey/hyperreality-system/engines/script-engine/core/script-generator.js"];
  const before = paths.map(path => sha(readFileSync(new URL(path, import.meta.url)))); await approved(f);
  assert.deepEqual(paths.map(path => sha(readFileSync(new URL(path, import.meta.url)))), before);
}));
