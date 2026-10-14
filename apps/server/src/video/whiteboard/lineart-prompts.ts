/** Shared visual specification for Seedream and Codex imagegen whiteboard scenes. */
export const LINEART_STYLE_PROMPT = [
  "极简手绘线稿插画，纯素描草图风格，类似 Notion 的克制涂鸦美学。",
  "暖米黄色旧纸张背景（#F5EBD7），深灰色素描线条（#3A3E46），干净背景、大量留白。",
  "对象以简洁轮廓与少量线条表达，强调关系、变化与核心概念，不追求写实比例与细节。",
  "红、橙、蓝仅允许极少量概念性点缀。",
  "禁止：画面中的任何文字、词语、字母、数字、标签；写实感、摄影细节、3D 效果、绘画质感；",
  "复杂场景、密集背景、繁复装饰、高饱和度配色。",
  "画面主体之间必须互不重叠、彼此留出清晰空隙，便于后续分区绘制。",
].join("");

export function buildLineartPrompt(coreIdea: string, elements: string[]): string {
  const items = elements.map((e) => e.trim()).filter(Boolean);
  return [
    LINEART_STYLE_PROMPT,
    `画面内容：${coreIdea.trim()}。`,
    items.length > 0 ? `必须出现的元素：${items.join("、")}。` : "",
    "16:9 横向构图，主体居中偏上，四边保留充足留白。",
  ].filter(Boolean).join("\n");
}
