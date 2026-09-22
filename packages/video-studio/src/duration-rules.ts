/**
 * duration-rules.ts —— 镜头时长规则**唯一真源 + 统一校验**（2026-09-23）
 *
 * 背景：单镜时长散落在 5 处口径里，任何一处没对齐都会「计划能拍、提交被拒」或「节奏被悄悄夹紧」：
 *   ① 媒体目录 `media-catalog.json#durationSec`（供应商能力上限，2026-09-23 实测 Seedance 2.5 = 4–30s）
 *   ② vendor `DurationConstraintManager`（`maxSingleShot` + rhythmProfiles 的 shotRange，默认上限 15/12）
 *   ③ vendor `ThemeConfig.types[*].maxShotDuration`（题材级上限，默认 15）
 *   ④ `requirement-list-builder` 的 `constraints.maxShotDuration`（需求清单里的建议上限，默认 15）
 *   ⑤ 出片工具 `render-project.mts` 的时长分配夹紧（此前硬编码 4–15）
 * 本模块把 ①②③ 收敛成一次读取 + 一次校验，供 studio（运行期策略）、出片工具（分配）与审计共用。
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

export interface DurationRules {
  /** 供应商侧能力（媒体目录） */
  modelId: string;
  modelMin: number;
  modelMax: number;
  modelDefault: number;
  /** vendor 运行期约束 */
  vendorMaxSingleShot: number;
  vendorMinSingleShot: number;
  vendorMaxTotal: number;
  vendorMinTotal: number;
  /** 题材级上限（ThemeConfig，取所有题材的最大值用于展示偏差） */
  themeMaxShotDuration: number;
  /** 需求清单建议上限（requirement-list-builder） */
  builderMaxShotDuration: number;
  /** 一致性结论：以上四处上限是否全部 ≥ 供应商上限 */
  aligned: boolean;
  misaligned: Array<{ source: string; value: number; note: string }>;
}

export interface DurationPlanEntry {
  shotId: string;
  seconds: number;
  source: number;
  clamped: boolean;
}

export interface DurationValidation {
  pass: boolean;
  targetTotalSeconds: number | null;
  actualTotalSeconds: number;
  entries: DurationPlanEntry[];
  issues: string[];
  warnings: string[];
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolvePath(here, "../../..");
}

/** 读取媒体目录里某模型的时长能力（唯一真源） */
export function loadModelDurationLimits(modelId: string): { min: number; max: number; default: number } {
  const path = process.env.WORKLOOM_MEDIA_CATALOG?.trim()
    || resolvePath(repoRoot(), "bundles/ai-video/library/media-catalog/media-catalog.json");
  const doc = JSON.parse(readFileSync(path, "utf8")) as {
    models: Array<{ id: string; limits?: { durationSec?: { min?: number; max?: number; default?: number } } }>;
  };
  const model = doc.models.find((m) => m.id === modelId);
  const limits = model?.limits?.durationSec ?? {};
  return {
    min: limits.min ?? 4,
    max: limits.max ?? 15,
    default: limits.default ?? 5
  };
}

/** 汇总四处时长口径（A 级：媒体目录 + vendor 源码常量） */
export function loadDurationRules(modelId = "doubao-seedance-2-5"): DurationRules {
  const model = loadModelDurationLimits(modelId);
  const vendorRequire = createRequire(resolvePath(repoRoot(), "package.json"));
  let vendorMaxSingleShot = 15;
  let vendorMinSingleShot = 3;
  let vendorMaxTotal = 300;
  let vendorMinTotal = 15;
  try {
    const managerPath = resolvePath(
      repoRoot(),
      "vendor/supermickey/hyperreality-system/engines/duration-constraint/duration-constraint-manager.js"
    );
    if (existsSync(managerPath)) {
      const mod = vendorRequire(managerPath) as { DurationConstraintManager?: new (o?: Record<string, unknown>) => Record<string, unknown> };
      const probe = mod?.DurationConstraintManager ? new mod.DurationConstraintManager({}) : null;
      if (probe) {
        vendorMaxSingleShot = Number(probe.maxSingleShot ?? vendorMaxSingleShot);
        vendorMinSingleShot = Number(probe.minSingleShot ?? vendorMinSingleShot);
        vendorMaxTotal = Number(probe.maxTotalDuration ?? vendorMaxTotal);
        vendorMinTotal = Number(probe.minTotalDuration ?? vendorMinTotal);
      }
    }
  } catch {
    /* 保持默认常量（审计会标注） */
  }
  let themeMaxShotDuration = 15;
  try {
    const themePath = resolvePath(repoRoot(), "vendor/supermickey/hyperreality-system/config/theme-config.js");
    if (existsSync(themePath)) {
      const theme = vendorRequire(themePath) as { types?: Record<string, { maxShotDuration?: number }> };
      const values = Object.values(theme?.types ?? {})
        .map((t) => Number(t?.maxShotDuration))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (values.length > 0) themeMaxShotDuration = Math.max(...values);
    }
  } catch {
    /* 同上 */
  }
  /** requirement-list-builder 的建议上限（源码常量 15，运行期不参与夹紧，仅作审计口径） */
  const builderMaxShotDuration = 15;

  const misaligned: DurationRules["misaligned"] = [];
  if (vendorMaxSingleShot < model.max) {
    misaligned.push({
      source: "DurationConstraintManager.maxSingleShot",
      value: vendorMaxSingleShot,
      note: "运行期会把镜头夹到该上限（比模型能力低）"
    });
  }
  if (themeMaxShotDuration < model.max) {
    misaligned.push({
      source: "ThemeConfig.maxShotDuration",
      value: themeMaxShotDuration,
      note: "题材级规划上限（比模型能力低）"
    });
  }
  if (builderMaxShotDuration < model.max) {
    misaligned.push({
      source: "requirement-list-builder.constraints.maxShotDuration",
      value: builderMaxShotDuration,
      note: "需求清单建议上限（比模型能力低，属建议口径）"
    });
  }
  return {
    modelId,
    modelMin: model.min,
    modelMax: model.max,
    modelDefault: model.default,
    vendorMaxSingleShot,
    vendorMinSingleShot,
    vendorMaxTotal,
    vendorMinTotal,
    themeMaxShotDuration,
    builderMaxShotDuration,
    aligned: misaligned.length === 0,
    misaligned
  };
}

