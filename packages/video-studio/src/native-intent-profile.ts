/** Carry the standard customer requirement block into the vendor's existing Brief contract. */
import { createHash } from "node:crypto";

type Profile = { duration?: number; aspectRatio?: string; platform?: string };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
function fail(message: string): never { throw new Error(`NATIVE_INTENT_PROFILE_INVALID: ${message}`); }

export function applyNativeIntentProfile(intent: string, metadata: Record<string, unknown>): Record<string, unknown> {
  const output = structuredClone(metadata);
  delete output._nativeRequirementProfile;
  const clauses = [...intent.matchAll(/\[需求口径\]([^\r\n]*?)(?=\[需求口径\]|\r|\n|$)/gu)].map(match => match[1]!.trim());
  if (!clauses.length) return output;
  const profile: Profile = {};
  for (const clause of clauses) {
    for (const field of clause.split(/[；;]/u)) {
      const entry = field.trim().match(/^(时长|画幅|平台)\s*[:：]\s*(.*)$/u);
      if (!entry) continue;
      const value = entry[2]!.trim();
      let key: keyof Profile, parsed: number | string;
      if (entry[1] === "时长") {
        const duration = value.match(/^(\d+(?:\.\d+)?)\s*(?:秒|s)$/iu);
        if (!duration || !Number.isFinite(Number(duration[1])) || Number(duration[1]) <= 0) fail("时长必须是明确的正秒数");
        key = "duration"; parsed = Number(duration[1]);
      } else if (entry[1] === "画幅") {
        const aspect = value.match(/^(\d{1,3})\s*[:：]\s*(\d{1,3})$/u);
        if (!aspect || Number(aspect[1]) <= 0 || Number(aspect[2]) <= 0) fail("画幅必须是明确的正宽高比");
        key = "aspectRatio"; parsed = `${Number(aspect[1])}:${Number(aspect[2])}`;
      } else {
        if (!value || value.length > 128 || /[\x00-\x1f\x7f]/u.test(value)) fail("平台为空或格式无效");
        key = "platform"; parsed = value;
      }
      if (profile[key] !== undefined && profile[key] !== parsed) fail(`存在相互冲突的${entry[1]}需求`);
      Object.assign(profile, { [key]: parsed });
    }
  }
  if (!Object.keys(profile).length) return output;
  if (output.brief !== undefined && !record(output.brief)) fail("已有Brief不是对象");
  const brief = { ...(output.brief as Record<string, unknown> | undefined) };
  for (const [key, value] of Object.entries(profile)) {
    const existing = brief[key];
    if (existing !== undefined && (key === "duration" ? Number(existing) !== value : existing !== value)) fail(`Brief与需求口径的${key}冲突`);
    if (key === "aspectRatio" && brief.aspect_ratio !== undefined && brief.aspect_ratio !== value) fail("Brief与需求口径的aspect_ratio冲突");
    brief[key] = value;
  }
  output.brief = brief;
  output._nativeRequirementProfile = {
    schema: "workloom.native-requirement-profile/v1",
    intentSha256: createHash("sha256").update(intent).digest("hex"),
    clauses, values: profile
  };
  return output;
}
