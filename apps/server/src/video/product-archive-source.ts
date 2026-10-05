/** A customer-confirmed bundled product is a controlled source, never a caller-supplied facts object. */
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { SourceSnapshot } from "./marketing-source-fetcher.js";
import { deriveProductSourcePolicy } from "./product-source-policy.js";

const library = fileURLToPath(new URL("../../../../bundles/ai-video/library/products/", import.meta.url));
const hash = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
async function readInside(root: string, relative: string, maxBytes: number): Promise<Buffer> {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === ".." || part === ".")) throw new Error("PRODUCT_ARCHIVE_PATH_INVALID: 档案路径非法");
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || await realpath(file) !== file) throw new Error("PRODUCT_ARCHIVE_PATH_INVALID: 档案不能通过符号链接逃逸");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !stat.size || stat.size > maxBytes) throw new Error("PRODUCT_ARCHIVE_INVALID: 档案文件为空或过大");
    return await handle.readFile();
  } finally { await handle.close(); }
}
export async function loadProductArchiveSource(productId: string, root = library): Promise<{
  snapshot: SourceSnapshot; rawBytes: Buffer; productQuery: Record<string, unknown>; profile: Record<string, unknown>; photos: string[];
}> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(productId)) throw new Error("PRODUCT_ARCHIVE_ID_INVALID: 只接受商品档案身份，不能传路径或事实正文");
  const base = await realpath(root);
  const rawBytes = await readInside(base, `${productId}/profile.json`, 2 * 1024 * 1024);
  const profile: unknown = JSON.parse(rawBytes.toString("utf8"));
  if (!object(profile) || profile.schemaVersion !== "workloom.product-archive/v1" || profile.id !== productId
    || typeof profile.displayName !== "string" || !object(profile.source) || profile.source.kind !== "user-upload"
    || profile.source.reviewStatus !== "owner-confirmed") throw new Error("PRODUCT_ARCHIVE_UNVERIFIED: 商品档案没有客户确认来源");
  const finalUrl = `workloom-archive://products/${productId}/profile.json`;
  const photos: string[] = [], assetUrls: string[] = [];
  for (const photo of Array.isArray(profile.photos) ? profile.photos : []) {
    if (!object(photo) || typeof photo.file !== "string" || typeof photo.sha256 !== "string") throw new Error("PRODUCT_ARCHIVE_UNVERIFIED: 商品图缺少文件及摘要");
    const bytes = await readInside(base, `${productId}/${photo.file}`, 12 * 1024 * 1024);
    if (hash(bytes) !== photo.sha256 || bytes.length !== photo.bytes) throw new Error("PRODUCT_ARCHIVE_CHANGED: 商品图与客户档案摘要不一致");
    photos.push(path.join(base, productId, photo.file)); assetUrls.push(`workloom-archive://products/${productId}/${photo.file}`);
  }
  const text = rawBytes.toString("utf8"), rawSha256 = hash(rawBytes);
  return { rawBytes, profile, photos, productQuery: { name: profile.displayName,
    ...(typeof profile.brand === "string" ? { brand: profile.brand } : {}), ...(typeof profile.model === "string" ? { model: profile.model } : {}) },
    snapshot: { sourceId: `SRC-${hash(`${finalUrl}\n${rawSha256}`).slice(0, 24)}`, requestedUrl: finalUrl, finalUrl, redirectChain: [],
      fetchedAt: new Date().toISOString(), contentType: "application/json; charset=utf-8", rawSha256, textSha256: hash(text), bytes: rawBytes.length, text, assetUrls,
      policy: deriveProductSourcePolicy(profile) } };
}
