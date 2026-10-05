/** Public film CLI: native service plan → a single service job → receipts. Never accepts creative source or model keys. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { FilmServiceClient } from "../../packages/video-studio/src/film-service-client.js";
import { normalizeNativeFilmJobRequest } from "../../packages/video-studio/src/native-film-source.js";

const values = new Set(["project", "intent", "character", "product", "preproduction-status", "pipeline", "api", "status", "receipt", "max-budget-cny", "stages", "aspect", "resolution", "quality", "platform", "fps", "max-attempts", "xfade", "cut-transition", "cut-transition-duration", "cut-transition-at", "subtitle-mode", "subtitle-lang", "cover-platform", "cover-hero", "cover-hook", "theme", "account", "review-policy", "narration-profile", "enhance-kind"]);
const flags = new Set(["prepare", "plan", "no-wait", "unified-narration", "prompt-english-gloss", "material-speed-ramp", "bgm-declared-program-mix"]);
export async function runFilmServiceCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) throw new Error("FILM_CLI_ARGUMENT_INVALID: 只接受命名参数");
    const key = arg.slice(2);
    if (Object.hasOwn(args, key)) throw new Error(`FILM_CLI_ARGUMENT_INVALID: 重复参数${arg}`);
    if (["shots", "brief", "keys-file", "library", "work-dir", "out", "route", "route-kind", "only", "assembly-mode", "material-post-only", "accept-rejected", "allow-fallback-approve"].includes(key)) {
      throw new Error(`CALLER_SOURCE_FORBIDDEN: 正式制作不接受${arg}；用服务预生产生成创意、剧本、分镜和提示词，再用--project读取原生计划`);
    }
    if (flags.has(key)) args[key] = true;
    else if (values.has(key)) {
      const value = argv[++index];
      if (!value || value.startsWith("--") || /[\0\r\n]/.test(value)) throw new Error(`FILM_CLI_ARGUMENT_INVALID: ${arg}缺少有效值`);
      args[key] = value;
    } else throw new Error(`FILM_CLI_ARGUMENT_INVALID: 不支持${arg}`);
  }
  const options = Object.fromEntries(Object.entries(args).filter(([key]) => !["project", "intent", "character", "product", "preproduction-status", "pipeline", "prepare", "api", "status", "receipt", "max-budget-cny", "stages", "plan", "no-wait"].includes(key)));
  const normalized = normalizeNativeFilmJobRequest(typeof args.stages === "string" ? args.stages.split(",") : undefined, options);
  const client = new FilmServiceClient({ api: String(args.api ?? env.WORKLOOM_API ?? env.WORKLOOM_BASE_URL ?? "http://127.0.0.1:8787"), token: env.WORKLOOM_TOKEN ?? env.WORKLOOM_ACCESS_TOKEN ?? "" });
  const save = (value: unknown): void => {
    const bytes = JSON.stringify(value, null, 2) + "\n";
    process.stdout.write(bytes);
    if (typeof args.receipt === "string") { const file = resolve(args.receipt); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes, { mode: 0o600 }); }
  };
  try {
    if (args.prepare || typeof args["preproduction-status"] === "string") {
      if (args.project || args.status) throw new Error("FILM_CLI_ARGUMENT_INVALID: 原生预生产与渲染作业参数不能混用");
      let runId: string;
      if (typeof args["preproduction-status"] === "string") runId = args["preproduction-status"];
      else {
        if (typeof args.intent !== "string" || args.pipeline && !["auto", "marketing", "narrative"].includes(String(args.pipeline))) throw new Error("FILM_CLI_ARGUMENT_INVALID: --prepare需要客户--intent和有效--pipeline");
        const receipt = await client.prepare({ intent: args.intent, ...(typeof args.character === "string" ? { characterId: args.character } : {}),
          ...(typeof args.product === "string" ? { productId: args.product } : {}), ...(typeof args.platform === "string" ? { platform: args.platform } : {}),
          route: args.pipeline as "auto" | "marketing" | "narrative" | undefined });
        save(receipt); runId = receipt.runId;
        if (args["no-wait"]) return 3;
      }
      let status = await client.preproductionStatus(runId);
      for (let round = 0; round < 360 && status.status === "running" && !args["no-wait"]; round++) {
        process.stderr.write(`[preproduction] ${status.projectId} ${status.currentGate ?? "running"}\n`);
        await new Promise(resolve => setTimeout(resolve, 10_000)); status = await client.preproductionStatus(runId);
      }
      save(status);
      if (status.status !== "finished") return status.status === "running" ? 3 : 4;
      save(await client.plan(status.projectId)); return 0;
    }
    if (args.intent || args.character || args.product || args.pipeline) throw new Error("FILM_CLI_ARGUMENT_INVALID: 客户意图只用于--prepare，制作镜头由正式管线生成");
    if (typeof args.status === "string") {
      const status = args["no-wait"] ? await client.status(args.status) : await client.wait(args.status);
      save(status); return status.status === "finished" ? 0 : status.status === "running" ? 3 : 4;
    }
    if (typeof args.project !== "string") throw new Error("PROJECT_REQUIRED: 用--project选择正式预生产项目");
    const plan = await client.plan(args.project);
    if (args.plan) { save(plan); return 0; }
    const budget = args["max-budget-cny"] === undefined ? plan.estimatedReserveCny : Number(args["max-budget-cny"]);
    if (!Number.isFinite(budget) || budget < plan.estimatedReserveCny) throw new Error("FILM_BUDGET_INSUFFICIENT: 预算低于服务原生计划上界，未提交渲染");
    const receipt = await client.start({ projectId: plan.projectId, workerName: "full-chain-film", sourceVersion: plan.sourceVersion,
      stages: normalized.stages, options: normalized.options, maxBudgetCny: budget });
    save(receipt);
    if (args["no-wait"]) return 3;
    const status = await client.wait(receipt.jobId, { onProgress: current => { process.stderr.write(`[film] ${current.jobId} ${current.status}；预占${current.reservedCny}元\n`); } });
    save(status); return status.status === "finished" ? 0 : status.status === "running" ? 3 : 4;
  } catch (error) { process.stderr.write(client.safeError(error) + "\n"); return 2; }
}
