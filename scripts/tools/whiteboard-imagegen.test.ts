import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { buildImagegenPlan, ContinuitySchema, lineartSha256 } from "../../apps/server/src/video/whiteboard/imagegen-contract.js";
import { checkedWhiteboardResult, readContinuityContract, runImagegenLineart, selectLineartMode,
  type WhiteboardCall } from "./whiteboard-imagegen.mts";

const dirs: string[] = [];
const root = resolve(import.meta.dirname, "../..");
const bytes = readFileSync(join(root, "vendor/srt-whiteboard/examples/scene-01-monkey-mountain-banana.png"));
const hash = lineartSha256(bytes);
const review = { status: "passed" as const, reviewer: "test-fixture", note: "模拟接口的测试资料，不代表真实生图/视觉验收" };
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup(existing: number[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "whiteboard 中文 空格-")); dirs.push(dir);
  vi.stubEnv("WHITEBOARD_JOBS_DIR", join(dir, "jobs"));
  const image = join(dir, "scene 原图.png"); writeFileSync(image, bytes);
  const contract = join(dir, "continuity.json");
  writeFileSync(contract, JSON.stringify({ schemaVersion: "workloom.whiteboard-continuity/v1",
    references: [{ id: "master", role: "style", description: "固定原图风格和核心元素", path: "scene 原图.png", sha256: hash }],
    lockedElements: [{ id: "core", referenceId: "master", description: "主体不重新设计" }] }));
  const scenes = [1, 2].map(n => ({ id: `scene-${n}`, scene_no: n, core_idea: `第${n}幕`,
    subtitle_srt: `${n}\n00:00:00,000 --> 00:00:10,000\n第${n}幕比较结果。\n`,
    cue_start_ms: (n - 1) * 10000, cue_end_ms: n * 10000, duration_ms: 10000,
    lineart_path: existing.includes(n) ? `video/ws-test/cached-${n}.png` : null }));
  const build = (continuity = readContinuityContract(contract).continuity) => ({ ...buildImagegenPlan({
    workspaceId: "ws-test", filmId: "WF-TEST", projectId: "VP-TEST", scenes, continuity }),
    inputDirectory: join(dir, "jobs/film-VP-TEST/inputs") });
  const plan = build();
  const manifest = join(dir, "results.json");
  const result = { schemaVersion: "workloom.whiteboard-imagegen-results/v1", planHash: plan.planHash,
    scenes: plan.scenes.map(scene => ({ sceneNo: scene.sceneNo, sceneHash: scene.sceneHash,
      path: "scene 原图.png", imageSha256: hash, referencedHashes: [hash], visualReview: structuredClone(review) })) };
  writeFileSync(manifest, JSON.stringify(result));
  const calls: Array<{ path: string; body: any }> = [];
  const call: WhiteboardCall = async <T>(path: string, body: unknown): Promise<T> => {
    calls.push({ path, body });
    if (path === "video.whiteboard.lineartPlan") return build((body as any).continuity) as T;
    const n = (body as any).sceneNo;
    return { results: [{ sceneNo: n, ok: true, skipped: existing.includes(n),
      path: `video/ws-test/result-${n}.png`, sha256: hash, check: { ok: true, checks: [{ pass: true }] } }] } as T;
  };
  return { dir, contract, image, manifest, calls, call, plan, result,
    options: { filmId: "WF-TEST", call, contractPath: contract, planPath: join(dir, "plan.json") } };
}

