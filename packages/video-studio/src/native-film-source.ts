/** The only film handoff is compiled inside preproduction from its complete native outputs. */
import { createHash } from "node:crypto";
import { normalizeFilmJobRequest } from "./film-worker-runtime.js";
import { filmCanonicalJson } from "./film-worker-channel.js";

type Json = Record<string, unknown>;
export interface NativeFilmBinding {
  tenantId: string; workspaceId: string; projectId: string; runId: string; attempt: number; pipelineKind: "narrative" | "marketing";
}
export interface NativeProductionShot extends Json { shotId: string; duration: number; prompt: string; fields: Json }
export interface NativeFilmSource extends Json {
  schemaVersion: "workloom.native-film-source/v1";
  productionSource: NativeFilmBinding & { issuer: "workloom.studio-worker"; nativeShotsSha256: string };
  shots: NativeProductionShot[];
}
const object = (value: unknown): value is Json => Boolean(value && typeof value === "object" && !Array.isArray(value));
const digest = (value: unknown): string => createHash("sha256").update(filmCanonicalJson(value)).digest("hex");
function fail(message: string): never { throw new Error(`NATIVE_FILM_SOURCE_INVALID: ${message}`); }
function rows(value: unknown, name: string): Json[] {
  if (!Array.isArray(value) || !value.length || value.some(item => !object(item))) fail(`${name}缺少完整原生镜头`);
  return value as Json[];
}
const idOf = (shot: Json): string => String(shot.shotId ?? shot.shot_id ?? "");
const durationOf = (shot: Json): number => Number(shot.duration ?? shot.durationSec ?? (object(shot.timing) ? shot.timing.duration : NaN));
function check(shot: NativeProductionShot): void {
  if (!shot.shotId || !Number.isSafeInteger(shot.duration) || shot.duration <= 0 || shot.duration > 30
    || typeof shot.prompt !== "string" || !shot.prompt.trim() || !object(shot.fields) || !Object.keys(shot.fields).length
    || shot.degraded === true || shot.status === "failed") fail(`镜头${shot.shotId}的身份、时长、完整提示词或字段不可核实`);
}

/** Vendor's final export is a summary. Restore only its own full prompt records, never reconstruct a prompt. */
export function nativeProductionShots(stages: Json): NativeProductionShot[] {
  if (!object(stages.productionEngine)) fail("缺少原生制作引擎产物");
  const engine = stages.productionEngine;
  const summaries = rows(engine.shots, "分镜表");
  const prompts = rows(engine.prompts ?? engine.shots, "提示词包");
  const byId = new Map<string, Json>();
  for (const prompt of prompts) {
    const id = idOf(prompt);
    if (!id || byId.has(id)) fail("原生提示词包有空号或重复镜号");
    byId.set(id, prompt);
  }
  if (byId.size !== summaries.length || new Set(summaries.map(idOf)).size !== summaries.length) fail("分镜与完整提示词数量不一致");
  return summaries.map(summary => {
    const id = idOf(summary), full = byId.get(id);
    if (!full) fail(`镜头${id}缺少本次完整提示词`);
    const duration = durationOf(summary);
    if (durationOf(full) !== duration) fail(`镜头${id}的原生时长相互矛盾`);
    const fields = object(full.fields) ? full.fields : Object.fromEntries(Object.entries({ ...summary, ...full })
      .filter(([key]) => !["shotId", "shot_id", "duration", "durationSec", "prompt", "promptLength", "promptCharCount", "status", "degraded"].includes(key)));
    const shot = { ...summary, ...full, ...fields, shotId: id, duration, prompt: full.prompt, fields: structuredClone(fields),
      ...(summary.degraded === true ? { degraded: true } : {}) } as NativeProductionShot;
    check(shot);
    return shot;
  });
}
function shotContract(shots: NativeProductionShot[]): unknown {
  return shots.map(shot => ({ shotId: shot.shotId, duration: shot.duration, prompt: shot.prompt, fields: shot.fields }));
}

