/** Actual auth middleware, route contracts, image bytes and scoped path validation. DB/tool boundaries are fixtures. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Identity } from "@workloom/base/tenancy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), download: vi.fn(), authority: vi.fn() }));
vi.mock("../../service/access-authority.js", async original => ({
  ...await original<typeof import("../../service/access-authority.js")>(), currentMemberAuthority: mocks.authority,
}));
vi.mock("@workloom/db", async original => ({ ...await original<typeof import("@workloom/db")>(), getAppPool: () => ({}), getGatewayPool: () => ({}) }));
vi.mock("../gen/db.js", () => ({ scopedQuery: mocks.query }));
vi.mock("../gen/ingest.js", async original => ({ ...await original<typeof import("../gen/ingest.js")>(), downloadToMediaStore: mocks.download }));
vi.mock("./engine.js", async original => ({ ...await original<typeof import("./engine.js")>(),
  runLineartTool: async () => ({ ok: true, checks: [{ id: "fixture", pass: true, detail: "mocked pixel tool" }], metrics: {} }),
}));
import { whiteboardRouter } from "./router.js";
import { lineartSha256 } from "./imagegen-contract.js";

const owner: Identity = { kind: "member", memberId: "owner", memberNo: "MEM-OWNER", name: "Owner", role: "owner", plan: "pro", tenantId: "tenant-router", workspaceId: "ws-router" };
const caller = (identity: Identity | null = owner) => whiteboardRouter.createCaller({ identity, session: identity, partnerIdentity: null, headers: new Headers() });
const bytes = readFileSync(resolve(import.meta.dirname, "../../../../../vendor/srt-whiteboard/examples/scene-01-monkey-mountain-banana.png"));
const hash = lineartSha256(bytes);
const continuity = { references: [{ id: "master", role: "style" as const, description: "fixed master", sha256: hash }], lockedElements: [] };
let root: string, source: string;
let scene: Record<string, unknown>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wb-router-"));
  vi.stubEnv("WHITEBOARD_JOBS_DIR", join(root, "jobs"));
  vi.stubEnv("WORKLOOM_MEDIA_DIR", join(root, "media"));
  vi.stubEnv("MEDIA_SIGNING_SECRET", "whiteboard-router-fixture-secret-for-tests");
  mkdirSync(join(root, "jobs/film-VP-ONE/inputs"), { recursive: true });
  source = join(root, "jobs/film-VP-ONE/inputs/master.png"); writeFileSync(source, bytes);
  scene = { id: "scene-one", scene_no: 1, core_idea: "compare", subtitle_srt: "1\n00:00:00,000 --> 00:00:05,000\n比较结果。\n", cue_start_ms: 0, cue_end_ms: 5000, duration_ms: 5000, lineart_path: null, lineart_check: {} };
  mocks.authority.mockReset().mockImplementation(async identity => ({ identity, permissions: {} }));
  mocks.download.mockReset().mockResolvedValue({ relPath: "video/ws-router/actual.png", sha256: hash });
  mocks.query.mockReset().mockImplementation(async (_pool, scope, sql, params) => {
    if (scope.workspaceId !== owner.workspaceId || scope.tenantId !== owner.tenantId) return [];
    expect(params[0]).toBe(owner.workspaceId);
    if (sql.includes("FROM whiteboard_films")) return [{ id: "WF-ONE", project_id: "VP-ONE", lineart_mode: "upload" }];
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
