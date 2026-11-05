export const queryResultFrequencyLimits = Object.freeze({ entries: 10, previewPoints: 80 });
export type QueryResultFrequencyKind = 'number' | 'text' | 'temporal' | 'blob' | 'boolean';
export interface QueryResultFrequencyEntry {
  readonly label: string;
  readonly kind: QueryResultFrequencyKind;
  readonly count: number;
  readonly truncated: boolean;
}
export interface QueryResultFrequency {
  readonly entries: readonly QueryResultFrequencyEntry[];
  readonly otherValues: number;
  readonly otherRows: number;
}
interface CountedValue { preview: string; kind: QueryResultFrequencyKind; count: number; truncated: boolean; rowIndex: number; }
const representativeRows = new WeakMap<QueryResultFrequencyEntry, number>();

/** 筛选定位到首个真实原格，展示文本仅用于阅读。 */
export function queryResultFrequencyRow(entry: QueryResultFrequencyEntry): number | undefined {
  return representativeRows.get(entry);
}

/** 只保留有界预览，去重键仍用统计扫描器已核过的完整、带类型原值。 */
function preview(value: string): { preview: string; truncated: boolean } {
  let output = '', count = 0;
  for (const point of value) {
    if (count++ === queryResultFrequencyLimits.previewPoints) return { preview: output, truncated: true };
    output += point;
  }
  return { preview: output, truncated: false };
}

/** 空文本和不可见字符明确显示；仅转义展示，不参与值身份或任何SQL。 */
function label(value: CountedValue): string {
  const visible = (value.kind === 'text' ? JSON.stringify(value.preview) : value.preview)
    .replace(/[\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
  return visible + (value.truncated ? '…' : '');
}

/** 扫描器只在明确请求分布时建立计数；已有行／单值／总原文预算保持。 */
export class QueryResultFrequencyCounter {
  private readonly values = new Map<string, CountedValue>();
  get distinct(): number { return this.values.size; }

  /** 同值保留首个代表值和出现次序，后续相同数值的不同写法只增加次数。 */
  add(key: string, literal: string, kind: QueryResultFrequencyKind, rowIndex: number): void {
    const existing = this.values.get(key);
    if (existing) existing.count++;
    else this.values.set(key, { ...preview(literal), kind, count: 1, rowIndex });
  }

  /** 只维护前10个位置，平次沿原结果首次出现顺序，完整计数再归入其它。 */
  result(expected: number): QueryResultFrequency {
    const top: CountedValue[] = [];
    let seen = 0;
    for (const value of this.values.values()) {
      seen += value.count;
      const before = top.findIndex(previous => value.count > previous.count);
      const index = before < 0 ? top.length : before;
      if (index >= queryResultFrequencyLimits.entries) continue;
      top.splice(index, 0, value);
      if (top.length > queryResultFrequencyLimits.entries) top.pop();
    }
    if (seen !== expected) throw Error('原值分布计数与非空行不一致');
    const entries = top.map(value => {
      const entry = Object.freeze({ label: label(value), kind: value.kind, count: value.count, truncated: value.truncated });
      representativeRows.set(entry, value.rowIndex);
      return entry;
    });
    return Object.freeze({ entries: Object.freeze(entries), otherValues: this.values.size - top.length, otherRows: seen - top.reduce((sum, value) => sum + value.count, 0) });
  }

  /** 原值异常、来源失效、取消和发布后均释放全部计数和预览。 */
  clear(): void { this.values.clear(); }
}