export function buildNativeFilmSource(input: {
  binding: NativeFilmBinding; title: string; shots: NativeProductionShot[]; context?: Json; generatedAt?: string;
}): NativeFilmSource {
  if (!input.shots.length || new Set(input.shots.map(shot => shot.shotId)).size !== input.shots.length) fail("完整分镜为空或重复");
  input.shots.forEach(check);
  const context = input.context ?? {};
  for (const key of ["schemaVersion", "productionSource", "shots", "projectId", "durationSeconds"]) if (Object.hasOwn(context, key)) fail(`交接上下文不得改写${key}`);
  const source: NativeFilmSource = {
    ...structuredClone(context), schemaVersion: "workloom.native-film-source/v1", projectId: input.binding.projectId,
    title: input.title, durationSeconds: input.shots.reduce((sum, shot) => sum + shot.duration, 0),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    productionSource: { ...input.binding, issuer: "workloom.studio-worker", nativeShotsSha256: digest(shotContract(input.shots)) },
    shots: structuredClone(input.shots).map(shot => ({ ...shot.fields, ...shot })),
  };
  assertNativeFilmSource(source, input.binding, input.shots);
  return source;
}
export function assertNativeFilmSource(value: unknown, binding: NativeFilmBinding, shots: NativeProductionShot[]): asserts value is NativeFilmSource {
  if (!object(value) || value.schemaVersion !== "workloom.native-film-source/v1" || !object(value.productionSource)) fail("缺少宿主原生交接身份");
  const proof = value.productionSource;
  if (proof.issuer !== "workloom.studio-worker" || Object.entries(binding).some(([key, expected]) => proof[key] !== expected)
    || value.projectId !== binding.projectId || proof.nativeShotsSha256 !== digest(shotContract(shots))) fail("交接稿与当前作用域/执行/完整原生镜头不同源");
  const actual = rows(value.shots, "交接分镜") as NativeProductionShot[];
  actual.forEach(check);
  if (filmCanonicalJson(shotContract(actual)) !== filmCanonicalJson(shotContract(shots))
    || value.durationSeconds !== actual.reduce((sum, shot) => sum + shot.duration, 0)) fail("交接稿改写了原生镜头、顺序、提示词、结构字段或时长");
}

export const NATIVE_FILM_STAGES = Object.freeze(["cine-kb", "continuity", "micromotion", "spec", "plates", "material-gen", "videos", "voice", "compose", "color", "subtitle", "danmaku", "bgm", "cover", "mux", "master", "deliver"]);
/** Public production cannot select an easier subset, increase retries, or turn a partial assembly into a delivery. */
export function normalizeNativeFilmJobRequest(stages: readonly string[] | undefined, options: Json): ReturnType<typeof normalizeFilmJobRequest> {
  if (stages !== undefined && NATIVE_FILM_STAGES.some(stage => !stages.includes(stage))) throw new Error("PIPELINE_INCOMPLETE: 正式制作不能省略前置渲染或后期步骤");
  const normalized = normalizeFilmJobRequest(stages === undefined ? [...NATIVE_FILM_STAGES] : [...stages], options);
  if (NATIVE_FILM_STAGES.some(stage => !normalized.stages.includes(stage))) throw new Error("PIPELINE_INCOMPLETE: 正式制作必须执行原生渲染和完整后期");
  if (normalized.stages.some(stage => !NATIVE_FILM_STAGES.includes(stage))) throw new Error("PIPELINE_INCOMPLETE: 返修须使用独立的历史回执流程");
  for (const key of ["only", "assembly-mode", "material-post-only", "no-resume", "no-danmaku", "no-cover-kb"]) {
    if (normalized.options[key] !== undefined && normalized.options[key] !== false) throw new Error(`PIPELINE_BYPASS_FORBIDDEN: ${key}不属于正式完整制作`);
  }
  if (normalized.options["max-attempts"] !== undefined && normalized.options["max-attempts"] !== "1") throw new Error("RENDER_RETRY_FORBIDDEN: 单次制作不得自动重复提交渲染");
  normalized.options["max-attempts"] = "1";
  return { stages: [...NATIVE_FILM_STAGES], options: normalized.options };
}
