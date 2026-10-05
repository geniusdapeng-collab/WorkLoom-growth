/** Resolve only registered library identities before native planning; caller paths and stage outputs have no authority. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { loadProductArchiveSource } from "./product-archive-source.js";
import { loadCharacterLibrary, loadRealPersonAssets, loadProductArchives, selectProductArchive, productPhotoPath,
  resolveShotCharacters, assertShotMatchesCertifiedAsset, referenceAssetRefs, readPortraitArtifact,
  type CharacterEntry, type ExistingPortraitAsset, type NativeProductionShot, type RealPersonAsset } from "@hyperreality/video-studio";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
export interface NativeVideoAssets { portraits: ExistingPortraitAsset[]; guidance: string; character?: CharacterEntry; realPerson?: RealPersonAsset; productId?: string }
export function assertCustomerVideoMetadata(metadata: Record<string, unknown>): void {
  const forbidden = ["shots", "shotlist", "storyboard", "script", "prompts", "promptPack", "characters", "productionEngine", "productionSource", "filmSource", "document", "verifiedRaw", "_dataDossier"];
  for (const section of [metadata, metadata.brief]) {
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    for (const key of forbidden) if (Object.hasOwn(section, key)) throw new Error(`CALLER_SOURCE_FORBIDDEN: 客户需求不得注入${key}，创意、剧本、分镜和提示词由原生管线生成`);
  }
}
/** Resolve an archive identity into the existing router's product anchor before routing, without caller-supplied facts. */
export async function resolveNativeRouteMetadata(metadata: Record<string, unknown>): Promise<Record<string, unknown>> {
  assertCustomerVideoMetadata(metadata);
  if (metadata.productId === undefined) return structuredClone(metadata);
  if (typeof metadata.productId !== "string") throw new Error("PRODUCT_ARCHIVE_ID_INVALID: 商品必须用档案身份选择");
  const archived = await loadProductArchiveSource(metadata.productId);
  return { ...structuredClone(metadata), dataMining: archived.productQuery };
}
export function resolveNativeVideoAssets(metadata: Record<string, unknown>): NativeVideoAssets {
  assertCustomerVideoMetadata(metadata);
  const portraits: ExistingPortraitAsset[] = [], guidance: string[] = [];
  let character: CharacterEntry | undefined, realPerson: RealPersonAsset | undefined, productId: string | undefined;
  if (metadata.characterId !== undefined) {
    if (typeof metadata.characterId !== "string") throw new Error("CHARACTER_ARCHIVE_ID_INVALID: 人物必须用档案身份选择");
    character = loadCharacterLibrary(path.join(root, "bundles/ai-video/library/characters")).get(metadata.characterId);
    if (!character || character.verification.status !== "passed") throw new Error("CHARACTER_ARCHIVE_UNVERIFIED: 人物当前定妆照不可核实");
    const registry = JSON.parse(readFileSync(path.join(root, "bundles/ai-video/library/characters/registry.json"), "utf8"));
    const row = registry.models.find((item: { id: string }) => item.id === character!.id);
    portraits.push({ kind: "character", id: character.id, name: character.name, aliases: row?.aliases ?? [], files: character.verification.assets });
    if (character.kind === "authorized-real") {
      const ref = (character.authorization as Record<string, unknown> | undefined)?.evidence;
      const loaded = loadRealPersonAssets(path.join(root, "bundles/ai-video/library/real-person-assets")).byAssetId.get(String(ref ?? "").replace(/^asset:\/\//, ""));
      if (!loaded || loaded.issues.some(issue => issue.hard)) throw new Error("REAL_PERSON_ARCHIVE_UNVERIFIED: 真人主档与授权不可核实");
      realPerson = loaded.asset;
    }
    guidance.push(`已选定系统人物档案：${JSON.stringify({ id: character.id, name: character.name, identity: character.identity,
      appearance: character.appearance, wardrobe: character.wardrobe, persona: character.persona, certified: realPerson?.certified })}。`);
    guidance.push("原生角色系统和每镜人物字段必须使用该档案的姓名/身份、性别、年龄、服装；复用当前定妆照，不新增同一人物，不凭名字猜属性。");
  }
  if (metadata.productId !== undefined) {
    if (typeof metadata.productId !== "string") throw new Error("PRODUCT_ARCHIVE_ID_INVALID: 商品必须用档案身份选择");
    const library = loadProductArchives(path.join(root, "bundles/ai-video/library/products"));
    const selected = selectProductArchive(library.archives, metadata.productId);
    const entry = selected.archive ? library.byId.get(selected.archive.id) : undefined;
    if (!entry || entry.issues.some(issue => issue.hard)) throw new Error("PRODUCT_ARCHIVE_UNVERIFIED: 当前商品图和档案不可核实");
    productId = entry.archive.id;
    portraits.push({ kind: "product", id: productId, name: entry.archive.displayName, aliases: [...(entry.archive.aliases ?? []), ...(entry.archive.model ? [entry.archive.model] : [])],
      files: Object.fromEntries(entry.archive.photos.map(photo => [photo.id, readPortraitArtifact(productPhotoPath(entry, photo))])) });
    guidance.push(`已选定客户商品档案身份：${productId} / ${entry.archive.displayName}；产品事实须消费本次宿主G1事实包，产品外观使用档案实拍图。`);
  }
  return { portraits, guidance: guidance.join("\n"), character, realPerson, productId };
}
export function bindNativeVideoAssets(shots: NativeProductionShot[], assets: NativeVideoAssets): NativeProductionShot[] {
  return shots.map(shot => {
    const result = structuredClone(shot);
    if (assets.character) {
      const cast = resolveShotCharacters(result, new Map([[assets.character.id, assets.character]]));
      if (cast.status === "failed" || cast.status === "unverified") throw new Error(`NATIVE_CAST_UNVERIFIED: ${shot.shotId} ${cast.notes.join("；")}`);
      if (cast.characters.length && assets.realPerson) {
        const issues = assertShotMatchesCertifiedAsset(result, assets.realPerson).filter(issue => issue.hard);
        if (issues.length) throw new Error(`NATIVE_CAST_CONFLICT: ${issues.map(issue => issue.detail).join("；")}`);
        result.assetRef = `asset://${assets.realPerson.assetId}`;
        result.referenceAssetRefs = referenceAssetRefs(assets.realPerson);
      }
      if (!cast.characters.length && assets.productId && JSON.stringify(result.fields).includes(assets.productId)) result.product = assets.productId;
    }
    return result;
  });
}
