/** Shared carousel rules. They guide prompts; they do not add analysis calls. */
export const minimumPostPages = 6;
const roles = [
  ['封面吸引', '用完整商品外观与鲜明场景建立第一眼吸引力，主体突出'],
  ['场景代入', '展示目标人群在期望场景中使用或穿着商品的自然状态'],
  ['核心卖点', '用与前页不同的角度、姿态或景别，直观展示一个有依据的核心卖点'],
  ['细节依据', '近景呈现原图可见的结构、纹理或做工，不虚构看不见的细节'],
  ['使用延展', '切换到互补的使用场景或搭配方式，避免重复前页画面'],
  ['收尾种草', '用完整商品与场景关系收束整组，留下清晰的商品记忆'],
] as const;
export function postPageRole(index: number, count: number) {
  if (index === count - 1) return roles[5];
  if (index < 5) return roles[index];
  return [`延展展示 ${index - 4}`, `补充第 ${index - 4} 个不同的使用情境、视角或已知卖点，不重复已安排的画面`] as const;
}
/** Spread a shorter template across the set, keeping its original narrative order. */
export function expandPostPages(pages: {title: string; prompt: string}[], count: number) {
  return Array.from({length: count}, (_, i) => {
    const sourceIndex = pages.length ? Math.min(pages.length - 1, Math.floor(i * pages.length / count)) : -1;
    const page = pages[sourceIndex];
    if (!page) return '';
    const segmentStart = Math.ceil(sourceIndex * count / pages.length);
    const segmentEnd = Math.ceil((sourceIndex + 1) * count / pages.length);
    return [`模板段落：${page.title || `第 ${sourceIndex + 1} 段`}。${page.prompt}`,
      segmentEnd - segmentStart > 1 ? `本段第 ${i - segmentStart + 1}/${segmentEnd - segmentStart} 张：${i === segmentStart ? '建立场景和商品整体关系' : '推进到互补角度、动作或可见细节，不重复本段前一张的构图'}。` : '',
    ].filter(Boolean).join('\n');
  });
}
export function postTextPolicy(noText?: boolean) {
  return noText
    ? '图片不加文字：仅生成摄影或视觉画面，不添加标题、字幕、卖点字、数字参数、标签、水印、标识或伪文字。此规则优先于模板与其他文案排版要求；商品本身可辨识的固有设计以商品原图为准。'
    : '画面文案仅使用已提供的商品信息，以简短中文呈现，保持清晰排版和安全边距；不虚构价格、参数、销量、功效、优惠或承诺。';
}
