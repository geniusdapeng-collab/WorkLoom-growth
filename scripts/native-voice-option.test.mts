/** MC-022: public narration options must reach the existing renderer switch without provider IO. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { FilmChannelTransport, FilmWorkerJobContext } from "../packages/video-studio/src/film-worker-channel.js";

const root = resolve(process.env.WORKLOOM_ASSERTION_MODULE_ROOT ?? new URL("../", import.meta.url).pathname);
const moduleAt = (file: string) => import(pathToFileURL(resolve(root, file)).href);
const { FullChainFilmWorker, normalizeFilmJobRequest } = await moduleAt("packages/video-studio/src/film-worker-runtime.ts");
const { normalizeNativeFilmJobRequest, NATIVE_FILM_STAGES } = await moduleAt("packages/video-studio/src/native-film-source.ts");
const { runFilmServiceCli } = await moduleAt("scripts/tools/film-service-entry.mts");
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

function fixture(options: Record<string, unknown>, stages: string[] = ["voice"]) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "native-voice-option-")));
  const archiveRoot = join(dir, "archive"), workDir = join(archiveRoot, "stages", "film", "attempt-1");
  mkdirSync(workDir, { recursive: true });
  const source = JSON.stringify({ shots: [{ shotId: "S1", duration: 6, dialogue: [{ speaker: "CEO", text: "入住更方便。" }] }] });
  writeFileSync(join(archiveRoot, "source.json"), source);
  const context: FilmWorkerJobContext = {
    jobId: "FJ-voice-option-test", tenantId: "t", workspaceId: "w", projectId: "P-voice-option", attempt: 1,
    runId: "film-voice-option-test", workerName: "full-chain-film", workerVersion: "test", stages,
    options, inputRef: "source.json", inputSha256: hash(source), archiveRoot, workDir,
    allowedMethods: ["voice.dub"], budgetCny: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  };
  let sent = 0, subscriptions = 0;
  const transport: FilmChannelTransport = {
    send() { sent++; throw new Error("Unexpected provider request during option handoff"); },
    subscribe() { subscriptions++; return () => { subscriptions--; }; },
  };
  let worker: InstanceType<typeof FullChainFilmWorker> | undefined;
  return {
    context,
    create() { worker = new FullChainFilmWorker(context, root, transport); return worker; },
    close() {
      worker?.channel.dispose();
      rmSync(dir, { recursive: true, force: true });
      assert.equal(sent, 0, "constructing argv must not send a component request");
      assert.equal(subscriptions, 0, "test channels must be disposed");
    },
  };
}

function rendererNarrationFlag(): string {
  const source = readFileSync(resolve(root, "scripts/tools/full-chain-film.mts"), "utf8");
  const declaration = /const UNIFIED_NARRATION = flag\(("[^"]+")\);/.exec(source);
  assert.ok(declaration, "the existing renderer must declare its narration switch");
  assert.match(source, /const flag = \(name: string\) => process\.argv\.includes\(name\);/);
  assert.match(source, /if \(before\.ok && !UNIFIED_NARRATION\)/, "the switch controls retaining clip narration");
  const flag = JSON.parse(declaration[1]!);
  assert.equal(flag, "--narration-unified", "the renderer contract does not add a public alias");
  return flag;
}

test("true public and camelCase options keep the public contract and enable the renderer's actual narration switch", () => {
  const consumedFlag = rendererNarrationFlag();
  for (const options of [{ "unified-narration": true }, { unifiedNarration: true }]) {
    const native = normalizeNativeFilmJobRequest(undefined, options);
    assert.deepEqual(native.options, { "unified-narration": true, "max-attempts": "1" });
    assert.deepEqual(native.stages, [...NATIVE_FILM_STAGES]);
    const frozen = structuredClone(native.options), job = fixture(native.options, native.stages);
    try {
      const worker = job.create();
      assert.equal(worker.args.filter((arg: string) => arg === consumedFlag).length, 1);
      assert.ok(!worker.args.includes("--unified-narration"));
      assert.deepEqual(worker.context.options, frozen);
      assert.equal(hash(readFileSync(worker.inputPath, "utf8")), worker.context.inputSha256);
    } finally { job.close(); }
  }
});

test("false and absent unified narration do not emit either switch", () => {
  for (const options of [{ "unified-narration": false }, { unifiedNarration: false }, {}]) {
    const job = fixture(options);
    try {
      const worker = job.create();
      assert.ok(!worker.args.includes("--narration-unified"));
      assert.ok(!worker.args.includes("--unified-narration"));
      assert.deepEqual(worker.context.options, options);
    } finally { job.close(); }
  }
});

test("other boolean and value options retain their existing argv and false omission", () => {
  const flags = ["no-resume", "no-danmaku", "no-open-with-cover", "no-cover-kb", "prompt-english-gloss", "material-post-only", "material-speed-ramp", "bgm-declared-program-mix"];
  for (const enabled of [true, false]) {
    const options = { ...Object.fromEntries(flags.map(key => [key, enabled])), "unified-narration": true,
      "narration-profile": "zh-xiaozhi", aspect: "16:9", fps: 24, "review-policy": "off" };
    const normalized = normalizeFilmJobRequest(["voice"], options), job = fixture(options);
    try {
      const worker = job.create();
      assert.deepEqual(worker.args.slice(10), [
        ...(enabled ? flags.map(key => `--${key}`) : []), "--narration-unified",
        "--narration-profile", "zh-xiaozhi", "--aspect", "16:9", "--fps", "24", "--review-policy", "off",
      ]);
      assert.equal(normalized.options["unified-narration"], true);
      assert.equal(normalized.options.fps, "24");
    } finally { job.close(); }
  }
});

test("invalid narration values, internal aliases and duplicate spellings fail before channel subscription", () => {
  for (const key of ["unified-narration", "unifiedNarration"]) {
    for (const value of [undefined, null, "true", "false", "--narration-unified", 0, 1, [], {}, "\n"]) {
      const job = fixture({ [key]: value });
      try {
        assert.throws(() => job.create(), (error: { code?: string }) => error.code === "OPTION_INVALID");
      } finally { job.close(); }
    }
  }
  for (const options of [{ "narration-unified": true }, { narrationUnified: true }, { "unified-narration": true, unifiedNarration: false }]) {
    const job = fixture(options);
    try {
      assert.throws(() => job.create(), (error: { code?: string }) => ["OPTION_INVALID", "OPTION_NOT_ALLOWED"].includes(error.code ?? ""));
    } finally { job.close(); }
  }
});

test("the real public CLI submits the canonical option and its complete job reaches the renderer switch", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; input: Record<string, any> }> = [];
  const sourceVersion = { sourceStageRunId: "R-voice-option", promptsSha256: "a".repeat(64), filmSourceSha256: "b".repeat(64) };
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    assert.equal(target.origin, "https://voice-option.example.invalid");
    const input = JSON.parse(String(init?.body ?? target.searchParams.get("input")));
    requests.push({ url: target, input });
    if (target.pathname === "/trpc/video.film.plan") return new Response(JSON.stringify({ result: { data: {
      projectId: "P-voice-option", pipelineKind: "marketing", sourceVersion, sourceAttempt: 1,
      shots: [{ shotId: "S1", durationSec: 6, promptSha256: "c".repeat(64) }], stages: [...NATIVE_FILM_STAGES],
      totalSeconds: 6, estimatedReserveCny: 1, humanAcceptance: "final-film-only",
    } } }));
    assert.equal(target.pathname, "/trpc/video.film.start");
    return new Response(JSON.stringify({ result: { data: {
      projectId: input.projectId, jobId: "FJ-voice-option", attempt: 1, runId: "film-voice-option", status: "running",
      stages: input.stages, inputSha256: "d".repeat(64), workerEntrySha256: "e".repeat(64), budgetCny: 1,
      startedAt: "2026-10-05T00:00:00.000Z",
    } } }));
  };
  try {
    const code = await runFilmServiceCli(["--project", "P-voice-option", "--unified-narration", "--narration-profile", "zh-xiaozhi", "--no-wait"],
      { WORKLOOM_API: "https://voice-option.example.invalid", WORKLOOM_TOKEN: "voice-option-test-only" });
    assert.equal(code, 3);
    assert.equal(requests.length, 2);
    const submitted = requests[1]!.input;
    assert.deepEqual(submitted.options, { "unified-narration": true, "narration-profile": "zh-xiaozhi", "max-attempts": "1" });
    assert.deepEqual(submitted.sourceVersion, sourceVersion);
    const job = fixture(submitted.options, submitted.stages);
    try { assert.ok(job.create().args.includes(rendererNarrationFlag())); }
    finally { job.close(); }
    await assert.rejects(() => runFilmServiceCli(["--project", "P-voice-option", "--narration-unified"], {}), /FILM_CLI_ARGUMENT_INVALID/);
    await assert.rejects(() => runFilmServiceCli(["--project", "P-voice-option", "--unified-narration", "--unified-narration"], {}), /FILM_CLI_ARGUMENT_INVALID/);
    assert.equal(requests.length, 2, "invalid public options must not dispatch service requests");
  } finally { globalThis.fetch = originalFetch; }
});