/**
 * 按目标总时长分配逐镜时长（等比缩放 + 夹紧到模型能力区间 + 余量补给最长镜）。
 * 与 `render-project.mts` 此前实现语义一致，但上限改为**从媒体目录读取**。
 */
export function allocateShotDurations(
  shots: Array<{ shotId: string; duration?: number }>,
  options: { totalSeconds: number; modelId?: string; minSeconds?: number; maxSeconds?: number } 
): { entries: DurationPlanEntry[]; map: Map<string, number> } {
  const limits = loadModelDurationLimits(options.modelId ?? "doubao-seedance-2-5");
  const min = options.minSeconds ?? limits.min;
  const max = options.maxSeconds ?? limits.max;
  const raw = shots.map((s) => Math.max(1, Number(s.duration) || min));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const scaled = raw.map((d) => Math.min(max, Math.max(min, Math.round((d * options.totalSeconds) / sum))));
  let drift = options.totalSeconds - scaled.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (drift !== 0 && guard < 500) {
    const order = scaled.map((d, i) => ({ i, d })).sort((a, b) => b.d - a.d);
    let moved = false;
    for (const { i, d } of order) {
      if (drift > 0 && d < max) { scaled[i] = d + 1; drift -= 1; moved = true; }
      else if (drift < 0 && d > min) { scaled[i] = d - 1; drift += 1; moved = true; }
      if (drift === 0) break;
    }
    if (!moved) break;
    guard += 1;
  }
  const entries = shots.map((s, i) => ({
    shotId: s.shotId,
    seconds: scaled[i]!,
    source: raw[i]!,
    clamped: scaled[i] !== Math.round((raw[i]! * options.totalSeconds) / sum)
  }));
  return { entries, map: new Map(entries.map((e) => [e.shotId, e.seconds])) };
}

/** 统一校验：逐镜区间 + 总时长 + 片头镜 + 与规则口径的一致性 */
export function validateShotDurations(
  shots: Array<{ shotId: string; duration?: number; sceneType?: string }>,
  options: { targetTotalSeconds?: number | null; modelId?: string; toleranceSeconds?: number } = {}
): DurationValidation {
  const rules = loadDurationRules(options.modelId ?? "doubao-seedance-2-5");
  const issues: string[] = [];
  const warnings: string[] = [];
  const entries: DurationPlanEntry[] = [];
  const tolerance = options.toleranceSeconds ?? 1;

  for (const shot of shots) {
    const source = Number(shot.duration ?? 0);
    let seconds = source;
    let clamped = false;
    if (seconds < rules.modelMin) { seconds = rules.modelMin; clamped = true; issues.push(`${shot.shotId}: 时长 ${source}s 低于模型下限 ${rules.modelMin}s（已夹紧）`); }
    if (seconds > rules.modelMax) { seconds = rules.modelMax; clamped = true; issues.push(`${shot.shotId}: 时长 ${source}s 超过模型上限 ${rules.modelMax}s（已夹紧）`); }
    if (shot.sceneType === "opening" && seconds > rules.modelMax) {
      issues.push(`${shot.shotId}: 片头镜时长超出上限`);
    }
    entries.push({ shotId: shot.shotId, seconds, source, clamped });
  }

  const actual = entries.reduce((sum, e) => sum + e.seconds, 0);
  const target = options.targetTotalSeconds ?? null;
  if (target !== null && Math.abs(actual - target) > tolerance) {
    issues.push(`总时长 ${actual}s 与目标 ${target}s 偏差超过 ±${tolerance}s`);
  }
  if (actual > rules.vendorMaxTotal) issues.push(`总时长 ${actual}s 超过 vendor 上限 ${rules.vendorMaxTotal}s`);
  if (!rules.aligned) {
    warnings.push(
      `时长口径未对齐：${rules.misaligned.map((m) => `${m.source}=${m.value}s（模型 ${rules.modelMax}s）`).join("；")}`
    );
  }
  return {
    pass: issues.length === 0,
    targetTotalSeconds: target,
    actualTotalSeconds: actual,
    entries,
    issues,
    warnings
  };
}

export function durationValidationMarkdown(validation: DurationValidation): string {
  return [
    `| 镜头 | 计划(s) | 采用(s) | 夹紧 |`,
    `|---|---:|---:|---|`,
    ...validation.entries.map((e) => `| ${e.shotId} | ${e.source} | ${e.seconds} | ${e.clamped ? "是" : "—"} |`),
    "",
    `- 合计：${validation.actualTotalSeconds}s` + (validation.targetTotalSeconds !== null ? `（目标 ${validation.targetTotalSeconds}s，容差 ±1s）` : ""),
    `- 结论：${validation.pass ? "✅ 通过" : `❌ 不通过（${validation.issues.length} 项）`}`,
    ...validation.issues.map((i) => `  - ${i}`),
    ...validation.warnings.map((w) => `  - ⚠️ ${w}`)
  ].join("\n");
}
