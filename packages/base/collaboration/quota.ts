import type { DecisionItem, DecisionPacket } from "./schema.js";

const TIER_RANK: Record<DecisionItem["tier"], number> = { l4_chairman: 3, l3_fleet: 2, l2_captain: 1 };

/**
 * 决策信箱批次化：按"层级 → 截止时间 → 风险 → 先来先办"排序，默认每日 ≤7 件。
 * 超出配额的进入 overflow（不是丢弃；由上级先分层：合并/延后/带内决掉再报备）。
 */
export function buildDecisionPacket(items: readonly DecisionItem[], quota = 7): DecisionPacket {
  if (!Number.isInteger(quota) || quota < 1) throw new Error(`决策配额必须是正整数，收到 ${quota}`);
  const sorted = [...items].sort((a, b) => {
    const tier = TIER_RANK[b.tier] - TIER_RANK[a.tier];
    if (tier !== 0) return tier;
    const da = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
    const db = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    if (a.risk !== b.risk) return b.risk - a.risk;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
  return {
    quota,
    items: sorted.slice(0, quota),
    overflow: sorted.slice(quota),
    overflowCount: Math.max(0, sorted.length - quota),
  };
}