describe("imagegen 白板编排", () => {
  it.each([0, -1, 1.5, NaN, Infinity])("非法幕号 %s 不会变为整片出图或付费备选", async sceneNo => {
    const f = setup();
    await expect(runImagegenLineart({ ...f.options, sceneNo,
      unavailable: { reason: "unsupported-client", detail: "fixture unavailable tool" } })).rejects.toThrow("正整数");
    expect(f.calls).toEqual([]);
  });
  it("无产物是 pending，保存逐幕计划但不写入服务端，也不触发 Seedream", async () => {
    const f = setup();
    const out = await runImagegenLineart(f.options);
    expect(out.status).toBe("pending");
    expect(f.calls.map(call => call.path)).toEqual(["video.whiteboard.lineartPlan"]);
    const saved = JSON.parse(readFileSync(out.planPath, "utf8"));
    expect(saved.localReferences[0].path).toBe(f.image);
    expect(saved.selection.selected).toBe("imagegen");
  });
  it("真实文件摘要与计划匹配后逐幕导入；特殊路径被复制到本片目录", async () => {
    const f = setup();
    const out = await runImagegenLineart({ ...f.options, resultsPath: f.manifest });
    expect(out.status).toBe("completed");
    const writes = f.calls.filter(call => call.path === "video.whiteboard.lineart");
    expect(writes).toHaveLength(2);
    for (const call of writes) {
      expect(call.body.mode).toBe("imagegen");
      expect(call.body.imagegenUnavailable).toBeUndefined();
      expect(call.body.imagegenReceipt.visualReview).toEqual(review);
      expect(lineartSha256(readFileSync(call.body.sourcePath))).toBe(hash);
      expect(call.body.sourcePath).toContain("film-VP-TEST/inputs/");
      expect(call.body.referencePaths[0].path).toBe(call.body.sourcePath);
    }
  });
  it("部分结果可 --scene 逐幕导入，其余幕未导入", async () => {
    const f = setup(); f.result.scenes = f.result.scenes.slice(1);
    writeFileSync(f.manifest, JSON.stringify(f.result));
    await runImagegenLineart({ ...f.options, resultsPath: f.manifest, sceneNo: 2 });
    expect(f.calls.filter(call => call.path === "video.whiteboard.lineart").map(call => call.body.sceneNo)).toEqual([2]);
  });
  it.each(["missing", "duplicate", "foreign", "stale", "changed-image", "unreviewed"])("%s 的批次先拒绝，不导入一半或启用备选", async scenario => {
    const f = setup();
    if (scenario === "missing") f.result.scenes = f.result.scenes.slice(0, 1);
    if (scenario === "duplicate") f.result.scenes.push(f.result.scenes[0]!);
    if (scenario === "foreign") f.result.scenes[1]!.sceneNo = 99;
    if (scenario === "stale") f.result.planHash = "f".repeat(64);
    if (scenario === "changed-image") f.result.scenes[1]!.imageSha256 = "f".repeat(64);
    if (scenario === "unreviewed") Object.assign(f.result.scenes[1]!.visualReview, { status: "unverified" });
    writeFileSync(f.manifest, JSON.stringify(f.result));
    await expect(runImagegenLineart({ ...f.options, resultsPath: f.manifest })).rejects.toThrow();
    expect(f.calls.filter(call => call.path === "video.whiteboard.lineart")).toHaveLength(0);
  });
  it("坏图、空文件和参考摘要变化在模型/导入调用前拒绝", () => {
    const f = setup();
    writeFileSync(f.image, "not an image");
    expect(() => readContinuityContract(f.contract)).toThrow("PNG/JPEG");
    writeFileSync(f.image, Buffer.alloc(0));
    expect(() => readContinuityContract(f.contract)).toThrow();
    writeFileSync(f.image, bytes);
    const source = JSON.parse(readFileSync(f.contract, "utf8")); source.references[0].sha256 = "b".repeat(64);
    writeFileSync(f.contract, JSON.stringify(source));
    expect(() => readContinuityContract(f.contract)).toThrow("摘要变化");
  });
  it("返回其它目录的服务不能导致客户端任意写文件", async () => {
    const f = setup();
    const call: WhiteboardCall = async <T>(path: string, body: unknown) => {
      const value = await f.call<any>(path, body);
      return (path.endsWith("lineartPlan") ? { ...value, inputDirectory: join(f.dir, "foreign-directory") } : value) as T;
    };
    await expect(runImagegenLineart({ ...f.options, call, resultsPath: f.manifest })).rejects.toThrow("本机当前项目");
    expect(f.calls.filter(call => call.path === "video.whiteboard.lineart")).toHaveLength(0);
  });
  it("既有暂存资产摘要不同不覆盖它", async () => {
    const f = setup(); mkdirSync(f.plan.inputDirectory, { recursive: true });
    const stage = join(f.plan.inputDirectory, `${hash}.png`); writeFileSync(stage, "preserve this original");
    await expect(runImagegenLineart({ ...f.options, resultsPath: f.manifest })).rejects.toThrow("不覆盖原文件");
    expect(readFileSync(stage, "utf8")).toBe("preserve this original");
  });
  it("原有成功幕复用；缺原始结果文件也不会重出", async () => {
    const f = setup([1, 2]);
    const out = await runImagegenLineart(f.options);
    expect(out.status).toBe("completed");
    expect(f.calls.filter(call => call.path === "video.whiteboard.lineart").every(call => !call.body.mode && !call.body.force)).toBe(true);
  });
  it("明确不支持后使用同一固定参考走 Seedream，原因随请求留痕", async () => {
    const f = setup();
    const unavailable = { reason: "unsupported-client" as const, detail: "本客户端没有内置 image_gen" };
    const out = await runImagegenLineart({ ...f.options, unavailable });
    expect(out.selected).toBe("seedream");
    const writes = f.calls.filter(call => call.path === "video.whiteboard.lineart");
    expect(writes).toHaveLength(2);
    for (const call of writes) {
      expect(call.body.mode).toBe("seedream");
      expect(call.body.imagegenUnavailable).toEqual(unavailable);
      expect(call.body.continuity.references[0].sha256).toBe(hash);
      expect(call.body.imagegenReceipt).toBeUndefined();
    }
  });
  it("无既定参考的 Seedream 后续幕引用首个成功结果", async () => {
    const f = setup();
    await runImagegenLineart({ ...f.options, contractPath: undefined,
      unavailable: { reason: "tool-unavailable", detail: "工具菜单没有生图工具" } });
    const writes = f.calls.filter(call => call.path === "video.whiteboard.lineart");
    expect(writes[0]!.body.continuity.references).toEqual([]);
    expect(writes[1]!.body.referencePaths).toEqual([{ id: "fallback-master", path: "video/ws-test/result-1.png" }]);
  });
  it("备选续跑的后续幕优先复用既有成功首幕，不生成新主参考", async () => {
    const f = setup([1]);
    await runImagegenLineart({ ...f.options, contractPath: undefined, sceneNo: 2,
      unavailable: { reason: "tool-unavailable", detail: "工具菜单没有生图工具" } });
    const writes = f.calls.filter(call => call.path === "video.whiteboard.lineart");
    expect(writes.map(call => call.body.sceneNo)).toEqual([1, 2]);
    expect(writes[0]!.body.mode).toBeUndefined();
    expect(writes[1]!.body.continuity.references[0].sha256).toBe(hash);
  });
  it("导入网络状态不明时停止，不自动生成备用图片", async () => {
    const f = setup();
    const call: WhiteboardCall = async <T>(path: string, body: unknown) => {
      if (path === "video.whiteboard.lineart") { f.calls.push({ path, body }); throw new Error("network outcome unknown"); }
      return f.call<T>(path, body);
    };
    await expect(runImagegenLineart({ ...f.options, call, resultsPath: f.manifest })).rejects.toThrow("unknown");
    const writes = f.calls.filter(call => call.path === "video.whiteboard.lineart");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.body.mode).toBe("imagegen");
  });
  it("同一批次并发暂存复用同名内容文件，不覆盖或变更字节", async () => {
    const f = setup();
    const [one, two] = await Promise.all([
      runImagegenLineart({ ...f.options, resultsPath: f.manifest }),
      runImagegenLineart({ ...f.options, resultsPath: f.manifest }),
    ]);
    expect([one.status, two.status]).toEqual(["completed", "completed"]);
    const sources = f.calls.filter(call => call.body.mode === "imagegen").map(call => call.body.sourcePath);
    expect(new Set(sources).size).toBe(1);
    expect(lineartSha256(readFileSync(sources[0]!))).toBe(hash);
  });
  it("失败响应和风格检查不过不会被 HTTP 成功掩盖", () => {
    expect(() => checkedWhiteboardResult({ results: [{ ok: false, error: "failed" }] })).toThrow("未通过");
    expect(() => checkedWhiteboardResult({ results: [{ ok: true, check: { ok: true, checks: [{ pass: false }] } }] })).toThrow("未通过");
    expect(() => checkedWhiteboardResult(undefined)).toThrow("缺少");
    expect(checkedWhiteboardResult({ results: [{ ok: true }] })).toEqual({ results: [{ ok: true }] });
  });
  it("备选只在 imagegen 优先请求且明确不支持时成立", () => {
    expect(selectLineartMode("imagegen")).toBe("imagegen");
    expect(selectLineartMode("seedream")).toBe("seedream");
    expect(selectLineartMode("imagegen", { reason: "tool-unavailable", detail: "工具不存在" })).toBe("seedream");
    expect(() => selectLineartMode("imagegen", { reason: "timeout" as any, detail: "超时" })).toThrow();
    expect(() => selectLineartMode("seedream", { reason: "tool-unavailable", detail: "工具不存在" })).toThrow();
    expect(() => selectLineartMode("unknown")).toThrow("仅支持");
  });
});

