import type { DataRow, ResultColumn } from '../shared/contracts';
import { cellPreview, ownCell } from './lib';

export const queryResultFindLimits = { queryUnits: 256, chunkUnits: 8192, batchUnits: 32768, batchCells: 256, hits: 5000 } as const;
export interface QueryResultFindMatch { readonly row: number; readonly column: number; }
export type QueryResultFindPhase = 'searching' | 'complete' | 'limited' | 'invalid' | 'stopped';
export interface QueryResultFindProgress { phase: QueryResultFindPhase; count: number; scannedCells: number; totalCells: number; }

/** 只保留当前原文本引用和有限坐标；不复制行、不转数值、不解码完整二进制、不发请求。 */
export class QueryResultFindScan {
  private readonly keys: string[];
  private readonly rowCount: number;
  private readonly needle: string;
  private readonly matches: QueryResultFindMatch[] = [];
  private cursor = 0;
  private offset = 0;
  private text: string | undefined;
  private phase: QueryResultFindPhase;
  constructor(private readonly rows: DataRow[], private readonly columns: ResultColumn[], query: string, private readonly caseSensitive: boolean, private readonly isCurrent: () => boolean) {
    this.rowCount = rows.length; this.keys = columns.map(column => column.key);
    this.needle = query.length > queryResultFindLimits.queryUnits ? '' : caseSensitive ? query : query.toLowerCase();
    this.phase = query.length > queryResultFindLimits.queryUnits ? 'invalid' : query && rows.length && columns.length ? 'searching' : 'complete';
  }
  /** 首次观察到归属失效即永久撤销，恢复相等引用也不能复活旧查找。 */
  current(): boolean {
    if (this.phase === 'stopped') return false;
    try { if (!this.isCurrent() || this.rows.length !== this.rowCount || this.columns.length !== this.keys.length || this.keys.some((key, index) => this.columns[index].key !== key)) { this.cancel(); return false; } }
    catch { this.cancel(); return false; }
    return true;
  }
  /** 释放正在扫描的原文本及全部命中坐标，不修改源结果或业务选择。 */
  cancel(): void { this.phase = 'stopped'; this.text = undefined; this.matches.length = 0; }
  progress(): QueryResultFindProgress { this.current(); return { phase: this.phase, count: this.matches.length, scannedCells: this.cursor, totalCells: this.rowCount * this.keys.length }; }
  /** 每格一个命中，位置只在同一活代次有效；导航不能使用已撤销快照。 */
  match(index: number): QueryResultFindMatch | undefined { return this.current() && Number.isSafeInteger(index) && index >= 0 ? this.matches[index] : undefined; }
  /** 文本按原值分段，跨段重叠覆盖字面查询；每批字符/单元格均有硬上限。 */
  step(): QueryResultFindProgress {
    if (!this.current() || this.phase !== 'searching') return this.progress();
    let units = 0, cells = 0;
    const total = this.rowCount * this.keys.length;
    try {
      while (this.cursor < total && units < queryResultFindLimits.batchUnits && cells < queryResultFindLimits.batchCells) {
        if (!this.current()) break;
        const row = Math.floor(this.cursor / this.keys.length), column = this.cursor % this.keys.length;
        if (this.text === undefined) {
          const value = ownCell(this.rows[row], this.keys[column]);
          // NULL与空串保持显示语义；字符串含完整已返回原文；二进制只查有界显示预览。
          this.text = value && typeof value === 'object' ? cellPreview(value) : value === null ? 'NULL' : value === undefined ? '' : String(value);
        }
        const remaining = queryResultFindLimits.batchUnits - units;
        // 余量装不下下一完整主片时先让出，不为凑满批次处理越界；原offset留给下一批。
        if (Math.min(queryResultFindLimits.chunkUnits, this.text.length - this.offset) > remaining) break;
        const end = Math.min(this.text.length, this.offset + queryResultFindLimits.chunkUnits, this.offset + remaining);
        const piece = this.text.slice(this.offset, Math.min(this.text.length, end + this.needle.length));
        units += Math.max(1, end - this.offset);
        const found = (this.caseSensitive ? piece : piece.toLowerCase()).includes(this.needle);
        if (found) this.matches.push({ row, column });
        if (found || end === this.text.length) { this.cursor++; cells++; this.offset = 0; this.text = undefined; }
        else this.offset = end;
        if (this.matches.length >= queryResultFindLimits.hits) { this.phase = 'limited'; this.text = undefined; break; }
      }
      if (this.phase === 'searching' && this.cursor === total) this.phase = 'complete';
    } catch { this.cancel(); }
    return this.progress();
  }
}
