import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchExistingPortraitAsset, type ExistingPortraitAsset } from "./portrait-archive-bridge.js";
import { createPortraitRuntime } from "./portrait-runtime.js";
import { readPortraitArtifact } from "./character-archive.js";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "portrait-archive-")); dirs.push(root);
  const file = join(root, "original.jpg"); writeFileSync(file, Buffer.alloc(4096, 8));
  const asset: ExistingPortraitAsset = { kind: "character", id: "ceo", name: "系统出镜人物", aliases: ["CEO"], files: { front: readPortraitArtifact(file) } };
  let calls = 0;
  const runtime = createPortraitRuntime({ workDir: root, projectId: "P1", apiKey: "test", model: "test", existingAssets: [asset],
    fetchImpl: (async () => { calls++; throw new Error("should not generate existing asset"); }) as typeof fetch });
  return { root, file, asset, runtime, calls: () => calls };
}
describe("native existing portrait archive", () => {
  it("reuses exact accepted bytes and records provenance without any provider call", async () => {
    const f = fixture(); const file = await f.runtime.apiRender({ portraitId: "ceo-front", characterId: "ceo", characterName: "系统出镜人物", angle: "front", archiveAssetId: "ceo" });
    expect(readFileSync(file)).toEqual(readFileSync(f.file)); expect(f.calls()).toBe(0);
    expect(f.runtime.snapshot().characters.ceo!.receipts!.front!.model).toBe("workloom.existing-archive");
  });
  it("rejects unknown or changed accepted views without generating a substitute", async () => {
    const f = fixture();
    await expect(f.runtime.apiRender({ characterId: "ceo", angle: "back", archiveAssetId: "ceo" })).rejects.toThrow("PORTRAIT_ARCHIVE_UNVERIFIED");
    writeFileSync(f.file, Buffer.alloc(4096, 9));
    await expect(f.runtime.apiRender({ characterId: "ceo", angle: "front", archiveAssetId: "ceo" })).rejects.toThrow("PORTRAIT_ARCHIVE_CHANGED");
    expect(f.calls()).toBe(0);
  });
  it("resolves identity by registered names and rejects ambiguous aliases", () => {
    const { asset } = fixture();
    expect(matchExistingPortraitAsset([asset], "character", "", "CEO")).toBe(asset);
    expect(matchExistingPortraitAsset([asset], "product", "ceo", "CEO")).toBeUndefined();
    expect(() => matchExistingPortraitAsset([asset, { ...asset, id: "other" }], "character", "", "CEO")).toThrow("AMBIGUOUS");
  });
  it("never retries an unknown charged POST even with an old retry setting", async () => {
    const f = fixture(); let calls = 0;
    const runtime = createPortraitRuntime({ workDir: f.root, projectId: "P2", apiKey: "test", model: "test", retries: 2,
      fetchImpl: (async () => { calls++; throw new Error("connection dropped after POST"); }) as typeof fetch });
    await expect(runtime.apiRender({ characterId: "new", angle: "front", prompt: "三十岁女性，黑发商务套装，自然妆容" })).rejects.toThrow("connection dropped");
    expect(calls).toBe(1);
  });
});
