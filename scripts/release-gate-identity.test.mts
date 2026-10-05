import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.env.WORKLOOM_ASSERTION_MODULE_ROOT ?? new URL("../", import.meta.url).pathname);
const moduleAt = () => import(pathToFileURL(resolve(root, "scripts/tools/release-gate-identity.ts")).href);
const target = { tenantId: "tenant-1", workspaceId: "ws-1", slug: "ws-one", memberNo: "MEM-1" };
const identity = { ...target, role: "owner" };
test("a native production access token is checked against current server identity without mock login", async () => {
  const { acquireReleaseGateIdentity } = await moduleAt(); const calls: any[] = [];
  const token = await acquireReleaseGateIdentity({ base: "https://service.test", target, token: "native-session",
    fetchImpl: async (url: string, init: any) => { calls.push({ url, init }); return Response.json({ result: { data: { identity } } }); } });
  assert.equal(token, "native-session"); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://service.test/trpc/members.me"); assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.authorization, "Bearer native-session");
});
test("expired, foreign-scope, wrong-member and readonly sessions cannot fall back to demo login", async () => {
  const { acquireReleaseGateIdentity } = await moduleAt();
  for (const response of [new Response("{}", { status: 401 }), ...[{ tenantId: "other" }, { workspaceId: "other" }, { memberNo: "other" }, { role: "readonly" }]
    .map(change => Response.json({ result: { data: { identity: { ...identity, ...change } } } }))]) {
    let calls = 0;
    await assert.rejects(() => acquireReleaseGateIdentity({ base: "https://service.test", target, token: "bad-session",
      fetchImpl: async () => { calls++; return response; } }), /RELEASE_IDENTITY/);
    assert.equal(calls, 1);
  }
});
test("existing development login also validates the returned server identity", async () => {
  const { acquireReleaseGateIdentity } = await moduleAt(); const calls: any[] = [];
  const token = await acquireReleaseGateIdentity({ base: "https://service.test", target,
    fetchImpl: async (url: string, init: any) => { calls.push({ url, init }); return Response.json(calls.length === 1
      ? { result: { data: { token: "dev-session" } } } : { result: { data: { identity: { ...identity, role: "manager" } } } }); } });
  assert.equal(token, "dev-session"); assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://service.test/trpc/auth.loginAs");
  assert.deepEqual(JSON.parse(calls[0].init.body), { workspaceSlug: target.slug, memberNo: target.memberNo });
});
test("HTTP, malformed JSON and transport failures stop with no fabricated token", async () => {
  const { acquireReleaseGateIdentity } = await moduleAt();
  for (const response of [new Response("{}", { status: 503 }), new Response("invalid JSON"), Response.json({ error: { message: "not allowed" } }), Response.json({ result: { data: {} } })]) {
    let calls = 0;
    await assert.rejects(() => acquireReleaseGateIdentity({ base: "https://service.test", target,
      fetchImpl: async () => { calls++; return response; } }), /RELEASE_IDENTITY/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(() => acquireReleaseGateIdentity({ base: "https://service.test", target, token: "native-session",
    fetchImpl: async () => { calls++; throw new Error("transport unavailable"); } }), /RELEASE_IDENTITY/);
  assert.equal(calls, 1);
});
