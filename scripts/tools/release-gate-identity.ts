/** 发布工具身份接入；生产客户端复用真实会话，不打开服务端演示登录。 */
interface ReleaseIdentityTarget { tenantId: string; workspaceId: string; slug: string; memberNo: string }
export async function acquireReleaseGateIdentity(input: {
  base: string; target: ReleaseIdentityTarget; token?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const transport = input.fetchImpl ?? fetch;
  const request = async (procedure: string, init: RequestInit): Promise<Record<string, any>> => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await transport(`${input.base.replace(/\/$/, "")}/trpc/${procedure}`, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`RELEASE_IDENTITY_HTTP：${procedure} HTTP ${response.status}`);
      let body: any;
      try { body = await response.json(); }
      catch { throw new Error(`RELEASE_IDENTITY_JSON：${procedure}无效JSON`); }
      if (!body || body.error || !body.result?.data || typeof body.result.data !== "object") throw new Error(`RELEASE_IDENTITY_RESPONSE：${procedure}未返回有效身份结果`);
      return body.result.data;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("RELEASE_IDENTITY_")) throw error;
      // 传输异常可能含请求头等敏感内容，不将原异常打印到门禁日志。
      throw new Error(`RELEASE_IDENTITY_TRANSPORT：${procedure}请求失败或超时`);
    } finally { clearTimeout(timer); }
  };
  let token = input.token;
  if (token === undefined) {
    const login = await request("auth.loginAs", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceSlug: input.target.slug, memberNo: input.target.memberNo }) });
    token = login.token;
  }
  if (typeof token !== "string" || !token.trim() || /[\r\n]/.test(token)) throw new Error("RELEASE_IDENTITY_TOKEN：未取得有效会话");
  const current = await request("members.me", { method: "GET", headers: { authorization: `Bearer ${token}` } });
  const identity = current.identity;
  if (!identity || identity.tenantId !== input.target.tenantId || identity.workspaceId !== input.target.workspaceId
    || identity.memberNo !== input.target.memberNo || !["owner", "manager"].includes(identity.role)) {
    throw new Error("RELEASE_IDENTITY_SCOPE：当前会话与发布工作区或管理成员不匹配");
  }
  return token;
}
