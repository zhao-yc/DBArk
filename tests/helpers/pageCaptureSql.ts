import { isDeepStrictEqual } from 'node:util';

export interface CaptureSqlChange { id: string; before: string; after: string; }

// 仅接受本片两列/六列夹具；显式保留历史重复id布局，不扩展为通用SQL解析器。
const noteBinding = /^`note`\s*=\s*\?\s+WHERE\s+`id`\s*<=>\s*\?(?<duplicate>\s+AND\s+`id`\s*<=>\s*\?)?\s+AND\s+BINARY\s+CONVERT\(`note`\s+USING\s+utf8mb4\)\s*<=>\s*BINARY\s+CONVERT\(\?\s+USING\s+utf8mb4\)(?<tail>.*)$/u;
const protectedBinding = /^\s+AND\s+`amount`\s*<=>\s*\?\s+AND\s+`payload`\s*<=>\s*\?\s+AND\s+BINARY\s+CONVERT\(`nil`\s+USING\s+utf8mb4\)\s*<=>\s*BINARY\s+CONVERT\(\?\s+USING\s+utf8mb4\)\s+AND\s+BINARY\s+CONVERT\(`generated`\s+USING\s+utf8mb4\)\s*<=>\s*BINARY\s+CONVERT\(\?\s+USING\s+utf8mb4\)\s*$/u;

/** 核对固定模板的完整渲染与各字段绑定；未知列、操作符、条件或参数位置均继续等待。 */
export function completeCaptureSql(rendered: string, database: string, table: string, expected: readonly CaptureSqlChange[]): boolean {
  if (!expected.length || !/^[a-z0-9_]+$/u.test(database) || !['capture_batch', 'capture_current', 'capture_unicode'].includes(table)) return false;
  // Monaco的软换行不是SQL/JSON内容；原JSON字符串中的换行已由JSON.stringify转义。
  const flat = rendered.replace(/\u00a0/gu, ' ').replace(/[\r\n]/gu, ''), prefix = `UPDATE \`${database}\`.\`${table}\` SET `;
  const chunks = flat.split(prefix); if (chunks.length !== expected.length + 1 || chunks[0].trim()) return false;
  const remaining = new Map(expected.map(change => [change.id, change])); if (remaining.size !== expected.length) return false;
  for (const chunk of chunks.slice(1)) {
    const marker = /;\s*--\s*参数：/u.exec(chunk); if (!marker) return false;
    const statement = chunk.slice(0, marker.index), binding = noteBinding.exec(statement); if (!binding?.groups) return false;
    if (table === 'capture_unicode' ? !protectedBinding.test(binding.groups.tail) : binding.groups.tail.trim() !== '') return false;
    let params: unknown; try { params = JSON.parse(chunk.slice(marker.index + marker[0].length)); } catch { return false; }
    if (!Array.isArray(params) || params.length !== (statement.match(/\?/gu)?.length ?? 0)) return false;
    const change = typeof params[1] === 'string' && remaining.get(params[1]);
    if (!change) return false;
    // 参数顺序对应上方静态谓词：after、精确id、可选重复id、note原值，不能只检查值曾出现。
    const values: unknown[] = [change.after, change.id, ...(binding.groups.duplicate ? [change.id] : []), change.before];
    // 六列夹具的旁列原值也是固定协议数据；BLOB按结构比较，不依赖对象键的序列化顺序。
    if (table === 'capture_unicode') values.push('12345678901234567890.123456', { type: 'binary', base64: 'AAH/' }, null, change.before);
    if (!isDeepStrictEqual(params, values)) return false;
    remaining.delete(change.id);
  }
  return remaining.size === 0;
}
