/** Actual auth middleware, route contracts, image bytes and scoped path validation. DB/tool boundaries are fixtures. */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Identity } from "@workloom/base/tenancy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), download: vi.fn(), authority: vi.fn(), synthesize: vi.fn(), submit: vi.fn() }));
vi.mock("../../service/access-authority.js", async original => ({
  ...await original<typeof import("../../service/access-authority.js")>(), currentMemberAuthority: mocks.authority,
}));
vi.mock("@workloom/db", async original => ({ ...await original<typeof import("@workloom/db")>(),
  getAppPool: () => ({ connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }) }), getGatewayPool: () => ({}) }));
vi.mock("../gen/db.js", () => ({ scopedQuery: mocks.query }));
vi.mock("../gen/ingest.js", async original => ({ ...await original<typeof import("../gen/ingest.js")>(), downloadToMediaStore: mocks.download }));
vi.mock("./engine.js", async original => ({ ...await original<typeof import("./engine.js")>(),
  runLineartTool: async () => ({ ok: true, checks: [{ id: "fixture", pass: true, detail: "mocked pixel tool" }], metrics: {} }),
}));
vi.mock("./narration.js", async original => ({ ...await original<typeof import("./narration.js")>(), synthesizeNarration: mocks.synthesize }));
vi.mock("../gen/submit.js", () => ({ submitGenJob: mocks.submit }));
import { whiteboardRouter } from "./router.js";
import { lineartSha256 } from "./imagegen-contract.js";
import { submissionRequestHash } from "../gen/submission-ledger.js";
import { buildSceneLineart } from "./lineart.js";

