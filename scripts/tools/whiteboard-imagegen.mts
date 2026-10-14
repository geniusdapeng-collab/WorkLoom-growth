/** Workbench-side imagegen orchestration; the service remains the only database writer. */
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { whiteboardEnv, readImageSize } from "../../apps/server/src/video/whiteboard/engine.js";
import { ContinuitySchema, ContinuityFileSchema as ContractFileSchema,
  ImagegenResultsSchema as ResultsSchema, ImagegenReceiptSchema, ImagegenUnavailableSchema, lineartSha256,
  validateImagegenReceipt, type Continuity, type ImagegenPlan, type ImagegenReceipt,
  type ImagegenUnavailable } from "../../apps/server/src/video/whiteboard/imagegen-contract.js";

export type WhiteboardLineartMode = "imagegen" | "seedream" | "sketch" | "upload";
export type LocalReference = { id: string; path: string };
type PreparedPlan = ImagegenPlan & { inputDirectory: string };
export type WhiteboardCall = <T>(path: string, body: unknown, method?: "POST" | "GET") => Promise<T>;

function readJson(file: string): unknown {
  if (!statSync(file).isFile() || statSync(file).size > 1024 * 1024) throw new Error("imagegen JSON 必须为不超过 1 MiB 的文件");
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`imagegen JSON 不可读取：${error instanceof Error ? error.message : String(error)}`); }
}

function imageBytes(file: string, expectedHash?: string): Buffer {
  const stat = statSync(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > 30 * 1024 * 1024 || !readImageSize(file)) throw new Error("imagegen 输入须为非空且不超过 30 MiB 的 PNG/JPEG");
  const bytes = readFileSync(file);
  if (expectedHash && lineartSha256(bytes) !== expectedHash) throw new Error("imagegen 图片或主参考资产摘要变化");
  return bytes;
}

export function readContinuityContract(file?: string): { continuity: Continuity; references: LocalReference[] } {
  if (!file) return { continuity: ContinuitySchema.parse({}), references: [] };
  const absolute = resolve(file);
  const source = ContractFileSchema.parse(readJson(absolute));
  const references: LocalReference[] = [];
  const continuity = ContinuitySchema.parse({
    references: source.references.map(ref => {
      const path = resolve(dirname(absolute), ref.path);
      const bytes = imageBytes(path, ref.sha256);
      references.push({ id: ref.id, path });
      return { id: ref.id, role: ref.role, description: ref.description, sha256: lineartSha256(bytes) };
    }),
    lockedElements: source.lockedElements,
  });
  return { continuity, references };
}

/** Content-addressed, non-destructive staging in the current film's private directory. */
function stageImage(plan: PreparedPlan, source: string, expectedHash: string): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(plan.projectId)) throw new Error("imagegen 项目标识非法");
  const expectedDirectory = join(whiteboardEnv().jobsDir, `film-${plan.projectId}`, "inputs");
  if (resolve(plan.inputDirectory) !== resolve(expectedDirectory)) throw new Error("imagegen 暂存目录不是本机当前项目目录；不能向远端返回的任意路径写文件");
  const bytes = imageBytes(source, expectedHash);
  const png = bytes[0] === 137 && bytes[1] === 80;
  mkdirSync(expectedDirectory, { recursive: true });
  const approvedDirectory = join(realpathSync(whiteboardEnv().jobsDir), `film-${plan.projectId}`, "inputs");
  if (realpathSync(expectedDirectory) !== approvedDirectory) throw new Error("imagegen 暂存目录不能越过任务根目录或经过项目内符号链接");
  const output = join(expectedDirectory, `${expectedHash}.${png ? "png" : "jpg"}`);
  try { writeFileSync(output, bytes, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (lineartSha256(readFileSync(output)) !== expectedHash) throw new Error("imagegen 已有暂存资产摘要不符；不覆盖原文件");
  }
  return output;
}

