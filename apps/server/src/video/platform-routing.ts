/**
 * 服务端原始需求的目标平台识别（T-2026-0930-0005）。
 *
 * 与 scene-policy-routing.ts 同构：在建档与调用制片供应商之前锁定平台口径，
 * 结论写进事件账本，并把口径块追加进需求正文（不依赖元数据被下游正确读取）。
 *
 * 为什么需要这一层：cover-platforms.ts 只提供"给定平台 ID 取规格"，
 * 平台值本身在服务端派活链路上没有来源——用户写"做一条抖音短视频"时，
 * 抖音的画幅/安全区/语速/钩子窗口都不会生效。本模块把这一步补上：
 * 显式参数 > 调用方元数据（platform / coverPlatform / brief.platform）> 需求文本命中 > 默认抖音。
 */
import {
  platformDeliveryGuidance,
  speechRateProfile,
  resolvePlatformIntent,
  type PlatformIntentDecision,
} from "@hyperreality/video-studio";

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** 从调用方元数据里取显式平台（三种登记口径；空串视为未登记）。 */
export function explicitPlatformFromMetadata(metadata?: Record<string, unknown> | null): string {
  const root = record(metadata);
  if (!root) return "";
  const direct = text(root.platform);
  if (direct) return direct;
  const cover = text(root.coverPlatform);
  if (cover) return cover;
  return text(record(root.brief)?.platform);
}

export interface PlatformRoute {
  decision: PlatformIntentDecision;
  /** 已写入 platform 与 platformSelection 的新元数据（不改原对象）。 */
  metadata: Record<string, unknown>;
}

/**
 * 解析目标平台并回写元数据。
 * 不抛错：未登记的显式值按默认口径处理，但决策里保留 requested 原值以便排查。
 */
export function resolvePlatformForIntent(
  rawIntent: string,
  metadata?: Record<string, unknown> | null,
  explicit?: string | null,
): PlatformRoute {
  const request = text(explicit) || explicitPlatformFromMetadata(metadata);
  const decision = resolvePlatformIntent(rawIntent, request || undefined);
  const next: Record<string, unknown> = {
    ...(record(metadata) ?? {}),
    platform: decision.id,
    platformSelection: decision,
  };
  return { decision, metadata: next };
}

/** 把平台制作口径写进供应商与生成端都能看到的需求正文（元数据可能被旧 vendor 忽略）。 */
export function appendPlatformGuidance(intent: string, decision: PlatformIntentDecision, actor?: { name: string; speechRate: unknown }): string {
  if (actor?.speechRate !== undefined) {
    const match = typeof actor.speechRate === "string" ? actor.speechRate.trim().match(/^(\d+(?:\.\d+)?)\s*字\s*\/\s*秒$/u) : null;
    const rate = Number(match?.[1]), platform = speechRateProfile(decision.id);
    if (!match || !Number.isFinite(rate) || rate <= 0 || rate > platform.max) throw new Error("CHARACTER_SPEECH_RATE_UNVERIFIED: 已选人物语速无法在平台硬上限内执行");
    return `${intent}\n[平台制作口径 ${decision.id}·${decision.label}] 目标平台：${decision.label}（${decision.reason}）。`
      + `画幅 ${decision.aspectRatio}；开场钩子须落在前 ${platform.hookWindowSec} 秒。`
      + `语速：目标 ${rate} 字/秒、上限 ${rate} 字/秒；本片已选人物 ${actor.name} 的档案语速优先，平台通用目标不覆盖人物。`
      + `每句台词可念字数为镜时长 × ${rate}，超出则改短文案，禁止拉快配音。配音基础速率 1×。`;
  }
  return `${intent}${platformDeliveryGuidance(decision)}`;
}