describe("actual whiteboard-film CLI process", () => {
  it.each(["pending", "import", "stage-failed", "invalid-mode", "invalid-scene", "invalid-duration"])("%s has a truthful exit and evidence", async scenario => {
    const f = setup();
    const apiCalls: string[] = [];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, "http://localhost");
      const path = url.pathname.replace("/trpc/", "");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = req.method === "GET" ? JSON.parse(url.searchParams.get("input") || "{}") : JSON.parse(Buffer.concat(chunks).toString() || "{}");
      apiCalls.push(path);
      let data: unknown;
      if (path === "auth.loginAs") data = { token: "test-only-local-cli-session" };
      else if (path === "video.whiteboard.status") data = { film: { project_id: "VP-TEST" } };
      else if (path === "video.whiteboard.lineartPlan") data = { ...f.plan, continuity: body.continuity };
      else if (path === "video.whiteboard.lineart") data = { results: [{ sceneNo: body.sceneNo, ok: scenario !== "stage-failed", path: "video/ws-test/import.png", sha256: hash, error: scenario === "stage-failed" ? "fixture rejected" : undefined }] };
      else { res.writeHead(404); res.end(JSON.stringify({ error: { message: "unexpected request" } })); return; }
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ result: { data } }));
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const address = server.address() as { port: number };
    const evidence = join(f.dir, "cli-evidence.json");
    const args = [join(root, "scripts/tools/whiteboard-film.mts"), "--film", "WF-TEST", "--only", "lineart",
      "--imagegen-contract", f.contract, "--imagegen-plan", join(f.dir, "plan-cli.json"), "--evidence", evidence,
      ...(scenario === "pending" || scenario === "invalid-mode" ? [] : ["--imagegen-results", f.manifest]),
      ...(scenario === "invalid-mode" ? ["--lineart", "unknown"] : [])];
    if (scenario === "invalid-scene") args.push("--scene", "0");
    if (scenario === "invalid-duration") args.push("--duration-sec", "bad-duration");
    try {
      const output = await new Promise<{ code: number | null; text: string }>((done, reject) => {
        const child = spawn(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), ...args], {
          cwd: root, env: { ...process.env, WORKLOOM_API: `http://127.0.0.1:${address.port}`, WORKLOOM_TOKEN: "", WHITEBOARD_LINEART: "imagegen" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let text = "";
        child.stdout.on("data", chunk => { text += chunk; }); child.stderr.on("data", chunk => { text += chunk; });
        child.on("error", reject); child.on("close", code => done({ code, text }));
      });
      expect(output.code, output.text).toBe(scenario === "pending" ? 3 : scenario === "import" ? 0 : 1);
      const saved = JSON.parse(readFileSync(evidence, "utf8"));
      expect(saved.status).toBe(scenario === "pending" ? "pending" : scenario === "import" ? "completed" : "failed");
      expect(JSON.stringify(saved)).not.toContain("test-only-local-cli-session");
      expect(apiCalls.some(path => /render|deliver/.test(path))).toBe(false);
      if (scenario === "pending" || scenario === "invalid-mode") expect(apiCalls).not.toContain("video.whiteboard.lineart");
      if (["invalid-mode", "invalid-scene", "invalid-duration"].includes(scenario)) expect(apiCalls).toEqual([]);
    } finally { await new Promise<void>((r, reject) => server.close(error => error ? reject(error) : r())); }
  }, 30_000);
});
