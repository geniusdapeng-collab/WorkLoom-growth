import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = realpathSync(new URL("../", import.meta.url).pathname);
function route(args: string[]): { decision: { route: string }; recommendedCommand: string | null } {
  const dir = mkdtempSync(join(tmpdir(), "native-video-route-"));
  try {
    const file = join(dir, "route.json");
    const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/tools/route-video.mts", ...args, "--out", file],
      { cwd: root, encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(readFileSync(file, "utf8"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function assertNative(command: string): void {
  assert.match(command, /--prepare/);
  assert.match(command, /--intent/);
  assert.match(command, /--project VID-XXXX --plan/);
  assert.doesNotMatch(command, /--(?:shots|brief|keys-file|work-dir|out|route|stages)\b/);
}
test("marketing routing points to native intent and controlled identities before a service plan", () => {
  const value = route(["--title", "给酒店自助机制作30秒营销片", "--explicit", "marketing", "--product", "酒店自助机",
    "--product-id", "demo-t001", "--character-id", "demo-character", "--platform", "视频号"]);
  assert.equal(value.decision.route, "marketing");
  assertNative(value.recommendedCommand!);
  assert.match(value.recommendedCommand!, /--product 'demo-t001'/);
  assert.match(value.recommendedCommand!, /--character 'demo-character'/);
  assert.match(value.recommendedCommand!, /--platform '视频号'/);
});
test("narrative routing uses the same native preproduction without a product or caller source", () => {
  const value = route(["--title", "一条30秒人物故事", "--explicit", "narrative"]);
  assertNative(value.recommendedCommand!);
  assert.match(value.recommendedCommand!, /--pipeline narrative/);
  assert.doesNotMatch(value.recommendedCommand!, /--product\b|--character\b/);
});
test("route recommendations preserve customer words as one shell argument without execution", () => {
  const title = "人物故事 '; echo ROUTE_INJECTION; # $(echo ROUTE_SUBSTITUTION) \n台词完整";
  const value = route(["--title", title, "--explicit", "narrative"]);
  const command = value.recommendedCommand!.split("\n").find(line => line.includes("--prepare"));
  assert.ok(command, "native prepare command missing");
  const run = spawnSync("/bin/sh", ["-c", 'pnpm() { "$TASK_NODE" -e \'process.stdout.write(JSON.stringify(process.argv.slice(1)))\' "$@"; };\n' + command],
    { encoding: "utf8", timeout: 10_000, env: { TASK_NODE: process.execPath } });
  assert.equal(run.status, 0, run.stderr);
  const args = JSON.parse(run.stdout) as string[];
  assert.equal(args[args.indexOf("--intent") + 1], title.replace(/\s{2,}/g, " ").trim());
});
test("missing archive identity remains an explicit placeholder and is never guessed from a name", () => {
  const value = route(["--title", "推广酒店自助机", "--product", "酒店自助机", "--explicit", "marketing"]);
  assertNative(value.recommendedCommand!);
  assert.match(value.recommendedCommand!, /--product PRODUCT_ARCHIVE_ID/);
  assert.match(value.recommendedCommand!, /PRODUCT_ARCHIVE_ID.*商品档案/);
});
test("clarification has no executable command and the separate explainer entry is preserved", () => {
  assert.equal(route(["--title", "做个视频"]).recommendedCommand, null);
  const value = route(["--title", "一条解说片", "--explicit", "explainer"]);
  assert.equal(value.decision.route, "explainer");
  assert.match(value.recommendedCommand!, /pnpm explainer:run/);
  assert.doesNotMatch(value.recommendedCommand!, /full-chain-film/);
});
