#!/usr/bin/env tsx
/**
 * 出片工具（2026-09-21）：把一段镜头描述直接提交给视频生成接缝并轮询到成片。
 *
 * 用法：
 *   pnpm exec tsx --env-file=.env scripts/tools/render-shot.mts \
 *     --key vid1007-s01 --prompt "……镜头描述……" [--seconds 15] [--aspect 9:16] [--resolution 1080p] [--model doubao-seedance-2-5]
 *
 * 口径：走 video.cms.saveScriptVersion → video.render.submit（唯一写入口：幂等键/降级链/报价/事件留痕）
 *      → video.render.poll 轮询；完成后成片由入库链落到 var/media/** 并登记 video_assets(final_cut)。
 *      素材制作不设人审（render_auto），但预算上限闸与供应商降级链照常生效。
 */
const API = process.env.WORKLOOM_API ?? "http://127.0.0.1:8787";
const TOKEN = process.env.WORKLOOM_TOKEN ?? "";
const arg = (name: string, fallback = "") => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

async function call(path: string, body: unknown, method: "POST" | "GET" = "POST") {
  const url = method === "GET"
    ? `${API}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(body))}`
    : `${API}/trpc/${path}`;
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (json.error) throw new Error(`${path}: ${json.error.message}`);
  return json.result?.data;
}

const key = arg("--key");
const prompt = arg("--prompt");
if (!key || !prompt) throw new Error("需要 --key 与 --prompt");
const seconds = Number(arg("--seconds", "15"));
const aspect = arg("--aspect", "9:16");
const resolution = arg("--resolution", "1080p");
const modelId = arg("--model", "doubao-seedance-2-5");
/** 提交按 render_scripts.id 定位（接口按 id 查询）；--script-id 缺省等于 --key */
const scriptId = arg("--script-id", key);

const md = `# ${key}\n\n## 镜头描述\n\n${prompt}\n\n## 参数\n\n- 画幅：${aspect}\n- 分辨率：${resolution}\n- 时长：${seconds}s\n- 模型：${modelId}\n`;
const fields = {
  镜头描述: prompt, 画幅: aspect, 分辨率: resolution, 时长秒: seconds, 模型: modelId,
  生成方式: "text-to-video", 一致性锚定: "苏州园林实景风格（晨雾/庭院/灯影）",
};
if (arg("--skip-save") !== "1") await call("video.cms.saveScriptVersion", { scriptKey: key, md, fields, diffSummary: "出片工具生成" });
const submitted = await call("video.render.submit", {
  scriptId, mode: "auto", modelId, durationSec: seconds, aspectRatio: aspect, resolution, generateAudio: true, estimatedSeconds: seconds,
});
console.log(`提交：job=${submitted.jobId} task=${submitted.taskId} provider=${submitted.provider} model=${submitted.providerModel} mock=${submitted.mock} clamped=${submitted.clamped ?? "—"}`);

for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 15000));
  const polled = await call("video.render.poll", { jobId: submitted.jobId });
  const status = polled?.status ?? "unknown";
  if (i % 4 === 0) console.log(`轮询 ${i}: ${status}`);
  if (status === "done" || status === "failed") {
    console.log(JSON.stringify(polled, null, 2).slice(0, 800));
    break;
  }
}
