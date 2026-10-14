import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseNarrationVerification, verifyNarration } from "./narration.js";
const root = resolve(import.meta.dirname, "../../../../..");
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("actual narration verification receipt", () => {
  it("reads nested checked fields instead of silently discarding the station transcript", () => {
    expect(parseNarrationVerification({ result: { status: "passed", checked: { asr_text: "寻找更优解。", match_ratio: 0.94 } } }))
      .toMatchObject({ status: "passed", matchRatio: 0.94, detail: expect.stringContaining("寻找更优解") });
  });
  it.each(["failed", "unverified"])("%s stays visible and never becomes a successful ASR check", status => {
    const parsed = parseNarrationVerification({ result: { status, checked: { asr_text: null, match_ratio: null }, failures: ["voice unavailable"], unverified: ["asr_error"] } });
    expect(parsed).toMatchObject({ status, matchRatio: null }); expect(parsed.detail).toContain("asr_error");
  });
  it.each([null, {}, { result: { status: "passed" } }, { result: { status: "passed", checked: { asr_text: "x", match_ratio: NaN } } }])("invalid or unsupported positive receipt %j is rejected", input => {
    expect(() => parseNarrationVerification(input)).toThrow();
  });
  let ffmpegAvailable = false;
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 30000 }); ffmpegAvailable = true; } catch { /* Optional external test prerequisite is reported as skip. */ }
  it.skipIf(!ffmpegAvailable)("real station CLI can inspect repo job bytes through private temp staging without broadening allowed roots", async () => {
    const jobs = join(root, "var"); mkdirSync(jobs, { recursive: true });
    const dir = mkdtempSync(join(jobs, "wb-verify-test-")); dirs.push(dir);
    const wav = join(dir, "original.wav");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=0.7", "-y", wav]);
    const original = readFileSync(wav);
    vi.stubEnv("WORKLOOM_VOICE_ENGINE", "mock");
    const result = await verifyNarration(wav, "fixture expected speech");
    expect(result.status).toBe("unverified"); expect(result.detail).toContain("asr_not_supported");
    expect(readFileSync(wav)).toEqual(original); expect(existsSync(wav)).toBe(true);
  }, 30_000);
});
