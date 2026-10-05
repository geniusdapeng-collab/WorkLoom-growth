import type { ActorInfo } from "@workloom/base/workdata";

/** Stable attribution; this identity has no blanket system-channel exemption. */
export const STUDIO_WORKER_ACTOR = Object.freeze({ id: "video-studio", type: "system" } as const);
const bindings: Readonly<Record<string, string>> = Object.freeze({
  G1_DOSSIER: "G1", G2_THEME: "G2", G3_INSIGHT: "G3", G4_PRD: "G4",
  G5_PORTRAIT: "G5", G6_PROMPT: "G6", G7_FINAL: "G7",
});

/** Host-only internal verdict writes use the existing producer G1–G7 declarations. */
export function preproductionGateActor(gate: string): ActorInfo {
  const binding = Object.hasOwn(bindings, gate) ? bindings[gate] : undefined;
  if (!binding) throw new Error(`PREPRODUCTION_GATE_ACTOR_INVALID: ${gate}`);
  return { ...STUDIO_WORKER_ACTOR, fenceBindings: [binding] };
}
