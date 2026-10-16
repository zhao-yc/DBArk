import { readTableComment, assertTableCommentUnchanged, type TableCommentRead } from './tableCommentRead';
import { createHash } from 'node:crypto';
import { structureTaskQuery, structureDocumentOf, type StructureTaskContext } from './structureDefinition';
import { tableDefinitionTokens } from './tableColumnDefinition';
import type { TableDefinitionContext } from '../shared/tableColumnPatches';
import type { TableRenameTarget } from '../shared/tableRename';

const literal = (value: string) => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;

export type RenamePermissionPhase = 'get' | 'execute' | 'verify';
/** get只证明来源可操作；明确目标后才证明两端写权限，verify仅证明完整目录读取。未知授权均不扩大能力。 */
export function proveRenamePrivileges(grants: readonly string[], target: TableRenameTarget, mode: TableDefinitionContext, newName?: string, phase: RenamePermissionPhase = newName === undefined ? 'get' : 'execute'): boolean {
  const global = new Set<string>(), source = new Set<string>(), destination = new Set<string>();
  for (const grant of grants) {
    const tokens = tableDefinitionTokens(grant, mode), word = (i: number) => tokens[i]?.kind === 'word' ? tokens[i].value.toUpperCase() : '';
    if (word(0) !== 'GRANT' || tokens.some(token => token.kind === 'executable')) return false;
    const on = tokens.findIndex((_, i) => word(i) === 'ON'), to = tokens.findIndex((_, i) => i > on && word(i) === 'TO');
    if (on < 0 || to < 0) return false;
    const scope = tokens.slice(on + 1, to);
    if (scope.length !== 3 || scope[1].value !== '.') continue;
    const star = (i: number) => scope[i].kind === 'symbol' && scope[i].value === '*';
    const name = (i: number) => ['identifier', 'word'].includes(scope[i].kind) ? scope[i].value : undefined;
    const all = star(0) && star(2), db = name(0) === target.database;
    const sets = [all ? global : undefined, all || db && (star(2) || name(2) === target.table) ? source : undefined, all || db && (star(2) || name(2) === newName) ? destination : undefined].filter((value): value is Set<string> => !!value);
    const privileges: string[][] = [[]];
    for (const token of tokens.slice(1, on)) {
      if (token.kind === 'symbol' && token.value === ',') privileges.push([]);
      else privileges.at(-1)!.push(token.kind === 'word' ? token.value.toUpperCase() : token.value);
    }
    for (const part of privileges) {
      const value = part.join(' ');
      if (!['ALL', 'ALL PRIVILEGES', 'SELECT', 'SHOW VIEW', 'TRIGGER', 'ALTER', 'DROP', 'CREATE', 'INSERT'].includes(value)) continue;
      for (const set of sets) if (value === 'ALL' || value === 'ALL PRIVILEGES') for (const id of ['SELECT', 'SHOW VIEW', 'TRIGGER', 'ALTER', 'DROP', 'CREATE', 'INSERT']) set.add(id); else set.add(value);
    }
  }
  const visible = ['SELECT', 'SHOW VIEW', 'TRIGGER'].every(value => global.has(value));
  // 读取能力始终保留；后核验不附加新表写权限，get也不能把未知新名称偷换成来源。
  if (phase === 'verify') return visible;
  const sourceWritable = ['ALTER', 'DROP'].every(value => source.has(value));
  if (phase === 'get') return visible && sourceWritable;
  return visible && sourceWritable && newName !== undefined && ['CREATE', 'INSERT'].every(value => destination.has(value));
}

/** 原授权可能含认证信息，只在本地内存解析，不记录、不返回、不进入快照。 */
async function privileges(context: StructureTaskContext, target: TableRenameTarget, mode: TableDefinitionContext, newName: string | undefined, phase: RenamePermissionPhase): Promise<boolean> {
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SHOW GRANTS')).rows;
  if (!Array.isArray(rows) || rows.length > 256) return false;
  const grants: string[] = []; let bytes = 0;
  for (const row of rows) {
    const values = Object.values(row); if (values.length !== 1 || typeof values[0] !== 'string') return false;
    bytes += Buffer.byteLength(values[0]); if (bytes > 512 * 1024) return false; grants.push(values[0]);
  }
  try { return proveRenamePrivileges(grants, target, mode, newName, phase); } catch { return false; }
}

