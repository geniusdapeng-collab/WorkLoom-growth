/** Public-entry regression assertions. MODULE_ROOT is only a test target, never a production input. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root = resolve(process.env.WORKLOOM_ASSERTION_MODULE_ROOT ?? new URL("../", import.meta.url).pathname);
const moduleAt = (file: string) => import(pathToFileURL(resolve(root, file)).href);
const hash = "a".repeat(64);
const sourceVersion = { sourceStageRunId: "R1", promptsSha256: hash, filmSourceSha256: hash };

test("public client rejects caller source before sending any request", async () => {
  const { FilmServiceClient } = await moduleAt("packages/video-studio/src/film-service-client.ts");
  let requests = 0;
  const client = new FilmServiceClient({ api: "http://127.0.0.1:8787", token: "test-only-token", fetchImpl: async (_url: unknown, init: RequestInit) => {
    requests++;
    const input = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ result: { data: { projectId: input.projectId, jobId: "FJ-test", attempt: 1, runId: "film-test", status: "running",
      stages: input.stages, inputSha256: hash, workerEntrySha256: hash, budgetCny: 20, startedAt: "2026-10-05T00:00:00.000Z" } } }));
  } });
  await assert.rejects(() => client.start({ projectId: "P1", workerName: "full-chain-film", sourceVersion, stages: ["videos"],
    document: { shots: [{ shotId: "S1", duration: 10, prompt: "Caller storyboard" }] } }), /CALLER_SOURCE_FORBIDDEN/);
  assert.equal(requests, 0);
});

test("public server rejects caller source before database and provider work", async () => {
  const { startFilmJob } = await moduleAt("apps/server/src/video/film-worker.ts");
  await assert.rejects(() => startFilmJob({ scope: { tenantId: "t", workspaceId: "w" }, actor: "test", projectId: "P1",
    document: { shots: [{ shotId: "S1", duration: 10, prompt: "Caller storyboard" }] }, stages: ["videos"] }), /CALLER_SOURCE_FORBIDDEN/);
});

test("public CLI refuses local shotlists and partial production instead of dispatching providers", async () => {
  for (const args of [["--shots", "caller.json", "--project", "P1"], ["--project", "P1", "--stages", "videos,deliver"], ["--project", "P1", "--assembly-mode", "post-only"]]) {
    const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/tools/full-chain-film.mts", ...args],
      { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME }, timeout: 20_000 });
    assert.equal(run.status, 2, `${args.join(" ")}: ${run.stderr}`);
    assert.match(run.stderr, /CALLER_SOURCE_FORBIDDEN|PIPELINE_INCOMPLETE/);
  }
});

test("native stage contract rejects omitted postproduction and render retry options", async () => {
  const { NATIVE_FILM_STAGES, normalizeNativeFilmJobRequest } = await moduleAt("packages/video-studio/src/native-film-source.ts");
  for (const omitted of NATIVE_FILM_STAGES) assert.throws(() => normalizeNativeFilmJobRequest(NATIVE_FILM_STAGES.filter((stage: string) => stage !== omitted), {}), /PIPELINE_INCOMPLETE/);
  for (const options of [{ only: "S1" }, { "max-attempts": 2 }, { "assembly-mode": "post-only" }, { "no-danmaku": true }]) {
    assert.throws(() => normalizeNativeFilmJobRequest(undefined, options), /BYPASS_FORBIDDEN|RETRY_FORBIDDEN/);
  }
  assert.deepEqual(normalizeNativeFilmJobRequest(undefined, {}).stages, NATIVE_FILM_STAGES);
});

test("preproduction metadata cannot inject generated artifacts or asserted facts", async () => {
  const { assertCustomerVideoMetadata } = await moduleAt("apps/server/src/video/native-video-assets.ts");
  for (const key of ["shots", "storyboard", "script", "promptPack", "document", "verifiedRaw", "_dataDossier"]) {
    for (const input of [{ [key]: [] }, { brief: { [key]: [] } }]) assert.throws(() => assertCustomerVideoMetadata(input), /CALLER_SOURCE_FORBIDDEN/);
  }
  assert.doesNotThrow(() => assertCustomerVideoMetadata({ characterId: "demo-character", productId: "demo-t001" }));
});

test("native preproduction request has intent and archive identities without caller shots", async () => {
  const { FilmServiceClient } = await moduleAt("packages/video-studio/src/film-service-client.ts");
  let captured: Record<string, unknown> | undefined;
  const client = new FilmServiceClient({ api: "http://127.0.0.1:8787", token: "test-only-token", fetchImpl: async (_url: unknown, init: RequestInit) => {
    captured = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ result: { data: { kind: "routed", projectId: "P1", runId: "R1", pipeline: "marketing" } } }));
  } });
  await client.prepare({ intent: "30秒宣传片", characterId: "demo-character", productId: "demo-t001", route: "marketing" });
  assert.deepEqual(captured, { intent: "30秒宣传片", metadata: { characterId: "demo-character", productId: "demo-t001" }, route: "marketing" });
  await assert.rejects(() => client.prepare({ intent: "客户需求", shots: [] }), /CALLER_SOURCE_FORBIDDEN/);
});

test("ledger source identity stays on the parent while the real full-chain worker accepts the complete job", async () => {
  const { filmWorkerJobOptions } = await moduleAt("apps/server/src/video/film-worker.ts");
  const { normalizeNativeFilmJobRequest } = await moduleAt("packages/video-studio/src/native-film-source.ts");
  const { FullChainFilmWorker } = await moduleAt("packages/video-studio/src/film-worker-runtime.ts");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "native-film-handoff-")));
  try {
    const archiveRoot = join(dir, "archive"), workDir = join(archiveRoot, "stages", "film", "attempt-1");
    mkdirSync(workDir, { recursive: true });
    const source = JSON.stringify({ shots: [{ shotId: "S1", duration: 6, prompt: "native test source" }] });
    writeFileSync(join(archiveRoot, "source.json"), source);
    const native = normalizeNativeFilmJobRequest(undefined, { aspect: "16:9", "review-policy": "off" });
    const job = { options: { ...native.options, nativeSourceKey: "source-run:prompt-hash:film-hash" } };
    let networkCalls = 0;
    const worker = new FullChainFilmWorker({ jobId: "FJ-handoff-test", tenantId: "t", workspaceId: "w", projectId: "P-test", attempt: 1,
      runId: "film-test", workerName: "full-chain-film", workerVersion: "test", stages: native.stages,
      options: filmWorkerJobOptions(job), inputRef: "source.json", inputSha256: createHash("sha256").update(source).digest("hex"),
      archiveRoot, workDir, allowedMethods: ["video.generate"], budgetCny: 50, deadlineAt: new Date(Date.now() + 60_000).toISOString() },
    dir, { subscribe: () => () => {}, send: () => { networkCalls++; throw new Error("Unexpected paid request"); } });
    assert.equal(readFileSync(worker.inputPath, "utf8"), source);
    assert.equal(job.options.nativeSourceKey, "source-run:prompt-hash:film-hash");
    assert.deepEqual(worker.context.options, native.options);
    assert.equal(networkCalls, 0);
    worker.channel.dispose();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
