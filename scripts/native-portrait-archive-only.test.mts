import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const root = path.resolve(process.env.WORKLOOM_ASSERTION_MODULE_ROOT ?? new URL("../", import.meta.url).pathname);
const at = (file: string) => import(pathToFileURL(path.join(root, file)).href);
async function fixture(run: (value: any) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), "wl-portrait-archive-only-"));
  try {
    const { createPortraitRuntime } = await at("packages/video-studio/src/portrait-runtime.ts");
    const { readPortraitArtifact } = await at("packages/video-studio/src/character-archive.ts");
    const photo = path.join(dir, "existing.jpg"); writeFileSync(photo, Buffer.alloc(2048, 3));
    const source = readPortraitArtifact(photo), calls: string[] = [];
    const assets = [{ kind: "character", id: "ceo", name: "CEO", aliases: [], files: { front: source } },
      { kind: "product", id: "machine", name: "自助机", aliases: [], files: { front: source } }];
    const config = { workDir: dir, projectId: "PROJECT", apiKey: "fixture-only-placeholder", model: "fixture-model", archiveOnly: true, existingAssets: assets,
      fetchImpl: async (url: string) => { calls.push(url); return url.endsWith("/images/generations")
        ? Response.json({ data: [{ url: "https://fixture.invalid/image" }] }) : new Response(Buffer.alloc(2048, 4)); } };
    await run({ dir, photo, source, calls, assets, config, createPortraitRuntime });
  } finally { rmSync(dir, { recursive: true }); }
}
test("explicit existing archive mode rejects any new character or product before provider or download requests", async () => {
  await fixture(async ({ createPortraitRuntime, config, calls }) => {
    const runtime = createPortraitRuntime(config);
    for (const task of [{ characterId: "new-ceo", characterName: "另一个CEO", angle: "front", description: "三十岁女性，短发，商务西装，自信气质" },
      { productId: "new-machine", productName: "另一个商品", view: "front", prompt: "商品实拍" },
      { characterId: "ceo", angle: "front", archiveAssetId: "" }, { characterId: "ceo", angle: "front", archiveAssetId: null }]) {
      await assert.rejects(() => runtime.apiRender(task), /PORTRAIT_ARCHIVE_REQUIRED/);
    }
    assert.equal(calls.length, 0); assert.deepEqual(runtime.snapshot().characters, {}); assert.deepEqual(runtime.snapshot().products, {});
  });
});
test("verified character and product images reuse exact archived bytes and provenance with no image calls", async () => {
  await fixture(async ({ createPortraitRuntime, config, calls, photo }) => {
    const runtime = createPortraitRuntime(config);
    const a = await runtime.apiRender({ characterId: "ceo", characterName: "CEO", angle: "front", archiveAssetId: "ceo" });
    const b = await runtime.apiRender({ productId: "machine", productName: "自助机", view: "front", archiveAssetId: "machine" });
    assert.deepEqual(readFileSync(a), readFileSync(photo)); assert.deepEqual(readFileSync(b), readFileSync(photo));
    assert.equal(calls.length, 0);
    assert.equal(runtime.snapshot().characters.ceo.receipts.front.model, "workloom.existing-archive");
    assert.equal(runtime.snapshot().products.machine.receipts.front.endpoint, "workloom-archive://product/machine");
  });
});
test("unknown archive, unavailable angle and wrong asset kind fail before any paid or reference request", async () => {
  await fixture(async ({ createPortraitRuntime, config, calls }) => {
    const runtime = createPortraitRuntime(config);
    for (const task of [{ characterId: "ceo", angle: "front", archiveAssetId: "foreign" },
      { characterId: "ceo", angle: "side", archiveAssetId: "ceo" }, { productId: "machine", view: "front", archiveAssetId: "ceo" }]) {
      await assert.rejects(() => runtime.apiRender(task), /PORTRAIT_ARCHIVE_UNVERIFIED/);
    }
    assert.equal(calls.length, 0);
  });
});
test("changed or unavailable controlled image cannot fall back to image generation", async () => {
  await fixture(async ({ createPortraitRuntime, config, photo, calls }) => {
    const runtime = createPortraitRuntime(config); writeFileSync(photo, Buffer.alloc(2048, 9));
    await assert.rejects(() => runtime.apiRender({ characterId: "ceo", angle: "front", archiveAssetId: "ceo" }), /PORTRAIT_ARCHIVE_CHANGED/);
    rmSync(photo);
    await assert.rejects(() => runtime.apiRender({ characterId: "ceo", angle: "front", archiveAssetId: "ceo" }));
    assert.equal(calls.length, 0);
  });
});
test("archive-only mode rejects empty or malformed configuration instead of silently using generation", async () => {
  await fixture(async ({ createPortraitRuntime, config, calls }) => {
    for (const change of [{ existingAssets: [] }, { existingAssets: undefined }, { archiveOnly: "yes" }]) {
      assert.throws(() => createPortraitRuntime({ ...config, ...change }), /PORTRAIT_CONFIG_INVALID/);
    }
    assert.equal(calls.length, 0);
  });
});
test("ordinary preparation without explicit archive selection retains its single genuine generation path", async () => {
  await fixture(async ({ createPortraitRuntime, config, calls }) => {
    const runtime = createPortraitRuntime({ ...config, archiveOnly: false, existingAssets: [] });
    const output = await runtime.apiRender({ characterId: "new-model", characterName: "测试角色", angle: "front", description: "三十岁女性，短发，商务西装，自信气质" });
    assert.equal(readFileSync(output).length, 2048); assert.equal(calls.filter((url: string) => url.endsWith("/images/generations")).length, 1);
  });
});
test("actual host portrait configuration enables archive-only mode when customer archive identities resolve", async () => {
  await fixture(async ({ assets, config, createPortraitRuntime, calls }) => {
    const source = readFileSync(path.join(root, "apps/server/src/video/studio-worker.ts"), "utf8");
    const start = source.indexOf("function portraitConfig("), end = source.indexOf("\n}", start) + 2;
    assert.ok(start >= 0 && end > start);
    const esbuild = createRequire(realpathSync(path.join(root, "node_modules/tsx/package.json")))("esbuild");
    const fn = runInNewContext(esbuild.transformSync("(() => { " + source.slice(start, end) + ";return portraitConfig; })()", { loader: "ts" }).code,
      { process: { env: { VOLCENGINE_ARK_API_KEY: "fixture-only-placeholder", ARK_IMAGE_MODEL: "fixture-model" } }, path, REPO_ROOT: root, collectReferenceImages: () => [] });
    const selected = fn({}, { portraits: assets });
    assert.equal(selected.archiveOnly, true); assert.equal(selected.retries, 0); assert.equal(fn({}, { portraits: [] }).archiveOnly, false);
    const runtime = createPortraitRuntime({ ...config, ...selected });
    await assert.rejects(() => runtime.apiRender({ characterId: "unplanned", angle: "front", description: "三十岁女性，短发，商务西装，自信气质" }), /PORTRAIT_ARCHIVE_REQUIRED/);
    assert.equal(calls.length, 0);
  });
});
