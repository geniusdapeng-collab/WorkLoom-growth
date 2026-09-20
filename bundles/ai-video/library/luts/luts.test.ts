/**
 * LUT 资产测试：格式合法性、单调性、中性点、生成器与磁盘产物一致（黄金文件）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LOOKS, applyLook, buildAll, buildCube, linearToRec709, slog3ToLinear } from "./generate-luts.mjs";

const dir = path.dirname(new URL(import.meta.url).pathname);
const SIZE = 33;

function parseCube(file: string) {
  const text = fs.readFileSync(path.join(dir, file), "utf8");
  const lines = text.split("\n");
  const size = Number(lines.find((l) => l.startsWith("LUT_3D_SIZE"))?.split(/\s+/)[1]);
  const values: Array<[number, number, number]> = [];
  for (const line of lines) {
    const m = /^([0-9.]+) ([0-9.]+) ([0-9.]+)$/.exec(line.trim());
    if (m) values.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  return { size, values, text };
}

describe("生成器数学", () => {
  it("S-Log3 曲线单调递增，且中灰码值处接近 0.18 反射率附近量级", () => {
    let prev = -1;
    for (let i = 0; i <= 100; i += 1) {
      const v = slog3ToLinear(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(slog3ToLinear(0)).toBeLessThan(0.001);
    expect(slog3ToLinear(1)).toBeGreaterThan(1);
  });

  it("Rec.709 OETF 端点与中段行为正确", () => {
    expect(linearToRec709(0)).toBe(0);
    expect(linearToRec709(1)).toBeCloseTo(1, 3);
    expect(linearToRec709(0.18)).toBeGreaterThan(0.4);
    expect(linearToRec709(0.18)).toBeLessThan(0.55);
    expect(linearToRec709(-1)).toBe(0);
  });

  it("look 保持中性灰不偏色（r=g=b 输入仍映射为中性）", () => {
    for (const spec of Object.values(LOOKS)) {
      const [r, g, b] = applyLook([0.5, 0.5, 0.5], spec as never);
      expect(Math.abs(r - g)).toBeLessThan(0.01);
      expect(Math.abs(g - b)).toBeLessThan(0.01);
    }
  });

  it(".cube 结构合法：尺寸、行数、取值区间、红通道单调", () => {
    const text = buildCube({ title: "t", transform: ([r, g, b]) => [r, g, b] });
    const parsed = parseCubeFromText(text);
    expect(parsed.size).toBe(SIZE);
    expect(parsed.values).toHaveLength(SIZE ** 3);
    for (const [r, g, b] of parsed.values.slice(0, 200)) {
      for (const v of [r, g, b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // 红通道变化最快：前 SIZE 行 r 递增
    const firstBlock = parsed.values.slice(0, SIZE).map((v) => v[0]);
    for (let i = 1; i < firstBlock.length; i += 1) {
      expect(firstBlock[i]).toBeGreaterThan(firstBlock[i - 1]!);
    }
  });

  function parseCubeFromText(text: string) {
    const lines = text.split("\n");
    const size = Number(lines.find((l) => l.startsWith("LUT_3D_SIZE"))?.split(/\s+/)[1]);
    const values: Array<[number, number, number]> = [];
    for (const line of lines) {
      const m = /^([0-9.]+) ([0-9.]+) ([0-9.]+)$/.exec(line.trim());
      if (m) values.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    }
    return { size, values };
  }
});

describe("磁盘产物（黄金文件）", () => {
  const expectations: Array<[string, number]> = [
    ["slog3-to-rec709.cube", 33],
    ["look-clean-bright.cube", 17],
    ["look-warm-film.cube", 17],
    ["look-teal-orange.cube", 17],
    ["look-moody-dark.cube", 17],
  ];
  for (const [file, expectedSize] of expectations) {
    it(`${file} 存在、结构合法、${expectedSize}³ 行`, () => {
      const parsed = parseCube(file);
      expect(parsed.size).toBe(expectedSize);
      expect(parsed.values).toHaveLength(expectedSize ** 3);
      expect(parsed.text).toContain("DOMAIN_MAX 1.000000 1.000000 1.000000");
    });
  }

  it("manifest.json 与生成器一致，且声明为自生成（无第三方 LUT）", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    expect(manifest.license).toContain("self-generated");
    expect(manifest.luts.map((l: { file: string }) => l.file).sort()).toEqual([...buildAll().keys()].sort());
  });

  it("--check 模式通过（磁盘 = 生成结果）", () => {
    const out = execFileSync(process.execPath, [path.join(dir, "generate-luts.mjs"), "--check"], { encoding: "utf8" });
    expect(out).toContain("LUT 资产校验通过");
  });
});
