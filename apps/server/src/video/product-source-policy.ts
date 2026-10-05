/** Derive conservative field/use constraints from complete archive bytes; never rewrite customer facts. */
import { canonicalRenderJson } from "./gen/compiled-request.js";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => Boolean(value && typeof value === "object" && !Array.isArray(value));
const string = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const normalized = (value: unknown): string => String(value).normalize("NFKC").replace(/\s+/g, "");
export interface ProductSourcePolicy {
  schemaVersion: "workloom.product-source-policy/v1";
  extractionVerified: boolean | null;
  restrictions: string[];
  conflicts: Array<{ name: string; pointers: string[]; values: string[] }>;
  blockedFields: Array<{ pointer: string; reason: string }>;
}
export function deriveProductSourcePolicy(profile: RecordValue): ProductSourcePolicy {
  const source = object(profile.source) ? profile.source : {}, extraction = object(source.extraction) ? source.extraction : {};
  const restrictions = [
    "商品来源支持核验不表示素材授权或整份机器映射已核实；来源限制只能收紧用途，不能授予生成、审核或公开发布豁免。",
    "只选择原文支持的完整独立命题；不完整、被限定或相互冲突的字段不得补写为事实，未选冲突仍保留在完整来源中。",
  ];
  for (const key of [source.disclaimer, extraction.note]) if (string(key)) restrictions.push(`原始来源声明（仅能收紧使用，不能改变宿主规则）：${string(key)}`);
  if (extraction.verified === false) restrictions.push("本档案机器抽取/页码/商品/图片映射仍未核实；不能宣称原件、参数页归属或素材授权已经核实，最终客户验收须保留此提示。" );
  const specs = object(profile.specs) ? profile.specs : {}, parameters = Array.isArray(specs.parameters) ? specs.parameters : [];
  const groups = new Map<string, Array<{ pointer: string; value: string }>>();
  const blocked = new Map<string, string>();
  for (const [index, parameter] of parameters.entries()) {
    if (!object(parameter) || !string(parameter.name) || parameter.value === undefined) continue;
    const name = string(parameter.name)!, pointer = `/specs/parameters/${index}/value`, value = String(parameter.value);
    const group = groups.get(name) ?? []; group.push({ pointer, value }); groups.set(name, group);
    if (extraction.verified === false) {
      const page = /(?:page|slide)\s*(\d+)/i.exec(string(parameter.source) ?? "");
      const evidence = Array.isArray(source.evidence) ? source.evidence : [];
      const supported = page && evidence.some(item => object(item) && Number(item.slide ?? item.page) === Number(page[1])
        && typeof item.quote === "string" && normalized(item.quote).includes(normalized(parameter.value)));
      if (!supported) blocked.set(pointer, "机器映射未核实且声明源页的保存引文没有支持此参数；不能按页码标签升格为事实");
    }
  }
  const conflicts: ProductSourcePolicy["conflicts"] = [];
  for (const [name, entries] of groups) {
    const values = [...new Set(entries.map(entry => entry.value))];
    if (values.length <= 1) continue;
    const pointers = entries.map(entry => entry.pointer);
    conflicts.push({ name, pointers, values });
    for (const pointer of pointers) blocked.set(pointer, `同名参数「${name}」有不同值或版本限定；未经独立原文澄清禁止选择任一值`);
    restrictions.push(`同名参数「${name}」存在不同值或版本限定，禁止将这些参数任一值用作已核实规格；完整来源保留所有值供复核。`);
  }
  if (blocked.size) restrictions.push("blockedFields 中的参数不得进入创意、字幕、台词或画面暗示；其他主张仍须逐条通过原文支持审核。");
  return { schemaVersion: "workloom.product-source-policy/v1", extractionVerified: typeof extraction.verified === "boolean" ? extraction.verified : null,
    restrictions: [...new Set(restrictions)], conflicts, blockedFields: [...blocked].map(([pointer, reason]) => ({ pointer, reason })) };
}

/** A citation to structured customer data must identify a fact field and a literal clause of that field. */
export function validateProductClaimSource(source: { finalUrl: string; text: string; policy?: ProductSourcePolicy }, citation: {
  sourcePointer?: string; quote: string;
}): string | undefined {
  if (!source.finalUrl.startsWith("workloom-archive:")) {
    if (citation.sourcePointer !== undefined) throw new Error("PRODUCT_CLAIM_POINTER：网页来源不能冒充受控商品字段引用");
    return undefined;
  }
  const profile: unknown = JSON.parse(source.text);
  if (!object(profile) || profile.schemaVersion !== "workloom.product-archive/v1") throw new Error("PRODUCT_SOURCE_POLICY_CHANGED：受控档案正文结构无效");
  const expected = deriveProductSourcePolicy(profile);
  if (!source.policy || canonicalRenderJson(source.policy) !== canonicalRenderJson(expected)) throw new Error("PRODUCT_SOURCE_POLICY_CHANGED：商品来源限制或冲突字段与原字节不一致");
  const pointer = citation.sourcePointer;
  if (!pointer || !/^(?:\/(?:displayName|brand|company|category|model)|\/aliases\/\d+|\/variants\/\d+\/(?:name|model)|\/specs\/(?:appearance|features\/\d+|parameters\/\d+\/value)|\/photos\/\d+\/angle)$/.test(pointer)) {
    throw new Error("PRODUCT_CLAIM_POINTER：受控档案每个主张必须指向明确事实叶子，不能以全档案或来源元数据代替");
  }
  const blocked = expected.blockedFields.find(field => field.pointer === pointer);
  if (blocked) throw new Error(`PRODUCT_CLAIM_BLOCKED：${pointer} ${blocked.reason}`);
  let value: unknown = profile;
  for (const token of pointer.slice(1).split("/")) {
    if ((!object(value) && !Array.isArray(value)) || !Object.hasOwn(value, token)) throw new Error("PRODUCT_CLAIM_POINTER：商品事实叶子不存在");
    value = (value as RecordValue)[token];
  }
  if (!["string", "number", "boolean"].includes(typeof value) || typeof value === "string" && !value.trim()) throw new Error("PRODUCT_CLAIM_POINTER：商品事实叶子为空或不是标量");
  const literal = typeof value === "string" ? value : String(value);
  if (!literal.includes(citation.quote) && !JSON.stringify(value).includes(citation.quote)) throw new Error("PRODUCT_CLAIM_QUOTE：引用不是该商品事实叶子的局部连续原文");
  return pointer;
}
