import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadProductArchiveSource } from "./product-archive-source.js";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "product-archive-")); dirs.push(root); const dir = join(root, "product"); mkdirSync(dir);
  const bytes = Buffer.from("photo bytes"), profile = { schemaVersion: "workloom.product-archive/v1", id: "product", displayName: "酒店自助机", model: "P1", source: { kind: "user-upload", reviewStatus: "owner-confirmed" },
    specs: { features: ["无需更换门锁系统"] }, photos: [{ id: "p1", file: "photo.jpg", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }] };
  writeFileSync(join(dir, "photo.jpg"), bytes); writeFileSync(join(dir, "profile.json"), JSON.stringify(profile)); return { root, dir, profile };
}
describe("controlled product archive source", () => {
  it("freezes complete customer bytes and actual photos rather than a hand-written selling-point object", async () => {
    const f = fixture(), result = await loadProductArchiveSource("product", f.root);
    expect(result.snapshot.text).toBe(JSON.stringify(f.profile)); expect(result.snapshot.assetUrls).toEqual(["workloom-archive://products/product/photo.jpg"]);
    expect(result.productQuery).toEqual({ name: "酒店自助机", model: "P1" });
  });
  it.each(["changed", "unconfirmed", "symlink", "path"])("rejects %s archives", async kind => {
    const f = fixture();
    if (kind === "changed") writeFileSync(join(f.dir, "photo.jpg"), "changed");
    if (kind === "unconfirmed") { f.profile.source.reviewStatus = "pending"; writeFileSync(join(f.dir, "profile.json"), JSON.stringify(f.profile)); }
    if (kind === "symlink") { f.profile.photos[0]!.file = "escape.jpg"; symlinkSync(join(f.dir, "photo.jpg"), join(f.dir, "escape.jpg")); writeFileSync(join(f.dir, "profile.json"), JSON.stringify(f.profile)); }
    await expect(loadProductArchiveSource(kind === "path" ? "../product" : "product", f.root)).rejects.toThrow("PRODUCT_ARCHIVE");
  });
});
