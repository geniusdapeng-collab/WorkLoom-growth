import { describe, expect, it } from "vitest";
import { nativeProductionShots, buildNativeFilmSource, assertNativeFilmSource, normalizeNativeFilmJobRequest, NATIVE_FILM_STAGES } from "./native-film-source.js";

const shot = { shotId: "S1", duration: 6, sceneType: "opening", prompt: "原生融合后的完整提示词", fields: { scene: "酒店大堂", action: "面对镜头介绍", dialogue: [{ speaker: "CEO", text: "入住更方便。" }] } };
const binding = { tenantId: "t", workspaceId: "w", projectId: "P1", runId: "R1", attempt: 1, pipelineKind: "marketing" as const };
const build = () => buildNativeFilmSource({ binding, title: "自助入住", shots: [shot], context: { hook: { type: "question" } }, generatedAt: "2026-10-05T00:00:00.000Z" });

describe("native film handoff", () => {
  it("recovers complete native prompts by ID after vendor's summary export, preserving order and fields", () => {
    const result = { productionEngine: { shots: [{ shotId: "S1", duration: 6, sceneType: "opening", scene: "酒店大堂" }], prompts: [shot] } };
    expect(nativeProductionShots(result)).toMatchObject([shot]);
  });
  it.each(["missing", "duplicate", "degraded", "empty-prompt", "duration-change"])("rejects %s instead of inventing replacement shots", kind => {
    const prompts = [structuredClone(shot)];
    if (kind === "missing") prompts.length = 0;
    if (kind === "duplicate") prompts.push(structuredClone(shot));
    if (kind === "degraded") Object.assign(prompts[0]!, { degraded: true });
    if (kind === "empty-prompt") prompts[0]!.prompt = "";
    if (kind === "duration-change") prompts[0]!.duration = 10;
    expect(() => nativeProductionShots({ productionEngine: { shots: [{ shotId: "S1", duration: 6 }], prompts } })).toThrow("NATIVE");
  });
  it("freezes actual native shots and binds the scope, run and complete prompt/field content", () => {
    const source = build();
    expect(source.shots[0]).toMatchObject({ shotId: "S1", duration: 6, prompt: shot.prompt, scene: shot.fields.scene });
    expect(() => assertNativeFilmSource(source, binding, [shot])).not.toThrow();
    for (const mutate of [
      (s: typeof source) => { s.shots[0]!.prompt = "Codex手写"; },
      (s: typeof source) => { s.shots[0]!.duration = 10; },
      (s: typeof source) => { s.productionSource.runId = "R0"; },
      (s: typeof source) => { s.productionSource.workspaceId = "elsewhere"; },
      (s: typeof source) => { s.shots.push(structuredClone(s.shots[0]!)); },
    ]) { const s = structuredClone(source); mutate(s); expect(() => assertNativeFilmSource(s, binding, [shot])).toThrow("NATIVE"); }
  });
  it("requires the complete original production and post-production stages", () => {
    expect(normalizeNativeFilmJobRequest(undefined, {}).stages).toEqual([...NATIVE_FILM_STAGES]);
    for (const stage of NATIVE_FILM_STAGES) expect(() => normalizeNativeFilmJobRequest(NATIVE_FILM_STAGES.filter(s => s !== stage), {})).toThrow("PIPELINE_INCOMPLETE");
    for (const options of [{ only: "S1" }, { assemblyMode: "post-only" }, { materialPostOnly: true }, { noResume: true }, { maxAttempts: 2 }, { noDanmaku: true }, { noCoverKb: true }]) {
      expect(() => normalizeNativeFilmJobRequest(undefined, options)).toThrow();
    }
    expect(normalizeNativeFilmJobRequest(undefined, { reviewPolicy: "off", maxAttempts: 1 }).options).toMatchObject({ "review-policy": "off", "max-attempts": "1" });
  });
});