export function checkedWhiteboardResult<T>(result: T): T {
  if (!result || typeof result !== "object") throw new Error("白板服务缺少实际阶段结果");
  const value = result as { ok?: boolean; results?: Array<{ ok?: boolean; error?: string; check?: { ok?: boolean; checks?: Array<{ pass: boolean }> } }> };
  if (value.ok === false || value.results?.some(item => item.ok === false
    || item.check?.ok === false || item.check?.checks?.some(check => !check.pass))) {
    throw new Error(`白板阶段未通过：${JSON.stringify(value.results ?? result).slice(0, 600)}`);
  }
  return result;
}

export function selectLineartMode(raw: string, unavailable?: ImagegenUnavailable): WhiteboardLineartMode {
  if (!["imagegen", "seedream", "sketch", "upload"].includes(raw)) throw new Error("--lineart 仅支持 imagegen|seedream|sketch|upload");
  if (unavailable) {
    ImagegenUnavailableSchema.parse(unavailable);
    if (raw !== "imagegen") throw new Error("imagegen 备选声明只适用于优先 imagegen 的请求");
    return "seedream";
  }
  return raw as WhiteboardLineartMode;
}

export async function runImagegenLineart(input: {
  filmId: string; call: WhiteboardCall; contractPath?: string; resultsPath?: string;
  planPath: string; unavailable?: ImagegenUnavailable; sceneNo?: number; force?: boolean;
  onStep?: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
}): Promise<{ status: "pending" | "completed"; filmId: string; planPath: string; planHash: string;
  selected: "imagegen" | "seedream"; results: unknown[] }> {
  if (input.sceneNo !== undefined && (!Number.isSafeInteger(input.sceneNo) || input.sceneNo < 1)) {
    throw new Error("imagegen 幕号须为正整数，非法幕号不能变成整片生成");
  }
  if (input.unavailable && input.resultsPath) throw new Error("不能同时提交 imagegen 产物和工具不可用声明");
  if (input.unavailable) ImagegenUnavailableSchema.parse(input.unavailable);
  const contract = readContinuityContract(input.contractPath);
  const plan = await input.call<PreparedPlan>("video.whiteboard.lineartPlan", {
    filmId: input.filmId, continuity: contract.continuity,
  }, "GET");
  if (plan.schemaVersion !== "workloom.whiteboard-imagegen-plan/v1" || plan.filmId !== input.filmId
    || !Array.isArray(plan.scenes) || plan.scenes.length === 0 || !/^[a-f0-9]{64}$/.test(plan.planHash)
    || JSON.stringify(plan.continuity) !== JSON.stringify(contract.continuity)) throw new Error("服务端 imagegen 计划与请求不一致");
  const targets = input.sceneNo ? plan.scenes.filter(scene => scene.sceneNo === input.sceneNo) : plan.scenes;
  if (!targets.length) throw new Error("imagegen 计划中不存在指定幕号");
  const selected = input.unavailable ? "seedream" : "imagegen";
  const planPath = resolve(input.planPath);
  mkdirSync(dirname(planPath), { recursive: true });
  writeFileSync(planPath, `${JSON.stringify({ ...plan, localReferences: contract.references,
    selection: { preferred: "imagegen", selected, unavailable: input.unavailable ?? null } }, null, 2)}\n`, "utf8");
  const needed = targets.filter(scene => input.force || !scene.existingPath);
  const summary = { filmId: input.filmId, planPath, planHash: plan.planHash, selected };
  if (needed.length && !input.unavailable && !input.resultsPath) {
    return { ...summary, status: "pending", results: [] };
  }

  const prepared = new Map<number, { path: string; receipt: ImagegenReceipt }>();
  let stagedReferences: LocalReference[] = [];
  // Validate the complete requested batch before its first import; missing files do not trigger fallback.
  if (needed.length && input.resultsPath) {
    const resultsPath = resolve(input.resultsPath);
    const supplied = ResultsSchema.parse(readJson(resultsPath));
    const seen = new Set<number>();
    for (const scene of supplied.scenes) {
      if (seen.has(scene.sceneNo) || !plan.scenes.some(item => item.sceneNo === scene.sceneNo)) throw new Error("imagegen 产物幕号重复或不属于当前项目");
      seen.add(scene.sceneNo);
    }
    for (const target of needed) {
      const item = supplied.scenes.find(scene => scene.sceneNo === target.sceneNo);
      if (!item) throw new Error(`imagegen 缺少第 ${target.sceneNo} 幕产物；等待该幕，不启用付费备选`);
      const receipt = ImagegenReceiptSchema.parse({ schemaVersion: "workloom.whiteboard-imagegen-receipt/v1",
        planHash: supplied.planHash, sceneHash: item.sceneHash, imageSha256: item.imageSha256,
        referencedHashes: item.referencedHashes, visualReview: item.visualReview });
      validateImagegenReceipt(plan, target.sceneNo, receipt);
      const path = resolve(dirname(resultsPath), item.path);
      imageBytes(path, receipt.imageSha256);
      prepared.set(target.sceneNo, { path, receipt });
    }
  }
  if (needed.length) stagedReferences = contract.references.map(ref => ({ id: ref.id,
    path: stageImage(plan, ref.path, contract.continuity.references.find(item => item.id === ref.id)!.sha256) }));
  let continuity = contract.continuity;
  const results: unknown[] = [];
  const execute = input.onStep ?? (async (_name, fn) => fn());
  const adoptFallbackMaster = (result: unknown) => {
    if (selected !== "seedream" || continuity.references.length) return;
    const first = (result as { results?: Array<{ path: string; sha256: string }> }).results?.[0];
    if (!first?.path || !/^[a-f0-9]{64}$/.test(first.sha256)) throw new Error("Seedream 主参考缺少真实资产摘要，不能继续生成其它幕");
    continuity = ContinuitySchema.parse({ references: [{ id: "fallback-master", role: "style",
      description: "首个已成功线稿的固定纸底、线条和核心图形；后续保持这些特征，不重新设计主体", sha256: first.sha256 }], lockedElements: [] });
    stagedReferences = [{ id: "fallback-master", path: first.path }];
  };
  // A resumed fallback reuses the earliest successful scene even when --scene selects a later one.
  const existingMaster = selected === "seedream" && !continuity.references.length
    ? plan.scenes.find(scene => scene.existingPath) : undefined;
  if (existingMaster) {
    adoptFallbackMaster(await execute("lineart:reference:reuse", async () => checkedWhiteboardResult(
      await input.call("video.whiteboard.lineart", { filmId: input.filmId, sceneNo: existingMaster.sceneNo }))));
  }
  for (const scene of targets) {
    if (scene.existingPath && !input.force) {
      results.push(await execute(`lineart:${scene.sceneNo}:reuse`, async () => checkedWhiteboardResult(
        await input.call("video.whiteboard.lineart", { filmId: input.filmId, sceneNo: scene.sceneNo }))));
      continue;
    }
    const artifact = prepared.get(scene.sceneNo);
    const sourcePath = artifact ? stageImage(plan, artifact.path, artifact.receipt.imageSha256) : undefined;
    const result = await execute(`lineart:${scene.sceneNo}:${selected}`, async () => checkedWhiteboardResult(
      await input.call<{ results: Array<{ path: string; sha256: string }> }>("video.whiteboard.lineart", {
        filmId: input.filmId, sceneNo: scene.sceneNo, mode: selected, continuity,
        referencePaths: stagedReferences, ...(input.force ? { force: true } : {}),
        ...(artifact ? { sourcePath, imagegenReceipt: artifact.receipt } : {}),
        ...(input.unavailable ? { imagegenUnavailable: input.unavailable } : {}),
      })));
    results.push(result);
    adoptFallbackMaster(result);
  }
  return { ...summary, status: "completed", results };
}
