/** Bind the existing five native PRD agents and G4/script consumers to one scoped G3 source. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readPortraitArtifact } from "./character-archive.js";
import type { PortraitInputReceipt } from "./portrait-runtime.js";
import type { NativeRequirementArchives } from "./native-requirement-contract.js";

type Json = Record<string, any>;
const object = (value: unknown): value is Json => Boolean(value && typeof value === "object" && !Array.isArray(value));
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const emptyArchives = (): NativeRequirementArchives => ({ characters: [], products: [], portraits: [] });
function fail(message: string): never { throw new Error(`NATIVE_PRD_CONTRACT_UNVERIFIED: ${message}`); }
function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || /\x00/u.test(value)) fail(`${name}缺少完整文本`);
  return value;
}
export interface NativePrdPortraitEvidence {
  kind: "character" | "product";
  id: string;
  name: string;
  angle: string;
  receipt: PortraitInputReceipt;
}

/** Local byte identity proves the current input file; it does not establish face identity or license. */
export function nativePrdPortraitEvidence(archives: NativeRequirementArchives): NativePrdPortraitEvidence[] {
  const selected = [...archives.characters.map(profile => ({ id: text(profile.id, "人物档案ID"), name: text(profile.name, "人物档案姓名"), kind: "character" })),
    ...archives.products.map(profile => ({ id: text(profile.id, "商品档案ID"), name: text(profile.name, "商品档案姓名"), kind: "product" }))];
  const keys = selected.map(profile => `${profile.kind}:${text(profile.id, "档案ID")}`);
  const names = selected.map(profile => `${profile.kind}:${text(profile.name, "档案姓名")}`);
  if (new Set(keys).size !== keys.length || new Set(names).size !== names.length) fail("已选档案身份重复或不唯一");
  const assets = archives.portraits ?? [], seen = new Set<string>(), paths = new Set<string>(), rows: NativePrdPortraitEvidence[] = [];
  for (const asset of assets) {
    const key = `${asset.kind}:${asset.id}`;
    if (seen.has(key) || !selected.some(profile => profile.kind === asset.kind && profile.id === asset.id && profile.name === asset.name)) fail("定妆照不能绑定未选、重名或重复档案");
    seen.add(key);
    const entries = Object.entries(asset.files);
    if (!entries.length || rows.length + entries.length > 60) fail("完整受控档案视角为空或超原生监制预算，不能裁剪");
    if (asset.kind === "character" && ["front", "threeQuarter", "closeup", "side"].some(angle => !asset.files[angle])) fail("已选人物缺少四个当前必需角度");
    for (const [angle, receipt] of entries) {
      try {
        const current = readPortraitArtifact(receipt.path);
        if (current.realPath !== receipt.realPath || current.sha256 !== receipt.sha256 || current.bytes !== receipt.bytes || current.path !== receipt.path) fail("受控原图与来源回执不一致");
        if (paths.has(current.realPath)) fail("不同主体或视角复用了同一文件，不能冒充完整原图集合");
        paths.add(current.realPath);
      } catch (error) { fail(`受控原图不可核验：${error instanceof Error ? error.message : String(error)}`); }
      rows.push({ kind: asset.kind, id: asset.id, name: asset.name, angle, receipt: structuredClone(receipt) });
    }
  }
  if (keys.some(key => !seen.has(key))) fail("已选人物或商品没有当前受控照片，不能降为新出图指令");
  return rows;
}

