/** Routing is advisory; only the native service may create and qualify a paid film plan. */
import type { VideoPipelineKind } from "../../packages/video-studio/src/pipeline-router.js";

const quote = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'";
export function nativeVideoRouteCommand(input: {
  route: VideoPipelineKind; intent: string; productId?: string; characterId?: string; platform?: string;
}): string {
  if (input.route === "explainer") return [
    "# 口播解说片（图文成片，不跑逐镜生成）：一份口播稿 + 一条配音",
    "pnpm explainer:run -- --script var/scripts/<稿>.md --task-id <任务> --profile <音色档> \\",
    "  --host-portraits bundles/ai-video/library/characters/<角色>/portraits/<版本> --brand-product <品牌产品>",
  ].join("\n");
  const entry = "pnpm exec tsx scripts/tools/full-chain-film.mts";
  const prepare = [entry, "--prepare", "--pipeline", input.route, "--intent", quote(input.intent.replace(/[\r\n]+/g, " ").trim())];
  if (input.route === "marketing") prepare.push("--product", input.productId ? quote(input.productId) : "PRODUCT_ARCHIVE_ID");
  if (input.characterId) prepare.push("--character", quote(input.characterId));
  if (input.platform) prepare.push("--platform", quote(input.platform));
  return [
    "# 服务身份由 WORKLOOM_BASE_URL / WORKLOOM_ACCESS_TOKEN 提供；创意、剧本、分镜和提示词由原生管线生成",
    ...(input.route === "marketing" && !input.productId ? ["# 将 PRODUCT_ARCHIVE_ID 替换为已有受控商品档案 ID（分流器不从商品名猜 ID）"] : []),
    prepare.join(" "),
    "# 将 VID-XXXX 替换为 prepare 回执的项目 ID；先检查原生分镜、门禁、来源版本和预算上界",
    `${entry} --project VID-XXXX --plan`,
    "# 原生计划通过后提交一次正式制作；服务固定完整渲染和后期，不接受外部片单或裁剪阶段",
    `${entry} --project VID-XXXX --max-attempts 1 --review-policy off --subtitle-mode both`,
  ].join("\n");
}
