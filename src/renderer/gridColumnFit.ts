import { tablePreferencesLimits } from '../shared/tablePreferences';

export interface GridColumnFitSource {
  columns: readonly { key: string; name: string; type?: string }[];
  rowCount: number;
  cell(row: number, key: string): string;
}

/** 按实际界面字体测量，保留列头和正文的字号差异。 */
function browserMeasure() {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw Error('当前环境无法测量列宽');
  const family = getComputedStyle(document.documentElement).fontFamily || 'sans-serif';
  let previous: boolean | undefined;
  return (text: string, header: boolean) => {
    if (previous !== header) {
      context.font = header ? `600 11px ${family}` : `11px ${family}`;
      previous = header;
    }
    return context.measureText(text).width;
  };
}

/** 均匀抽取最多 64 个已载入行，测量预览文本，且不遍历隐藏列。 */
export function fitGridColumnWidths(source: GridColumnFitSource, keys: ReadonlySet<string>, measure = browserMeasure()): Map<string, number> {
  const fitted = new Map<string, number>();
  const sampleCount = Math.min(64, source.rowCount, Math.max(1, Math.floor(8192 / keys.size)));
  const max = 640;
  const preview = (text: string) => text.slice(0, 240).replace(/\s+/gu, ' ').trim();
  for (const column of source.columns) {
    if (!keys.has(column.key)) continue;
    let width = Math.max(measure(preview(column.name), true), measure(preview(column.type ?? ''), false)) + 44;
    for (let index = 0; index < sampleCount && width < max; index++) {
      const row = sampleCount === 1 ? 0 : Math.round(index * (source.rowCount - 1) / (sampleCount - 1));
      width = Math.max(width, measure(preview(source.cell(row, column.key)), false) + 28);
    }
    fitted.set(column.key, Math.max(tablePreferencesLimits.minWidth, Math.min(max, Math.ceil(width))));
  }
  return fitted;
}
