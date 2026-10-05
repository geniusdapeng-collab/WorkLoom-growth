import { describe, expect, it } from "vitest";
import { validateNativeFilmHandoff, planNativeFilmHandoff } from "./native-film-planner.js";
const shots = [{ shotId: "S1", duration: 6, prompt: "原生完整提示词", fields: { scene: "酒店大堂" }, scene: "明亮酒店大堂", action: "CEO面对镜头介绍自助入住", dialogue: [{ speaker: "CEO", text: "入住更方便" }] }];
const output = () => ({ hook: { type: "benefit", promise: "入住更方便", payoffShotId: "S1", firstShotTemplate: { visual: "CEO介绍自助入住", line: "入住更方便" }, sfx: { kind: "impact", atSec: 0.08 } },
  sceneBible: { spaceId: "lobby", space: { building: "酒店大堂" }, materials: [{ item: "台面", material: "大理石" }, { item: "窗", material: "玻璃" }], practicalLights: [{ type: "窗光" }], traces: [], environmentProfile: { setting: "interior", condition: "maintained" } }, shotMetadata: [{ shotId: "S1", sceneId: "lobby" }] });
describe("native pipeline film handoff compiler", () => {
  it("compiles physical and hook contracts without rewriting source prompts, fields, timing or dialogue", () => {
    const result = validateNativeFilmHandoff(output(), shots, "视频号");
    expect(result.shots[0]).toMatchObject(shots[0]!);
    expect(result.shots[0]!.sceneId).toBe("lobby");
  });
  it.each(["rewrite", "missing", "duplicate", "unknown", "scene-conflict", "hook", "material"])('rejects %s before any render', kind => {
    const value = output();
    if (kind === "rewrite") Object.assign(value.shotMetadata[0]!, { prompt: "临时手写" });
    if (kind === "missing") value.shotMetadata = [];
    if (kind === "duplicate") value.shotMetadata.push(value.shotMetadata[0]!);
    if (kind === "unknown") value.shotMetadata[0]!.shotId = "S9";
    if (kind === "scene-conflict") value.shotMetadata[0]!.sceneId = "unknown";
    if (kind === "hook") value.hook.payoffShotId = "S9";
    if (kind === "material") value.sceneBible.materials = [];
    expect(() => validateNativeFilmHandoff(value, shots, "视频号")).toThrow("NATIVE_FILM_PLAN_UNVERIFIED");
  });
  it("does not invent a fallback or retry when the planner is unavailable", async () => {
    let count = 0;
    await expect(planNativeFilmHandoff({ intent: "30秒", platform: "视频号", shots, nativeStages: {}, llm: { async reason() { count++; return { success: false, error: "不可用" }; } } })).rejects.toThrow("不可用");
    expect(count).toBe(1);
  });
});