const owner: Identity = { kind: "member", memberId: "owner", memberNo: "MEM-OWNER", name: "Owner", role: "owner", plan: "pro", tenantId: "tenant-router", workspaceId: "ws-router" };
const caller = (identity: Identity | null = owner) => whiteboardRouter.createCaller({ identity, session: identity, partnerIdentity: null, headers: new Headers() });
const bytes = readFileSync(resolve(import.meta.dirname, "../../../../../vendor/srt-whiteboard/examples/scene-01-monkey-mountain-banana.png"));
const hash = lineartSha256(bytes);
const continuity = { references: [{ id: "master", role: "style" as const, description: "fixed master", sha256: hash }], lockedElements: [] };
let root: string, source: string;
let scene: Record<string, unknown>;
let filmProfile: string | null;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wb-router-"));
  vi.stubEnv("WHITEBOARD_JOBS_DIR", join(root, "jobs"));
  vi.stubEnv("WORKLOOM_MEDIA_DIR", join(root, "media"));
  vi.stubEnv("MEDIA_SIGNING_SECRET", "whiteboard-router-fixture-secret-for-tests");
  mkdirSync(join(root, "jobs/film-VP-ONE/inputs"), { recursive: true });
  source = join(root, "jobs/film-VP-ONE/inputs/master.png"); writeFileSync(source, bytes);
  scene = { id: "scene-one", scene_no: 1, core_idea: "compare", subtitle_srt: "1\n00:00:00,000 --> 00:00:05,000\n比较结果。\n", cue_start_ms: 0, cue_end_ms: 5000, duration_ms: 5000, lineart_path: null, lineart_check: {} };
  filmProfile = "film-specific-voice";
  mocks.synthesize.mockReset().mockImplementation(async input => ({ wavPath: source, profile: input.env.WHITEBOARD_NARRATION_PROFILE,
    srt: "fixture-srt", segments: [{}], reusedSegments: 0 }));
  mocks.authority.mockReset().mockImplementation(async identity => ({ identity, permissions: {} }));
  mocks.download.mockReset().mockResolvedValue({ relPath: "video/ws-router/actual.png", sha256: hash });
  mocks.query.mockReset().mockImplementation(async (_pool, scope, sql, params) => {
    if (scope.workspaceId !== owner.workspaceId || scope.tenantId !== owner.tenantId) return [];
    expect(params[0]).toBe(owner.workspaceId);
    if (sql.includes("FROM whiteboard_films")) return [{ id: "WF-ONE", project_id: "VP-ONE", lineart_mode: "upload", render_fps: 30, cap_long_edge: 1280, script_md: "这是配音测试原文。", narration_profile: filmProfile }];
    if (sql.includes("FROM whiteboard_scenes")) return [scene];
    return [];
  });
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
async function request() {
  const plan = await caller().lineartPlan({ filmId: "WF-ONE", continuity });
  return { filmId: "WF-ONE", sceneNo: 1, mode: "imagegen" as const, sourcePath: source, continuity,
    referencePaths: [{ id: "master", path: source }],
    imagegenReceipt: { schemaVersion: "workloom.whiteboard-imagegen-receipt/v1" as const,
      planHash: plan.planHash, sceneHash: plan.scenes[0]!.sceneHash, imageSha256: hash, referencedHashes: [hash],
      visualReview: { status: "passed" as const, reviewer: "fixture", note: "test declaration, no live provider claim" } } };
}
describe("whiteboard imagegen route boundaries", () => {
  it("concurrent approved images for one scene keep each byte set paired with its own receipt", async () => {
    const input = await request();
    const changed = join(root, "jobs/film-VP-ONE/inputs/another.png");
    const otherBytes = Buffer.concat([bytes, Buffer.from("different approved file bytes")]); writeFileSync(changed, otherBytes);
    const base = { workspaceId: owner.workspaceId, sceneNo: 1, jobDir: join(root, "jobs/film-VP-ONE"), coreIdea: "compare", elements: [], mode: "imagegen" as const };
    const receipts = [input.imagegenReceipt, { ...input.imagegenReceipt, imageSha256: lineartSha256(otherBytes) }];
    const results = await Promise.all([source, changed].map((path, i) => buildSceneLineart({ ...base, sourcePath: path, imagegenReceipt: receipts[i]! })));
    expect(results[0]!.absPath).not.toBe(results[1]!.absPath);
    for (const [i, result] of results.entries()) {
      expect(result.sha256).toBe(receipts[i]!.imageSha256);
      expect(lineartSha256(readFileSync(result.absPath))).toBe(receipts[i]!.imageSha256);
      expect(result.check).toMatchObject({ provenance: { imageSha256: receipts[i]!.imageSha256 } });
    }
    writeFileSync(results[0]!.absPath, "tampered original");
    await expect(buildSceneLineart({ ...base, sourcePath: source, imagegenReceipt: receipts[0]! })).rejects.toThrow("不覆盖");
    expect(readFileSync(results[0]!.absPath, "utf8")).toBe("tampered original");
  });
  it("a real PG row's timestamp metadata cannot invalidate the exact approved render script JSON", async () => {
    vi.stubEnv("WHITEBOARD_ENABLED", "1");
    const previous = mocks.query.getMockImplementation()!;
    const script = { id: "SCRIPT-7", project_id: "VP-ONE", shot_id: "WHITEBOARD", script_key: "whiteboard-VP-ONE",
      version: 7, status: "approved", md: "exact approved body", fields: { engine: "whiteboard-local", durationMs: 5000 } };
    mocks.query.mockImplementation(async (...args) => {
      if (args[2].includes("SELECT s.* FROM render_scripts")) return [{ ...script, created_at: new Date(), approved_event_id: "EVENT-7" }];
      if (args[2].includes("SELECT status FROM render_scripts")) return [{ status: "approved" }];
      return previous(...args);
    });
    const cached = join(root, "media/video/ws-router/cached.png"); mkdirSync(join(root, "media/video/ws-router"), { recursive: true }); writeFileSync(cached, bytes);
    Object.assign(scene, { lineart_path: "video/ws-router/cached.png", annotation: { elements: [{}] } });
    mocks.submit.mockReset().mockResolvedValue({ jobId: "JOB-7", taskId: "fixture-task", provider: "whiteboard-local" });
    // Readiness is the external Python prerequisite, not the subject of this route regression.
    const { whiteboardEnv } = await import("./engine.js");
    const python = whiteboardEnv().python;
    if (!existsSync(python)) vi.stubEnv("WHITEBOARD_PYTHON", process.execPath);
    await caller().render({ filmId: "WF-ONE" });
    const request = mocks.submit.mock.calls[0]![0];
    expect(request.script).toEqual(script);
    expect(() => submissionRequestHash({ script: request.script, params: request.params })).not.toThrow();
  });
  it.each(["film-specific-voice", null])("dispatch, synthesis and saved receipt use film voice %s before host default", async profile => {
    vi.stubEnv("WHITEBOARD_NARRATION_PROFILE", "host-default-voice"); filmProfile = profile;
    const chosen = profile || "host-default-voice";
    expect(await caller().narrate({ filmId: "WF-ONE", verify: false })).toMatchObject({ profile: chosen });
    await vi.waitFor(() => expect(mocks.query.mock.calls.some(call => call[2].includes("SET narration_path"))).toBe(true));
    expect(mocks.synthesize.mock.calls[0]![0].env.WHITEBOARD_NARRATION_PROFILE).toBe(chosen);
    const saved = mocks.query.mock.calls.find(call => call[2].includes("SET narration_path"));
    expect(saved?.[3][3]).toBe(chosen);
  });
  it("plan is read-only; import preserves original upload storage and explicit unverified model provenance", async () => {
    const input = await request();
    expect(mocks.query.mock.calls.every(call => call[2].startsWith("SELECT"))).toBe(true);
    const result = await caller().lineart(input);
    expect(result.results[0], JSON.stringify(result.results)).toMatchObject({ ok: true, source: "upload", generator: "codex-imagegen", sha256: hash });
    expect(result.results[0]!.check).toMatchObject({ provenance: { modelIdentityVerified: false, imageSha256: hash } });
    const update = mocks.query.mock.calls.find(call => call[2].includes("UPDATE whiteboard_scenes"));
    expect(update?.[3][4]).toBe("upload");
    expect(JSON.parse(update?.[3][6]).provenance.planHash).toBe(input.imagegenReceipt.planHash);
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it("unauthenticated access and readonly imports are rejected by real middleware", async () => {
    await expect(caller(null).lineartPlan({ filmId: "WF-ONE" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller({ ...owner, role: "readonly" }).lineart(await request())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it.each([{ workspaceId: "other" }, { tenantId: "other" }])("authenticated scope isolates %j", async changed => {
    await expect(caller({ ...owner, ...changed }).lineartPlan({ filmId: "WF-ONE" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller({ ...owner, ...changed }).lineart(await request())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("old scene hash and missing master paths fail before bytes enter media storage", async () => {
    const input = await request(); scene.core_idea = "changed";
    await expect(caller().lineart(input)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller().lineart({ ...await request(), referencePaths: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it.each(["foreign-workspace", "traversal", "outside", "symlink"])("%s sources cannot escape this film/workspace", async scenario => {
    const input = await request();
    const other = join(root, "other.png"); writeFileSync(other, bytes);
    if (scenario === "foreign-workspace") input.sourcePath = "video/other/image.png";
    if (scenario === "traversal") input.sourcePath = "video/ws-router/../image.png";
    if (scenario === "outside") input.sourcePath = other;
    if (scenario === "symlink") { const link = join(root, "jobs/film-VP-ONE/inputs/link.png"); symlinkSync(other, link); input.sourcePath = link; }
    await expect(caller().lineart(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("image bytes changed after plan validation are rejected without storage or Seedream generation", async () => {
    const input = await request();
    const changed = join(root, "jobs/film-VP-ONE/inputs/changed.png"); writeFileSync(changed, Buffer.concat([bytes, Buffer.from("changed")]));
    const result = await caller().lineart({ ...input, sourcePath: changed });
    expect(result.results[0]).toMatchObject({ ok: false });
    expect(result.results[0]!.error).toContain("字节已变化");
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("existing byte-bound image is reused; deleted or tampered asset stops instead of re-generating", async () => {
    const path = join(root, "media/video/ws-router/cached.png"); mkdirSync(join(root, "media/video/ws-router"), { recursive: true }); writeFileSync(path, bytes);
    Object.assign(scene, { lineart_path: "video/ws-router/cached.png", lineart_source: "upload", lineart_check: { provenance: { imageSha256: hash, generator: "codex-imagegen" } } });
    expect((await caller().lineart({ filmId: "WF-ONE", sceneNo: 1 })).results[0]).toMatchObject({ skipped: true, sha256: hash });
    writeFileSync(path, Buffer.concat([bytes, Buffer.from("tampered")]));
    await expect(caller().lineart({ filmId: "WF-ONE", sceneNo: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    rmSync(path);
    await expect(caller().lineart({ filmId: "WF-ONE", sceneNo: 1 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
