import type { SqlFileImportLocation } from '../shared/sqlFileImport';

type Point = SqlFileImportLocation['start'];
interface Cursor { point: Point; afterCR: boolean; }
/** 按UTF-16码元推进；CRLF跨块仍只算一次换行，列号不按Unicode码点折算。 */
function advance(cursor: Cursor, text: string): Cursor {
  const point = { ...cursor.point }; let afterCR = cursor.afterCR;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]; point.offset++;
    if (char === '\r') { point.line++; point.column = 1; }
    else if (char === '\n') { if (!afterCR) point.line++; point.column = 1; }
    else point.column++;
    afterCR = char === '\r';
  }
  return { point, afterCR };
}

/** 只保留scanner尚需的有界源块；不复制整文件、不建立随行数增长的位置索引。 */
export class SqlFileImportPositions {
  private chunks: string[] = [];
  private buffered = 0;
  private base: Cursor = { point: { offset: 0, line: 1, column: 1 }, afterCR: false };
  constructor(private readonly limit = 65 * 1024 * 1024) {}
  /** 接收与scanner完全相同的去BOM解码块，不另行读取文件或保留全量行索引。 */
  append(chunk: string): void {
    if (!chunk) return;
    this.chunks.push(chunk); this.buffered += chunk.length;
    if (this.buffered > this.limit) this.drop(this.buffered);
  }
  /** 消费已执行范围之前的文本，普通多语句文件不会反复扫描整个尾窗。 */
  discardBefore(offset: number): void {
    if (Number.isSafeInteger(offset) && offset > this.base.point.offset) this.drop(Math.min(this.buffered, offset - this.base.point.offset));
  }
  /** 原scanner范围必须仍在窗口内且端点有序；未知范围直接缺省。 */
  locate(range?: { start: number; end: number }): SqlFileImportLocation | undefined {
    if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < this.base.point.offset || range.end < range.start || range.end > this.base.point.offset + this.buffered) return;
    this.discardBefore(range.start); const start = { ...this.base.point };
    this.discardBefore(range.end); return { start, end: { ...this.base.point } };
  }
  /** 丢弃窗口前缀时只保存一个位置及CR状态，内存与总文件行数无关。 */
  private drop(count: number): void {
    while (count > 0 && this.chunks.length) {
      const chunk = this.chunks[0], consumed = Math.min(count, chunk.length);
      this.base = advance(this.base, consumed === chunk.length ? chunk : chunk.slice(0, consumed));
      if (consumed === chunk.length) this.chunks.shift(); else this.chunks[0] = chunk.slice(consumed);
      this.buffered -= consumed; count -= consumed;
    }
  }
}
