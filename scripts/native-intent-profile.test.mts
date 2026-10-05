import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { applyNativeIntentProfile } from "../packages/video-studio/src/native-intent-profile.js";
import { buildPipelineIntent } from "../packages/video-studio/src/pipeline-router.js";

test("native normalized requirements reach actual vendor duration/aspect authority before G2", () => {
  const intent = buildPipelineIntent("制作30秒宣传片", { durationSec: 30, aspectRatio: "9:16", platform: "wechat-channels" });
  const metadata = applyNativeIntentProfile(intent, { brief: { product: "本次已审商品" } });
  const { HyperrealitySystem } = createRequire(import.meta.url)("../vendor/supermickey/hyperreality-system/index.js");
  const theme = { tasks: [{ duration_sec: 22, aspect_ratio: "16:9" }] };
  HyperrealitySystem.prototype._applyBriefProfile.call({}, theme, metadata);
  assert.equal(theme.tasks[0]!.duration_sec, 30); assert.equal(theme.tasks[0]!.aspect_ratio, "9:16");
  assert.match((theme.tasks[0] as any).brief_duration_source, /22s → 30s/);
  assert.equal((metadata.brief as any).product, "本次已审商品");
  assert.equal((metadata._nativeRequirementProfile as any).intentSha256, createHash("sha256").update(intent).digest("hex"));
});
test("missing requirements never invent 30 seconds or read story/dialogue timing as a contract", () => {
  for (const intent of ["", "故事中等30秒，再说一句台词", "制作短片，时长由系统规划"]) {
    const output = applyNativeIntentProfile(intent, { _nativeRequirementProfile: { forged: true }, brief: { product: "商品" } });
    assert.deepEqual(output, { brief: { product: "商品" } });
  }
});
test("valid decimal seconds, CRLF, repeated identical clauses and special characters remain intact", () => {
  const intent = "故事\r\n[需求口径] 时长:12.5s;画幅:09：16;平台:视频号\r\n[需求口径] 时长：12.5秒；目标：'quote'\\value";
  const metadata = { brief: { product: "商品'\\\n原文", duration: "12.5" } };
  const original = structuredClone(metadata), out = applyNativeIntentProfile(intent, metadata);
  assert.deepEqual(out.brief, { product: metadata.brief.product, duration: 12.5, aspectRatio: "9:16", platform: "视频号" });
  assert.deepEqual(metadata, original); assert.equal((out._nativeRequirementProfile as any).clauses.length, 2);
});
test("malformed, zero, negative, range and nonfinite requirements stop before production", () => {
  for (const duration of ["0秒", "-1秒", "30-45秒", "Infinity秒", "30", "9".repeat(400) + "秒"]) {
    assert.throws(() => applyNativeIntentProfile("[需求口径] 时长：" + duration, {}), /NATIVE_INTENT_PROFILE_INVALID/);
  }
  for (const clause of ["画幅：0:16", "画幅：竖屏", "平台：", "平台：bad\u0000"]) {
    assert.throws(() => applyNativeIntentProfile("[需求口径] " + clause, {}), /NATIVE_INTENT_PROFILE_INVALID/);
  }
});
test("conflicting explicit clauses and legacy Brief cannot silently replace the customer's requirements", () => {
  for (const text of ["时长：30秒；时长：45秒", "画幅：9:16；画幅：16:9", "平台：a；平台：b"]) {
    assert.throws(() => applyNativeIntentProfile("[需求口径] " + text, {}), /冲突/);
  }
  for (const brief of [{ duration: 45 }, { aspect_ratio: "16:9" }, { platform: "other" }, [], "invalid"]) {
    assert.throws(() => applyNativeIntentProfile("[需求口径] 时长：30秒；画幅：9:16；平台：wechat-channels", { brief }), /NATIVE_INTENT_PROFILE_INVALID/);
  }
});
test("concurrent project calls carry separate snapshots and cannot mutate input or prior results", async () => {
  const results = await Promise.all([30, 45].map(async duration => applyNativeIntentProfile(buildPipelineIntent("原生短片", { durationSec: duration }), {})));
  assert.equal((results[0]!.brief as any).duration, 30); assert.equal((results[1]!.brief as any).duration, 45);
  (results[0]!._nativeRequirementProfile as any).values.duration = 60;
  assert.equal((results[1]!._nativeRequirementProfile as any).values.duration, 45);
});
