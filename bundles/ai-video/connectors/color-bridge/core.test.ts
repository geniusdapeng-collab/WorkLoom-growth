/**
 * 调色内核单测：纯函数（滤镜链/路径监狱/自动校正）+ 真实 ffmpeg 端到端（有 ffmpeg 才跑）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  COLOR_TOOLS, ColorError, SCOPE_KINDS, allowedRoots, assertPathAllowed, autoCorrections,
  buildChain, grade, probeMedia, renderScopes, resolveBinaries, summarize,
} from "./core.mjs";

const bins = resolveBinaries();
const hasFfmpeg = (() => {
  try {
    execFileSync(bins.ffmpeg, ["-hide_banner", "-version"], { stdio: "ignore" });
    execFileSync(bins.ffprobe, ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("工具面与滤镜链（纯函数）", () => {
  it("工具面固定为 6 个，scope 三种", () => {
    expect(COLOR_TOOLS).toHaveLength(6);
    expect(SCOPE_KINDS).toEqual(["waveform", "vectorscope", "histogram"]);
  });

  it("滤镜链顺序：校正 → profile → LUT 最后", () => {
    const chain = buildChain({
      corrections: { normalize: true, colorTemperature: 5600, eq: { brightness: 0.02 } },
      profile: "warm-film",
      lutPath: "/tmp/look.cube",
      intensity: 1,
    });
    const normalizeAt = chain.indexOf("normalize=");
    const tempAt = chain.indexOf("colortemperature=");
    const eqAt = chain.indexOf("eq=");
    const profileAt = chain.indexOf("curves=all=");
    const lutAt = chain.indexOf("lut3d=");
    expect(normalizeAt).toBeGreaterThanOrEqual(0);
    expect(tempAt).toBeGreaterThan(normalizeAt);
    expect(eqAt).toBeGreaterThan(tempAt);
    expect(profileAt).toBeGreaterThan(eqAt);
    expect(lutAt).toBeGreaterThan(profileAt);
    expect(chain.endsWith("lut3d='/tmp/look.cube'")).toBe(true);
  });

  it("强度 <1 时用 split/blend 混合，且不出现二阶滤镜", () => {
    const chain = buildChain({ profile: "natural", intensity: 0.8 });
    expect(chain).toContain("split=2[__orig][__tograde]");
    expect(chain).toContain("blend=all_mode=normal:all_opacity=0.8");
  });

  it("非法 profile / 非法强度 / 空指令被拒绝", () => {
    expect(() => buildChain({ profile: "nope" })).toThrow(/未知 profile/);
    expect(() => buildChain({ profile: "natural", intensity: 0 })).toThrow(/intensity/);
    expect(() => buildChain({ intensity: 1 })).toThrow(/未指定任何/);
  });

  it("自动校正：欠曝补 gamma/brightness、低饱和补饱和，且幅度受限", () => {
    const dark = autoCorrections({ YAVG: 55, SATAVG: 20, UAVG: 128, VAVG: 128 });
    expect(dark.eq.gamma).toBeGreaterThan(1);
    expect(dark.eq.brightness).toBeGreaterThan(0);
    expect(dark.eq.saturation).toBeGreaterThan(1);
    expect(dark.eq.brightness).toBeLessThanOrEqual(0.12);
    expect(dark.eq.saturation).toBeLessThanOrEqual(1.25);
    const bright = autoCorrections({ YAVG: 170, SATAVG: 95, UAVG: 128, VAVG: 128 });
    expect(bright.eq.brightness).toBeLessThan(0);
    expect(bright.eq.saturation).toBeLessThan(1);
    const neutral = autoCorrections({ YAVG: 110, SATAVG: 55, UAVG: 128, VAVG: 128 });
    expect(neutral).toEqual({});
  });

  it("summarize 对空输入返回 null 而不是 NaN 假值", () => {
    expect(summarize([]).YAVG).toBeNull();
    expect(summarize([{ YAVG: 100 }, { YAVG: 120 }]).YAVG).toBe(110);
  });
});

describe("路径监狱", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "colorjail-"));
  const inside = path.join(root, "a.mp4");
  fs.writeFileSync(inside, "x");

  it("放行白名单内路径，拒绝越界路径", () => {
    expect(assertPathAllowed(inside, [root], "input")).toBe(fs.realpathSync(inside));
    expect(() => assertPathAllowed("/etc/hosts", [root], "input")).toThrow(ColorError);
    expect(() => assertPathAllowed("/etc/hosts", [root], "input")).toThrow(/路径监狱/);
  });

  it("软链逃逸被拦（真实路径判定）", () => {
    const link = path.join(root, "escape");
    try {
      fs.symlinkSync("/etc", link);
    } catch {
      return; // 无权限建软链则跳过
    }
    expect(() => assertPathAllowed(path.join(link, "hosts"), [root], "input")).toThrow(/路径监狱/);
  });

  it("默认根目录只有工作目录与临时目录", () => {
    const roots = allowedRoots({});
    expect(roots).toContain(fs.realpathSync(os.tmpdir()));
    expect(allowedRoots({ WORKLOOM_COLOR_ALLOWED_ROOTS: root })).toEqual([fs.realpathSync(root)]);
  });
});

describe.runIf(hasFfmpeg)("真实 ffmpeg 端到端", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colore2e-"));
  const source = path.join(dir, "src.mp4");
  const gradedOut = path.join(dir, "graded.mp4");

  beforeAll(() => {
    // 合成一段偏暗、低饱和的测试片段（sine 渐变 + 彩条），用于验证校正可见
    execFileSync(bins.ffmpeg, [
      "-hide_banner", "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=3",
      "-vf", "eq=brightness=-0.12:saturation=0.6",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", source,
    ]);
  }, 60_000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("probe 读得到真实规格", async () => {
    const probe = await probeMedia(source, { bins });
    expect(probe.video.width).toBe(320);
    expect(probe.video.height).toBe(240);
    expect(probe.duration).toBeGreaterThan(2);
  }, 60_000);

  it("grade 出片并给出前后指标与哈希；覆盖原片被拒", async () => {
    const result = await grade({
      input: source,
      output: gradedOut,
      profile: "clean-bright",
      intensity: 0.8,
      auto: true,
      bins,
    });
    expect(fs.existsSync(gradedOut)).toBe(true);
    expect(result.sha256).toHaveLength(64);
    expect(result.after.YAVG).toBeGreaterThan(result.before.YAVG);
    expect(result.chain).toContain("eq=");
    await expect(grade({ input: source, output: source, bins })).rejects.toThrow(/禁止覆盖原片/);
  }, 120_000);

  it("scope 渲染三种图并各自带哈希", async () => {
    const outputs = await renderScopes({ input: source, at: 1, outDir: path.join(dir, "scopes"), bins });
    expect(outputs.map((o) => o.kind)).toEqual(["waveform", "vectorscope", "histogram"]);
    for (const o of outputs) {
      expect(fs.existsSync(o.path)).toBe(true);
      expect(o.sha256).toHaveLength(64);
    }
  }, 120_000);

  it("LUT 非法/缺失被拒（bad_lut）", async () => {
    await expect(grade({ input: source, output: path.join(dir, "x.mp4"), lutPath: "/tmp/missing.cube", bins }))
      .rejects.toThrow(/LUT 不存在/);
  }, 60_000);
});