/** 首批不改写依赖：完整可见的外键、触发器、视图引用必须均为空；未知目录只能查看。 */
export async function readTableRename(context: StructureTaskContext, target: TableRenameTarget, newName?: string, phase: RenamePermissionPhase = newName === undefined ? 'get' : 'execute'): Promise<TableCommentRead> {
  const read = await readTableComment(context, target), reasons = [...read.reasons];
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(read.serverVersion);
  const supported = read.context.dialect === 'mysql' && !!version && (version[1] === '8' && (version[2] === '4' || version[2] === '0' && Number(version[3]) >= 30));
  if (!supported) reasons.push('首批重命名仅开放MySQL 8.0.30及以上8.0版本、8.4；其他版本的依赖与身份范围尚未证明，仅可查看');
  // CHECK自动命名可能随表名改变，不能把它误记为只有表名变化。
  if (structureDocumentOf(read).items.some(item => item.kind === 'constraint' && tableDefinitionTokens(item.raw, read.context).some(token => token.kind === 'word' && token.value.toUpperCase() === 'CHECK'))) reasons.push('首批不处理CHECK约束自动命名，当前仅可查看');
  if (supported) {
    try {
      if (!await privileges(context, target, read.context, newName, phase)) throw new Error(phase === 'verify' ? '无法证明全局SELECT、SHOW VIEW、TRIGGER目录可见性；后核验未完成' : phase === 'get' ? '无法证明来源ALTER/DROP及全局SELECT、SHOW VIEW、TRIGGER目录可见性；角色或部分撤销尚不展开，当前只读' : '无法证明来源ALTER/DROP、目标CREATE/INSERT及全局SELECT、SHOW VIEW、TRIGGER目录可见性；当前只读');
      const path = literal(target.database + '/' + target.table), db = literal(target.database), table = literal(target.table);
      const foreign = (await structureTaskQuery<unknown[]>(context, `SELECT ID FROM information_schema.INNODB_FOREIGN WHERE CAST(FOR_NAME AS BINARY)=CAST(${path} AS BINARY) OR CAST(REF_NAME AS BINARY)=CAST(${path} AS BINARY) LIMIT 1`)).rows;
      if (foreign.length) reasons.push('目标存在入向或出向外键；首批不重构关联约束，仅可查看');
      const triggers = (await structureTaskQuery<unknown[]>(context, `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE CAST(EVENT_OBJECT_SCHEMA AS BINARY)=CAST(${db} AS BINARY) AND CAST(EVENT_OBJECT_TABLE AS BINARY)=CAST(${table} AS BINARY) LIMIT 1`)).rows;
      if (triggers.length) reasons.push('目标存在触发器；首批不重构触发器依赖，仅可查看');
      const views = (await structureTaskQuery<unknown[]>(context, `SELECT VIEW_NAME FROM information_schema.VIEW_TABLE_USAGE WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(${db} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${table} AS BINARY) LIMIT 1`)).rows;
      if (views.length) reasons.push('目标被视图引用；首批不重写视图，仅可查看');
    } catch (error) { context.checkCancelled(); reasons.push(error instanceof Error ? error.message : '依赖目录无法完整证明，当前只读'); }
  }
  return { ...read, reasons };
}

/** 来源完整定义、物理编号、服务器与模式仍须严格相同，摘要不替代物理身份。 */
export function assertTableRenameUnchanged(before: TableCommentRead, after: TableCommentRead): void {
  if (after.reasons.length) throw new Error(after.reasons.join('；') + '；未发送DDL');
  assertTableCommentUnchanged(before, after);
}

/** 只有引擎已核验的服务器身份与原生表编号可组成名称回收凭证，不使用名称或DDL摘要代替物理身份。 */
export function tableRenamePhysicalIdentity(read: Pick<TableCommentRead, 'identity' | 'tableId'>): string {
  if (!/^[a-f0-9]{64}$/.test(read.identity) || !read.tableId || !/^[1-9][0-9]{0,19}$/.test(read.tableId)) throw new Error('缺少可证明的重命名物理身份');
  return createHash('sha256').update(JSON.stringify([read.identity, read.tableId])).digest('hex');
}

/** 全局目录可见性已证明后检查真实同库表或视图；执行前还会再次检查。 */
export async function assertRenameDestinationAbsent(context: StructureTaskContext, target: TableRenameTarget, name: string): Promise<void> {
  const rows = (await structureTaskQuery<unknown[]>(context, `SELECT TABLE_NAME FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${literal(name)} AS BINARY) LIMIT 1`)).rows;
  if (rows.length) throw new Error('新表名已被真实表或视图占用；未发送DDL，不会覆盖或自动改名');
}