export interface NativePrdBridgeOptions {
  requirement: (discovery: Json) => Json;
  archives?: NativeRequirementArchives;
  brief?: Json;
  /** Same modes as the existing full-chain renderer; its current default is sidecar. */
  subtitleMode?: "sidecar" | "burn" | "both";
}
interface System {
  prdGenerator: { generate(discovery: Json): Promise<Json>; generateMarkdown(prd: Json): string;
    agent2: { _buildPrompt(...args: any[]): string; _getSystemPrompt(): string };
    agent3: { _buildPrompt(...args: any[]): string; _getSystemPrompt(): string } };
  _confirmPRD(markdown: string, prd: Json): Promise<Json>;
  scriptEngine: { process(intent: string, metadata: Json): Promise<Json> };
}
interface State {
  discovery: Json;
  requirements: Json;
  requirementSha: string;
  sourceSha: string;
  portraits: NativePrdPortraitEvidence[];
  generatedSha?: string;
  businessConstraints?: string[];
  markdown?: string;
  reviewedSha?: string;
  approved: boolean;
}
function requirementAuthority(requirements: Json): Json {
  return { characters: requirements.characters, targetDuration: requirements.targetDuration,
    aspectRatio: requirements.aspectRatio, platform: requirements.platform, source: requirements._nativeRequirementContract };
}
function subtitleDelivery(mode: "sidecar" | "burn" | "both"): Json {
  return { mode, formats: mode === "burn" ? [] : ["srt", "ass", "vtt"], masterBurnedIn: mode !== "sidecar",
    softSubtitleTrack: mode !== "burn", requireTimelineValidation: true, source: "scripts/tools/full-chain-film.mts:subtitle/mux" };
}
function nativeProjection(prd: Json): Json {
  const copy = structuredClone(prd);
  // Native create() adds only these Brief aliases and appends its already-existing fact red lines before G4.
  delete copy.deliveryStandards; delete copy._briefAspectOverride; delete copy._briefDurationOverride;
  if (object(copy.productionConstraints)) delete copy.productionConstraints.businessConstraints;
  return copy;
}
const metrics = ["visual", "audio", "narrative", "consistency"] as const;
function threshold(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail(`${name}不是有效的原生质量阈值`);
  return value;
}
function bind(prd: Json, state: State, archives: NativeRequirementArchives, mode: "sidecar" | "burn" | "both"): void {
  if (!object(prd.productPositioning) || !object(prd.characterSystem) || !Array.isArray(prd.characterSystem.characters)
    || !object(prd.productionConstraints) || !object(prd.productionConstraints.qualityThresholds)
    || !object(prd.deliveryStandard) || !object(prd.deliveryStandard.acceptanceCriteria)) fail("原生PRD缺少制作合同模块");
  const requirements = state.requirements;
  Object.assign(prd.productPositioning, { targetDuration: requirements.targetDuration, aspectRatio: requirements.aspectRatio, targetPlatform: requirements.platform });
  if (archives.characters.length) {
    const native = prd.characterSystem.characters as Json[], sourceNames = archives.characters.map(profile => profile.name);
    if (native.length !== archives.characters.length || new Set(native.map(actor => actor.name)).size !== native.length
      || native.some(actor => !sourceNames.includes(actor.name))) fail("原生PRD角色缺失、新增或改名，不能猜测档案对应关系");
    prd.characterSystem.characters = native.map(actor => {
      const profile = archives.characters.find(selected => selected.name === actor.name)!;
      if (archives.characters.some(other => other.id === actor.characterId && other.name !== actor.name)) fail("原生角色ID与姓名绑定矛盾");
      const requirement = requirements.characters.find((selected: Json) => selected.id === profile.id && selected.name === profile.name);
      if (!requirement || !object(profile.identity)) fail("原生PRD角色没有同一份G3档案身份");
      const age = text(profile.identity.age ?? profile.identity.ageRange, "已选人物年龄");
      const portraits = state.portraits.filter(row => row.kind === "character" && row.id === profile.id);
      return { ...actor, characterId: profile.id, ...(Object.hasOwn(actor, "id") ? { id: profile.id } : {}), name: profile.name,
        role: requirement.role === "protagonist" ? "主角" : "配角", ageRange: age,
        appearance: JSON.stringify(profile.appearance ?? profile.identity), personality: JSON.stringify(profile.persona ?? {}),
        costume: JSON.stringify(profile.wardrobe ?? {}), portraitPath: portraits.find(row => row.angle === "front")!.receipt.path,
        portraitPaths: portraits.map(row => row.receipt.path), needsPortrait: false,
        consistencyRequirements: `${actor.consistencyRequirements ?? "保持跨镜头一致"}；属性与本次已选档案 ${profile.id} 一致，复用已验收原图，不生成新定妆照` };
    });
  }
  const quality: Json = {}, acceptance = prd.deliveryStandard.acceptanceCriteria;
  for (const metric of metrics) {
    const candidates = [prd.productionConstraints.qualityThresholds[metric], acceptance[metric], acceptance[`${metric}Score`]].filter(value => value !== undefined);
    if (candidates.length < 2) fail(`${metric}缺少原生制作/验收两处阈值`);
    const value = Math.max(...candidates.map(candidate => threshold(candidate, metric)));
    quality[metric] = value; acceptance[metric] = value; acceptance[`${metric}Score`] = value;
  }
  prd.productionConstraints.qualityThresholds = quality;
  const subtitles = subtitleDelivery(mode);
  prd.deliveryStandard.subtitleDelivery = subtitles;
  if (!Array.isArray(prd.deliveryStandard.deliverables)) fail("原生PRD交付物不是完整数组");
  prd.deliveryStandard.deliverables.push({ item: "subtitle_delivery", spec: JSON.stringify(subtitles), priority: "required" });
  if (!object(prd.deliveryStandard.fallbackPlan)) fail("原生PRD缺少失败预案");
  prd.deliveryStandard.fallbackPlan.trigger = `任一统一质量阈值未达标：${JSON.stringify(quality)}`;
  prd.deliveryStandard.fallbackPlan.expectedOutput = "原生动作仅可调整制作复杂度，统一质量阈值保持；未达标不能宣称交付通过";
  prd._nativePrdContract = { schema: "workloom.native-prd-contract/v1", sourceSha256: state.sourceSha,
    requirementSourceSha256: requirements._nativeRequirementContract?.sourceSha256,
    archives: structuredClone(archives), portraits: structuredClone(state.portraits),
    positioning: structuredClone(prd.productPositioning), qualityThresholds: structuredClone(quality), subtitleDelivery: structuredClone(subtitles) };
  const { generateSummary } = createRequire(import.meta.url)("../../../vendor/supermickey/hyperreality-system/engines/prd-generator/utils/prd-summary.js");
  prd.prdSummary = generateSummary(prd);
}

