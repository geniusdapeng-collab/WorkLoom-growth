/** Select existing archive angles inside the native PortraitStudio plan; no fabricated views or image calls. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { PortraitInputReceipt } from "./portrait-runtime.js";

export interface ExistingPortraitAsset {
  kind: "character" | "product"; id: string; name: string; aliases: string[]; files: Record<string, PortraitInputReceipt>;
}
const scopes = new AsyncLocalStorage<{ assets: ExistingPortraitAsset[]; active: boolean }>();
type Json = Record<string, any>;
const normalize = (value: unknown): string => String(value ?? "").replace(/\s+/g, "").toLowerCase();
export function matchExistingPortraitAsset(assets: ExistingPortraitAsset[], kind: "character" | "product", id: unknown, name: unknown): ExistingPortraitAsset | undefined {
  const candidates = assets.filter(asset => asset.kind === kind && [asset.id, asset.name, ...asset.aliases].some(alias => [id, name].some(value => normalize(value) && normalize(value) === normalize(alias))));
  if (candidates.length > 1) throw new Error("PORTRAIT_ARCHIVE_AMBIGUOUS: 角色或商品身份匹配多个档案");
  return candidates[0];
}
let installed: ((...args: any[]) => any) | undefined;
function install(): void {
  const module = createRequire(import.meta.url)(fileURLToPath(new URL("../../../vendor/supermickey/hyperreality-system/engines/portrait-studio/index.js", import.meta.url)));
  const prototype = module.PortraitStudio.prototype;
  if (installed) { if (prototype.plan !== installed) throw new Error("PORTRAIT_ARCHIVE_BRIDGE_CONFLICT"); return; }
  const original = prototype.plan;
  installed = function(this: Json, context: Json): Json {
    const plan = original.call(this, context), scope = scopes.getStore();
    if (!scope) return plan;
    if (!scope.active) throw new Error("PORTRAIT_ARCHIVE_SCOPE_CLOSED");
    for (const task of plan.characterTasks ?? []) {
      const asset = matchExistingPortraitAsset(scope.assets, "character", task.characterId, task.characterName);
      if (!asset) continue;
      task.portraits = Object.keys(asset.files).map(angle => ({ portraitId: `${task.characterId}-${angle}`, characterId: task.characterId,
        characterName: task.characterName, angle, angleName: angle, prompt: `复用档案 ${asset.id} 的已验收 ${angle} 图`,
        archiveAssetId: asset.id, status: "pending", outputFile: null }));
      task.angleCount = task.portraits.length; task.source = "controlled-existing-archive";
    }
    for (const task of plan.productTasks ?? []) {
      const asset = matchExistingPortraitAsset(scope.assets, "product", task.productId, task.productName);
      if (!asset) continue;
      task.stages.stylization.portraits = Object.keys(asset.files).map(view => ({ portraitId: `${task.productId}-${view}`,
        productId: task.productId, productName: task.productName, view, prompt: `复用客户商品档案 ${asset.id} 的 ${view} 实拍图`,
        archiveAssetId: asset.id, status: "pending", outputFile: null }));
      task.source = "controlled-existing-archive";
    }
    const all = [...(plan.characterTasks ?? []).map((task: Json) => ({ name: task.characterName, files: task.portraits })),
      ...(plan.productTasks ?? []).map((task: Json) => ({ name: task.productName, files: task.stages.stylization.portraits }))];
    plan.summary = ["# 定妆照计划（实际视角，复用档案保留来源回执）", ...all.map(task => `- ${task.name}：${task.files.length} 张 — ${task.files.map((p: Json) => p.angle ?? p.view).join("、")}`),
      `共 ${all.reduce((sum, task) => sum + task.files.length, 0)} 张。`].join("\n");
    return plan;
  };
  prototype.plan = installed;
}
export async function withNativePortraitArchives<T>(assets: ExistingPortraitAsset[], run: () => Promise<T>): Promise<T> {
  if (!assets.length) return run();
  install();
  const scope = { assets, active: true };
  return scopes.run(scope, async () => { try { return await run(); } finally { scope.active = false; } });
}
