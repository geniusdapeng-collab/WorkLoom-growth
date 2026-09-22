import { describe, expect, it } from "vitest";
import {
  allocateShotDurations,
  durationValidationMarkdown,
  loadDurationRules,
  validateShotDurations
} from "./duration-rules.js";

describe("镜头时长规则（真机实测 4–30s）", () => {
  it("媒体目录口径：Seedance 2.5 单镜上限已提升到 30s", () => {
    const rules = loadDurationRules("doubao-seedance-2-5");
    expect(rules.modelMin).toBe(4);
    expect(rules.modelMax).toBe(30);
  });

  it("分配：30s 单镜不缩水、60s 三镜等比分配且不超上限", () => {
    const single = allocateShotDurations([{ shotId: "S1", duration: 30 }], { totalSeconds: 30 });
    expect(single.map.get("S1")).toBe(30);

    const three = allocateShotDurations(
      [{ shotId: "S1", duration: 10 }, { shotId: "S2", duration: 10 }, { shotId: "S3", duration: 10 }],
      { totalSeconds: 60 }
    );
    expect([...three.map.values()].reduce((a, b) => a + b, 0)).toBe(60);
    for (const value of three.map.values()) expect(value).toBeLessThanOrEqual(30);
  });

  it("校验：3s（低于下限）与 45s（高于上限）都判不合格，30s 单镜通过", () => {
    const tooShort = validateShotDurations([{ shotId: "S1", duration: 3 }], { targetTotalSeconds: 3 });
    expect(tooShort.pass).toBe(false);
    expect(tooShort.issues.join()).toContain("低于模型下限");

    const tooLong = validateShotDurations([{ shotId: "S1", duration: 45 }], { targetTotalSeconds: 45 });
    expect(tooLong.pass).toBe(false);
    expect(tooLong.issues.join()).toContain("超过模型上限");

    const ok = validateShotDurations([{ shotId: "S1", duration: 30, sceneType: "opening" }], { targetTotalSeconds: 30 });
    expect(ok.pass).toBe(true);
  });

  it("校验：总时长与目标偏差会被显式报出（±1s 容差）", () => {
    const drift = validateShotDurations(
      [{ shotId: "S1", duration: 10 }, { shotId: "S2", duration: 10 }],
      { targetTotalSeconds: 30 }
    );
    expect(drift.pass).toBe(false);
    expect(drift.issues.join()).toContain("总时长");
  });

  it("未对齐口径会被列为警告（vendor 15s vs 模型 30s）", () => {
    const markdown = durationValidationMarkdown(
      validateShotDurations([{ shotId: "S1", duration: 20 }], { targetTotalSeconds: 20 })
    );
    expect(markdown).toContain("| S1 | 20 | 20 |");
  });
});
