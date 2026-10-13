import type { ResultExportData } from './contracts';

export const resultExportLimits = { rows: 100000, columns: 1024, cells: 2000000, fieldBytes: 256 * 1024, rowBytes: 1024 * 1024, bytes: 32 * 1024 * 1024 } as const;
const encoder = new TextEncoder();

/** 只接受 IPC 普通数据对象，检查自有键以保护合法的原型同名列。 */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
/** 拒绝未约定字段，不能把任意路径或查询正文夹入导出数据。 */
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value); return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
/** 逐字段计量序列化预算，不构造第二份完整结果或整表 JSON 字符串。 */
export function validateResultExportData(value: unknown): asserts value is ResultExportData {
  if (!record(value) || !exactKeys(value, ['columns', 'rows', 'truncated']) || typeof value.truncated !== 'boolean' || !Array.isArray(value.columns) || !Array.isArray(value.rows)) throw new Error('结果导出数据格式无效');
  if (!value.columns.length || value.columns.length > resultExportLimits.columns) throw new Error('结果导出需要 1～1024 列');
  if (value.rows.length > resultExportLimits.rows || value.rows.length * value.columns.length > resultExportLimits.cells) throw new Error('结果导出不能超过 100000 行或 2000000 个单元格');
  let bytes = 32; const keys = new Set<string>(); const keyBytes = new Map<string, number>();
  for (const column of value.columns) {
    if (!record(column) || !exactKeys(column, ['key', 'name']) || typeof column.key !== 'string' || !column.key.length || column.key.length > 256 || typeof column.name !== 'string' || column.name.length > 1024) throw new Error('导出列的键或名称无效');
    if (keys.has(column.key)) throw new Error('结果内部列键不能重复，请重新执行查询');
    keys.add(column.key); keyBytes.set(column.key, encoder.encode(JSON.stringify(column.key)).byteLength + 2);
    bytes += encoder.encode(JSON.stringify(column)).byteLength + 1;
  }
  for (const row of value.rows) {
    if (!record(row) || Object.keys(row).length !== keys.size) throw new Error('结果行必须精确包含所有导出列，不允许缺失或额外字段');
    let rowBytes = 3;
    for (const key of keys) {
      if (!Object.hasOwn(row, key)) throw new Error('结果行必须精确包含所有导出列，不允许缺失或额外字段');
      const cell = row[key]; let text: string;
      if (typeof cell === 'string') {
        if (cell.length > resultExportLimits.fieldBytes) throw new Error('单个导出字段不能超过 256 KiB');
        text = JSON.stringify(cell);
      } else if (cell === null || typeof cell === 'boolean' || (typeof cell === 'number' && Number.isFinite(cell) && (!Number.isInteger(cell) || Number.isSafeInteger(cell)))) text = JSON.stringify(cell);
      else if (record(cell) && exactKeys(cell, ['type', 'base64']) && cell.type === 'binary' && typeof cell.base64 === 'string' && cell.base64.length <= resultExportLimits.fieldBytes && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(cell.base64)) text = JSON.stringify(cell);
      else throw new Error('导出单元格类型无效；大整数必须使用精确字符串，二进制必须使用 Base64 对象');
      const fieldBytes = encoder.encode(text).byteLength;
      if (fieldBytes > resultExportLimits.fieldBytes) throw new Error('单个导出字段不能超过 256 KiB');
      rowBytes += keyBytes.get(key)! + fieldBytes;
      if (rowBytes > resultExportLimits.rowBytes) throw new Error('单行导出数据不能超过 1 MiB');
    }
    bytes += rowBytes;
    if (bytes > resultExportLimits.bytes) throw new Error('已返回结果超过 32 MiB 导出预算，请减少查询返回的数据');
  }
}

/** 保留首个非空标题；重名或空名使用列位置后缀，并避开所有原始标题及已分配标题。 */
export function resultExportColumns(columns: ResultExportData['columns']): { key: string; name: string; exportName: string }[] {
  const reserved = new Set(columns.map(column => column.name)); const used = new Set<string>();
  return columns.map((column, index) => {
    let exportName = column.name;
    if (!exportName || used.has(exportName)) {
      let suffix = index + 1; const base = column.name || '列';
      do { exportName = `${base} [${suffix++}]`; } while (reserved.has(exportName) || used.has(exportName));
    }
    used.add(exportName); return { ...column, exportName };
  });
}
