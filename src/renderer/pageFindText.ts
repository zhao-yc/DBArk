/** 只引用既有字符串的区间；预算通过之前不slice、join或编码捕获展开文本。 */
export interface PageTextSpan { value: string; start: number; end: number; }

/** 精确累计最终文字的UTF-16长度、UTF-8字节和JSON字符串内容字节，不分配编码数组。 */
export class PageTextSize {
  units = 0;
  utf8 = 0;
  json = 0;
  private last = -1;
  /** 片段边界也可能拼成代理对，不能把两个孤立代理分别编码/转义后直接相加。 */
  append({ value, start, end }: PageTextSpan): void {
    if (start === end) return;
    const first = value.charCodeAt(start);
    if (this.last >= 0xd800 && this.last <= 0xdbff && first >= 0xdc00 && first <= 0xdfff) { this.utf8 -= 2; this.json -= 8; }
    this.units += end - start;
    for (let index = start; index < end; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff && index + 1 < end && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { this.utf8 += 4; this.json += 4; index++; }
      else {
        const bytes = code < 128 ? 1 : code < 2048 ? 2 : 3; this.utf8 += bytes;
        this.json += code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code) ? 2 : code < 32 || (code >= 0xd800 && code <= 0xdfff) ? 6 : bytes;
      }
    }
    this.last = value.charCodeAt(end - 1);
  }
}

/** 仅在整份计划预检通过后构造结果；分块限制中间引用数组，不创建逐字符巨型数组。 */
export function joinPageText(spans: Iterable<PageTextSpan>): string {
  const chunks: string[] = []; let parts: string[] = [], units = 0;
  for (const { value, start, end } of spans) {
    if (start === end) continue;
    parts.push(value.slice(start, end)); units += end - start;
    if (units >= 65536 || parts.length >= 256) { chunks.push(parts.join('')); parts = []; units = 0; }
  }
  if (parts.length) chunks.push(parts.join(''));
  return chunks.join('');
}
