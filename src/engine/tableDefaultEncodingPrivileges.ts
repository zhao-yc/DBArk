import { tableDefinitionTokens } from './tableColumnDefinition';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import type { TableDefaultEncodingTarget } from '../shared/tableDefaultEncoding';
import type { TableDefinitionContext } from '../shared/tableColumnPatches';

/** 只证明直接全局/精确库/精确表ALTER；不展开角色、通配库名、部分撤销或陌生语法。 */
export function proveTableDefaultEncodingAlter(grants: readonly string[], target: Pick<TableDefaultEncodingTarget, 'database' | 'table'>, context: TableDefinitionContext): boolean {
  let allowed = false;
  for (const grant of grants) {
    const tokens = tableDefinitionTokens(grant, context), word = (index: number) => tokens[index]?.kind === 'word' ? tokens[index].value.toUpperCase() : '';
    if (tokens.some(token => token.kind === 'executable') || word(0) !== 'GRANT') return false;
    const on = tokens.findIndex(token => token.kind === 'word' && token.value.toUpperCase() === 'ON');
    // 无ON的GRANT可能是角色授权，本批不把它当作已经证明的直接写权限。
    if (on < 0) return false;
    const to = tokens.findIndex((token, index) => index > on && token.kind === 'word' && token.value.toUpperCase() === 'TO');
    if (to < 0) return false;
    const scope = tokens.slice(on + 1, to);
    if (scope.length !== 3 || scope[1].value !== '.') continue;
    const name = (index: number) => ['word', 'identifier'].includes(scope[index].kind) ? scope[index].value : undefined;
    const wildcard = (index: number) => scope[index].kind === 'symbol' && scope[index].value === '*';
    const database = name(0), table = name(2);
    // 被引用的`*`是名称，不能偷换成全局/库范围通配授权。
    const matches = wildcard(0) && wildcard(2) || database === target.database && wildcard(2) || database === target.database && table === target.table;
    if (!matches) continue;
    const parts: string[][] = [[]]; let depth = 0;
    for (const token of tokens.slice(1, on)) {
      if (token.value === '(') depth++; if (token.value === ')') depth--;
      if (!depth && token.kind === 'symbol' && token.value === ',') parts.push([]);
      else parts.at(-1)!.push(token.kind === 'word' ? token.value.toUpperCase() : token.value);
    }
    if (parts.some(part => part.length === 1 && ['ALTER', 'ALL'].includes(part[0]) || part.length === 2 && part[0] === 'ALL' && part[1] === 'PRIVILEGES')) allowed = true;
  }
  return allowed;
}
/** SHOW GRANTS可能含认证片段，仅在内存判断前缀；不缓存、哈希、返回或记录原授权文本。 */
export async function readTableDefaultEncodingAlter(context: StructureTaskContext, target: TableDefaultEncodingTarget, mode: TableDefinitionContext): Promise<boolean> {
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SHOW GRANTS')).rows;
  if (!Array.isArray(rows) || rows.length > 256) return false;
  const grants: string[] = []; let bytes = 0;
  for (const row of rows) {
    const values = Object.values(row); if (values.length !== 1 || typeof values[0] !== 'string' || values[0].length > 65536) return false;
    bytes += Buffer.byteLength(values[0]); if (bytes > 512 * 1024) return false; grants.push(values[0]);
  }
  try { return proveTableDefaultEncodingAlter(grants, target, mode); } catch { return false; }
}
