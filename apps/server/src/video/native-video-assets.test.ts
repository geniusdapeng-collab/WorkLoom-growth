import { describe, expect, it } from "vitest";
import { assertCustomerVideoMetadata, resolveNativeVideoAssets, resolveNativeRouteMetadata } from "./native-video-assets.js";
import { routeVideoPipeline } from "@hyperreality/video-studio";
describe("native video archive identity boundary", () => {
  it.each(["shots", "shotlist", "storyboard", "script", "prompts", "promptPack", "characters", "filmSource", "verifiedRaw", "_dataDossier", "document"])("rejects injected %s in metadata and brief", key => {
    expect(() => assertCustomerVideoMetadata({ [key]: [] })).toThrow("CALLER_SOURCE_FORBIDDEN");
    expect(() => assertCustomerVideoMetadata({ brief: { [key]: {} } })).toThrow("CALLER_SOURCE_FORBIDDEN");
  });
  it("resolves the registered CEO and exact customer product photos with no model generation", () => {
    const assets = resolveNativeVideoAssets({ characterId: "demo-character", productId: "demo-t001" });
    expect(assets.realPerson!.assetId).toBe("asset-20260101000000-demo");
    expect(Object.keys(assets.portraits[0]!.files)).toHaveLength(8);
    expect(Object.keys(assets.portraits[1]!.files)).toEqual(["p1", "p2"]);
  });
  it("routes a registered product identity through the existing marketing router without asking for its name again", async () => {
    const metadata = await resolveNativeRouteMetadata({ productId: "demo-t001", dataMining: { name: "错误商品", sellingPointCandidates: ["伪造卖点"] } });
    expect(metadata.dataMining).toMatchObject({ name: "示例品牌 台式双屏自助机", model: "DEMO-T001" });
    expect(metadata.dataMining).not.toHaveProperty("sellingPointCandidates");
    await expect(routeVideoPipeline({ text: "制作30秒宣传片", metadata, explicit: "marketing" })).resolves.toMatchObject({ route: "marketing" });
    await expect(resolveNativeRouteMetadata({ productId: "../other" })).rejects.toThrow("PRODUCT_ARCHIVE_ID_INVALID");
  });
});
