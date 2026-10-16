export interface CaptureSqlChange { id: string; before: string; after: string; }

/** 只核对本片隔离夹具的完整UPDATE预览；缺行、参数尾部或占位符不一致都继续等待。 */
export function completeCaptureSql(rendered: string, database: string, table: string, expected: readonly CaptureSqlChange[]): boolean {
  if (!expected.length || !/^[a-z0-9_]+$/u.test(database) || !/^[a-z0-9_]+$/u.test(table)) return false;
  // Monaco的软换行不是SQL/JSON内容；原JSON字符串中的换行已由JSON.stringify转义。
  const flat = rendered.replace(/\u00a0/gu, ' ').replace(/[\r\n]/gu, ''), prefix = `UPDATE \`${database}\`.\`${table}\` SET `;
  const chunks = flat.split(prefix); if (chunks.length !== expected.length + 1 || chunks[0].trim()) return false;
  const remaining = new Map(expected.map(change => [change.id, change]));
  for (const chunk of chunks.slice(1)) {
    const marker = /;\s*--\s*参数：/u.exec(chunk); if (!marker) return false;
    const statement = chunk.slice(0, marker.index); if (!/^`note`\s*=\s*\?\s+WHERE\b/u.test(statement)) return false;
    let params: unknown; try { params = JSON.parse(chunk.slice(marker.index + marker[0].length)); } catch { return false; }
    if (!Array.isArray(params) || params.length !== (statement.match(/\?/gu)?.length ?? 0)) return false;
    const change = typeof params[1] === 'string' && remaining.get(params[1]);
    // 兼容ROOT可靠键去重前后的完整旧值谓词；不通过复制产品SQL生成器计算预期。
    if (!change || params[0] !== change.after || !params.includes(change.before)) return false;
    remaining.delete(change.id);
  }
  return remaining.size === 0;
}
