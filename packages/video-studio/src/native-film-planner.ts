/** Compile the native preproduction handoff; the caller never supplies these creative/physical contracts. */
import { environmentDefects, expandShotWithBible, validateSceneBible, type SceneBible } from "./scene-bible.js";
import { openingHookChecks, type HookCard } from "./opening-hook.js";
import type { NativeProductionShot } from "./native-film-source.js";
import type { LLMReasonOptions, LLMReasonResult } from "./llm-adapter.js";
import type { ScenePolicy } from "./scene-policy.js";

type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => Boolean(value && typeof value === "object" && !Array.isArray(value));
const metadataKeys = new Set(["sceneId", "propInteraction", "environmentProfile", "visibleMaterials", "policyTags", "speechMode", "speechScene"]);
function fail(message: string): never { throw new Error(`NATIVE_FILM_PLAN_UNVERIFIED: ${message}`); }
export interface NativeFilmHandoff { shots: NativeProductionShot[]; context: { hook: HookCard; sceneBible: SceneBible }; report: Json }
export function validateNativeFilmHandoff(value: unknown, source: NativeProductionShot[], platform: string): NativeFilmHandoff {
  if (!object(value) || Object.keys(value).some(key => !["hook", "sceneBible", "shotMetadata"].includes(key))
    || !object(value.hook) || !object(value.sceneBible) || !Array.isArray(value.shotMetadata)) fail("缺少钩子、场景档案或逐镜交接字段，或包含改写原稿的字段");
  const issues = validateSceneBible(value.sceneBible);
  if (issues.length) fail(issues.join("；"));
  const byId = new Map<string, Json>();
  for (const row of value.shotMetadata) {
    if (!object(row) || typeof row.shotId !== "string" || byId.has(row.shotId)
      || Object.keys(row).some(key => key !== "shotId" && !metadataKeys.has(key))) fail("逐镜交接身份重复或尝试注入剧本/提示词");
    byId.set(row.shotId, row);
  }
  if (byId.size !== source.length || source.some(shot => !byId.has(shot.shotId))) fail("交接字段没有覆盖本次完整原生分镜");
  const shots = source.map(shot => {
    const { shotId: _id, ...metadata } = byId.get(shot.shotId)!;
    for (const [key, proposed] of Object.entries(metadata)) if (shot[key] !== undefined && JSON.stringify(shot[key]) !== JSON.stringify(proposed)) fail(`${shot.shotId}不得改写原生${key}`);
    return { ...structuredClone(shot), ...metadata } as NativeProductionShot;
  });
  const sceneBible = value.sceneBible as unknown as SceneBible, hook = value.hook as unknown as HookCard;
  let expanded: NativeProductionShot[];
  try { expanded = shots.map(shot => expandShotWithBible(shot, sceneBible)); }
  catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  const environment = environmentDefects(expanded, sceneBible), hooks = openingHookChecks({ shots: expanded, hook, platform });
  const failures = [...environment.filter(item => item.hard).map(item => `${item.shotId}:${item.detail}`), ...hooks.filter(item => item.hard && !item.pass).map(item => item.detail)];
  if (failures.length) fail(failures.join("；"));
  return { shots, context: { hook, sceneBible }, report: { environment, hooks, sourceShotIds: source.map(shot => shot.shotId), platform } };
}

export async function planNativeFilmHandoff(input: {
  intent: string; platform: string; shots: NativeProductionShot[]; nativeStages: Json;
  scenePolicy?: ScenePolicy | null;
  llm: { reason(prompt: string, options?: LLMReasonOptions): Promise<LLMReasonResult> };
}): Promise<NativeFilmHandoff> {
  const contract = [
    "你是正式视频管线的钩子设计师与场景交接编译器。完整原生剧本、分镜、提示词已完成；不得另写剧本、增删镜头、改时长、改台词或改提示词。只从本次完整原生计划派生后期所需的合同。",
    '只输出严格JSON {"hook":{"type":"question|conflict|counterintuitive|benefit|result-first|suspense|number|scene-shock","promise":"原片兑现的承诺","payoffShotId":"原镜号","firstShotTemplate":{"visual":"原首镜画面","line":"原首句或对应字幕，最多18字"},"sfx":{"kind":"impact|whoosh|riser","atSec":0.08,"gainDb":-11}},"sceneBible":{"spaceId":"主空间ID","space":{"building":"原片具体空间","timeOfDay":"原时段"},"materials":[{"item":"可见物件","material":"具体材质","finish":"工艺"}],"practicalLights":[{"type":"原场景适用光源","direction":"方向"}],"traces":[],"environmentProfile":{"setting":"interior|exterior|studio|product","condition":"used|new|maintained|sterile|natural"},"otherSpaces":[]},"shotMetadata":[{"shotId":"原镜号","sceneId":"对应空间ID","propInteraction":[{"prop":"原道具","purpose":"operate|present|shared-view|rest","orientation":"朝向及承重","operatedBy":"原人物","screenFacing":"operator|audience|shared|away","contact":"接触关系"}]}]}。',
    "shotMetadata必须逐镜覆盖，只有shotId/sceneId/propInteraction/environmentProfile/visibleMaterials/policyTags/speechMode/speechScene可出现。原镜已有字段必须保持相同。无道具操作的镜头不编操作，有操作则按原动作声明用途、屏幕朝向与接触。",
    "已选scenePolicy时，policyTags只标记原分镜实际composition/camera_movement所含主景别及移动，不能用标签伪造拍摄内容；有台词镜按原稿明确speechMode为on-camera或voice-over、speechScene为知识条目登记语境。缺原稿证据不能编证据。",
    "每个不同原sceneId登记一个独立空间；otherSpaces条目为{spaceId,building,timeOfDay,materials,practicalLights,traces,environmentProfile}，不能给不同空间复用酒店家具。",
    "实景用日光/窗光/筒灯/台灯等原场景光源，摄影棚与产品镜才用柔光箱。室内至少两种可见材质，产品镜至少一种；used必须声明原场景实际痕迹，new/maintained不编磨损。",
    "钩子须来自原首镜及有实际内容的兑现镜，营销卖点只能引用原生事实包已经审核的主张，不补数字、效率或价格。"
  ].join("\n");
  const prompt = `${contract}\n${JSON.stringify({ intent: input.intent, platform: input.platform, scenePolicy: input.scenePolicy ?? null, shots: input.shots, nativeStages: input.nativeStages })}`;
  if (prompt.length > 180_000) fail("完整原生计划超单次交接预算，不能静默裁剪");
  const result = await input.llm.reason(prompt, { forceJson: true, temperature: 0, maxTokens: 8192 });
  if (!result.success) fail(`交接编译失败：${result.error ?? "空响应"}`);
  let value: unknown;
  try { value = result.data ?? JSON.parse(result.content ?? ""); } catch { fail("交接编译结果不是合法JSON"); }
  return validateNativeFilmHandoff(value, input.shots, input.platform);
}