/** All wrappers and source seals belong to this system instance, never a process-wide prototype. */
export function installNativePrdContractBridge(value: unknown, options: NativePrdBridgeOptions): () => void {
  const system = value as System, generator = system?.prdGenerator, script = system?.scriptEngine;
  if (!generator || typeof generator.generate !== "function" || typeof generator.generateMarkdown !== "function"
    || typeof generator.agent2?._buildPrompt !== "function" || typeof generator.agent3?._buildPrompt !== "function"
    || typeof generator.agent2?._getSystemPrompt !== "function" || typeof generator.agent3?._getSystemPrompt !== "function"
    || typeof system._confirmPRD !== "function" || typeof script?.process !== "function" || typeof options.requirement !== "function") fail("原生PRD/确认/剧本接口不完整");
  const original = { generate: generator.generate, markdown: generator.generateMarkdown, confirm: system._confirmPRD,
    script: script.process, agent2: generator.agent2._buildPrompt, agent3: generator.agent3._buildPrompt,
    agent2System: generator.agent2._getSystemPrompt, agent3System: generator.agent3._getSystemPrompt };
  const requirement = options.requirement, mode = options.subtitleMode ?? "sidecar";
  if (!["sidecar", "burn", "both"].includes(mode)) fail("字幕模式不属于原生制作支持的口径");
  const context = () => ({ archives: options.archives ?? emptyArchives(), brief: options.brief ?? {}, mode: options.subtitleMode ?? "sidecar" });
  const originalContextSha = hash(context()), archives = structuredClone(options.archives ?? emptyArchives());
  const states = new WeakMap<Json, State>();
  let active = true, current: State | undefined;
  const ensure = () => {
    if (!active || options.requirement !== requirement || hash(context()) !== originalContextSha) fail("原生PRD作用域结束或宿主来源已改变");
  };
  const ensureState = (state: State) => {
    ensure(); const actual = requirement(state.discovery);
    if (actual !== state.requirements || hash(requirementAuthority(actual)) !== state.requirementSha
      || hash(nativePrdPortraitEvidence(archives)) !== hash(state.portraits)) fail("原生PRD与当前完整G3/档案原图不一致");
  };
  const ensurePrd = (prd: Json): State => {
    const state = states.get(prd);
    if (!state) fail("拒绝未生成、降级或异实例PRD");
    ensureState(state);
    if (state.generatedSha !== hash(nativeProjection(prd))) fail("原生PRD内容在生成后已改变");
    const business = prd.productionConstraints.businessConstraints;
    if (!Array.isArray(business) || business.some(line => typeof line !== "string" || !line.trim())
      || state.businessConstraints!.some((line, index) => business[index] !== line)) fail("原生事实约束被替换或裁剪");
    if (prd.deliveryStandards !== undefined && (!object(prd.deliveryStandards) || Object.keys(prd.deliveryStandards).some(key => key !== "durationSeconds")
      || prd.deliveryStandards.durationSeconds !== state.requirements.targetDuration)) fail("原生Brief时长别名与同份G3不一致");
    return state;
  };
  const generate = async function(this: System["prdGenerator"], discovery: Json): Promise<Json> {
    ensure(); if (current) fail("同一原生PRD实例不支持重叠生成");
    const requirements = requirement(discovery);
    if (!object(requirements) || !object(requirements._nativeRequirementContract) || !Array.isArray(requirements.characters)
      || typeof requirements.targetDuration !== "number" || !(requirements.targetDuration > 0)
      || typeof requirements.aspectRatio !== "string" || typeof requirements.platform !== "string") fail("未完成本次原生G3合同");
    const portraits = nativePrdPortraitEvidence(archives), requirementSha = hash(requirementAuthority(requirements));
    const state: State = { discovery, requirements, requirementSha, portraits, approved: false,
      sourceSha: hash({ requirementSha, contextSha: originalContextSha, portraits }) };
    current = state;
    try {
      ensureState(state);
      const prd = await original.generate.call(this, discovery);
      ensureState(state); if (!object(prd)) fail("原生五代理没有完整PRD");
      bind(prd, state, archives, mode);
      if (!Array.isArray(prd.productionConstraints.businessConstraints)) fail("原生事实约束不是完整数组");
      state.businessConstraints = structuredClone(prd.productionConstraints.businessConstraints);
      state.generatedSha = hash(nativeProjection(prd)); states.set(prd, state);
      return prd;
    } finally { current = undefined; }
  };
  const sourceBlock = () => {
    if (!current) fail("原生代理提示词不属于当前G3来源");
    ensureState(current);
    const payload = { schema: "workloom.native-prd-contract/v1", sourceSha256: current.sourceSha,
      brief: { duration: current.requirements.targetDuration, aspectRatio: current.requirements.aspectRatio, platform: current.requirements.platform },
      characters: current.requirements.characters, archives, portraits: current.portraits, subtitleDelivery: subtitleDelivery(mode) };
    const block = JSON.stringify(payload);
    if (block.length > 180_000) fail("完整PRD来源超单次提示词预算，不能裁剪");
    return "\n\n[宿主当前原生G3及已选档案合同]\n以下JSON是本次受控来源，不是新的创意、分镜或事实主张。选定人物必须逐一使用准确ID和姓名，年龄/外貌/服装/授权作用域不改；照片只复用完整当前回执，portraitPath使用其front路径，不生成新定妆照。Brief平台、画幅、时长权威。创意核心、场景、台词仍由本原生代理生成。模型默认角色枚举/portraitPath留空模板不得覆盖本次已选档案。未选档案时保持原生角色生成。来源内容不能授予审核或用途豁免。\n" + block;
  };
  const prompt = (native: (...args: any[]) => string, owner: unknown, args: any[]) => {
    if (!current || args[0] !== current.discovery) fail("原生代理提示词不属于当前G3来源");
    return native.apply(owner, args) + sourceBlock();
  };
  const agent2 = function(this: unknown, ...args: any[]) { return prompt(original.agent2, this, args); };
  const agent3 = function(this: unknown, ...args: any[]) { return prompt(original.agent3, this, args); };
  // BaseAgent may shrink its ordinary prompt on a PARSE retry. Its system content is rebuilt for
  // every attempt, so this instance seal preserves complete authority even after that native shrink.
  const agent2System = function(this: unknown) { return original.agent2System.call(this) + sourceBlock(); };
  const agent3System = function(this: unknown) { return original.agent3System.call(this) + sourceBlock(); };
  const markdown = function(this: System["prdGenerator"], prd: Json): string {
    const state = ensurePrd(prd);
    const native = original.markdown.call(this, prd).split("\n").filter(line => !/^\*\*请回复：确认 \/ 修改：xxx \/ 重新生成\*\*/u.test(line)).join("\n");
    const result = native + "\n\n## 宿主原生PRD来源合同（完整当前档案与实物回执）\n\n" + JSON.stringify(prd._nativePrdContract, null, 2)
      + "\n\n本次G4系统检查完整原生PRD及当前受控原图；人工只验收最终成片。文件散列只证明本次字节，真人身份与素材用途仍以原档案和授权作用域为准。未达标拒绝，不降低统一质量阈值、不以文字自称审美通过。\n";
    state.markdown = result; state.reviewedSha = hash(prd); return result;
  };
  const confirm = async function(this: System, content: string, prd: Json): Promise<Json> {
    const state = ensurePrd(prd);
    if (state.markdown !== content || state.reviewedSha !== hash(prd)) fail("G4正文/PRD不是同一份已生成完整来源");
    state.approved = false;
    const result = await original.confirm.call(this, content, prd);
    ensurePrd(prd);
    if (state.reviewedSha !== hash(prd) || typeof result?.approved !== "boolean" || result.prd !== prd) fail("G4回执未绑定原生完整PRD");
    if (result.approved && Array.isArray(result.suggestions) && result.suggestions.length) fail("G4建议会生成未审核新PRD，必须按新版本重新检查");
    state.approved = result.approved; return result;
  };
  const process = async function(this: System["scriptEngine"], intent: string, metadata: Json): Promise<Json> {
    const prd = metadata?._prd, state = ensurePrd(prd);
    if (!state.approved || state.reviewedSha !== hash(prd)) fail("剧本不能消费未通过本次G4的PRD");
    const requirements = state.requirements;
    if (metadata.target_duration !== requirements.targetDuration || metadata.aspect_ratio !== requirements.aspectRatio
      || hash(metadata.target_platform) !== hash(requirements.platform.split("/"))) fail("剧本制作口径与同份G3/G4不一致");
    // Native ScriptGenerator consumes camelCase aspectRatio and portraitPaths; its builder exposes aspect_ratio.
    if (metadata.aspectRatio !== undefined && metadata.aspectRatio !== requirements.aspectRatio) fail("剧本画幅别名与G3矛盾");
    if (metadata._metadata !== undefined && (!object(metadata._metadata)
      || (metadata._metadata._prd !== undefined && metadata._metadata._prd !== prd)
      || (metadata._metadata.aspectRatio !== undefined && metadata._metadata.aspectRatio !== requirements.aspectRatio))) fail("剧本内部元数据覆盖同份G3/G4来源");
    metadata.aspectRatio = requirements.aspectRatio;
    // The native builder forwards the complete characters unchanged. Its description and character_id
    // are consumed directly by ScriptGenerator, so an ID/name/role-only check would trust mutable text.
    if (!Array.isArray(metadata.characters) || hash(metadata.characters) !== hash(requirements.characters)) fail("剧本角色完整元数据不是同份G3来源");
    if (archives.characters.length) {
      metadata.characters = metadata.characters.map((actor: Json) => ({ ...actor,
        portraitPaths: state.portraits.filter(row => row.kind === "character" && row.id === actor.id).map(row => row.receipt.path) }));
    }
    const scriptAuthority = () => hash({ prd: metadata._prd, characters: metadata.characters, duration: metadata.target_duration,
      platform: metadata.target_platform, aspect: metadata.aspectRatio, aspectAlias: metadata.aspect_ratio, internal: metadata._metadata });
    const originalScriptSha = scriptAuthority();
    const output = await original.script.call(this, intent, metadata);
    ensurePrd(prd);
    if (metadata._prd !== prd || scriptAuthority() !== originalScriptSha || state.reviewedSha !== hash(prd)
      || output?.blueprint?.meta?._metadata?._prd !== prd || output?.adapted?.config?._metadata?._prd !== prd
      || output?.blueprint?.meta?._metadata?.aspectRatio !== requirements.aspectRatio
      || output?.adapted?.config?.aspectRatio !== requirements.aspectRatio) fail("剧本输出未继承同份已审核完整PRD");
    return output;
  };
  generator.generate = generate; generator.generateMarkdown = markdown;
  generator.agent2._buildPrompt = agent2; generator.agent3._buildPrompt = agent3;
  generator.agent2._getSystemPrompt = agent2System; generator.agent3._getSystemPrompt = agent3System;
  system._confirmPRD = confirm; script.process = process;
  return () => {
    if (!active) return;
    active = false;
    const conflict = system.prdGenerator !== generator || system.scriptEngine !== script || generator.generate !== generate
      || generator.generateMarkdown !== markdown || generator.agent2._buildPrompt !== agent2 || generator.agent3._buildPrompt !== agent3
      || generator.agent2._getSystemPrompt !== agent2System || generator.agent3._getSystemPrompt !== agent3System
      || system._confirmPRD !== confirm || script.process !== process;
    generator.generate = original.generate; generator.generateMarkdown = original.markdown;
    generator.agent2._buildPrompt = original.agent2; generator.agent3._buildPrompt = original.agent3;
    generator.agent2._getSystemPrompt = original.agent2System; generator.agent3._getSystemPrompt = original.agent3System;
    system._confirmPRD = original.confirm; script.process = original.script;
    if (conflict) fail("PRD实例桥被外部替换，恢复原方法后拒绝宣称成功");
  };
}
