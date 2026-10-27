export type TableDraftProcesslistSource = 'performance_schema.processlist' | 'information_schema.PROCESSLIST';
export interface TableDraftProcesslistPolicy { readonly source: TableDraftProcesslistSource; readonly warningMode: 'zero' | 'mysql8-deprecated'; }
export type TableDraftProcesslistRequest = { kind: 'ids'; ids: number[] } | { kind: 'database'; database: string } | { kind: 'collect'; database: string; excludeId: number };
export const tableDraftProcesslistDeprecation = "'INFORMATION_SCHEMA.PROCESSLIST' is deprecated and will be removed in a future release. Please use performance_schema.processlist instead";

/** 容器只读取自有数据描述符；告警回包中的访问器或额外字段均不能获得例外。 */
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('草稿审计回包结构无效');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) throw Error('草稿审计回包字段无效');
  return Object.fromEntries(names.map(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw Error('草稿审计不能读取继承字段或访问器'); return [key, descriptor.value]; }));
}

/** 稠密行数组不能夹带额外属性或继承索引。 */
function rows(value: unknown, count?: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || count !== undefined && value.length !== count || Reflect.ownKeys(value).length !== value.length + 1) throw Error('草稿审计行集合无效');
  for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw Error('草稿审计行集合包含空洞或访问器'); }
  return value;
}

/** 先核真实版本；是否读取P_S能力只由本轮已验证的MySQL8组合决定。 */
export function tableDraftProcesslistNeedsCapability(dialect: 'mysql' | 'mariadb', version: string): boolean {
  if (typeof version !== 'string') throw Error('草稿审计缺少已核实的数据库版本');
  const core = version.replace(/^5\.5\.5-/, '').split(/[-+]/)[0];
  if (dialect === 'mysql' && ['8.0.46', '8.4.11'].includes(core)) return true;
  if ((dialect === 'mysql' && core === '5.7.44') || (dialect === 'mariadb' && ['10.11.19', '11.4.13'].includes(core))) return false;
  throw Error('草稿审计数据库组合尚未验证，未声明资源核零');
}

/** P_S关闭是显式能力事实，不以空表或失败重试触发降级；不修改任何服务器变量。 */
export function selectTableDraftProcesslist(dialect: 'mysql' | 'mariadb', version: string, capabilityRows?: unknown): TableDraftProcesslistPolicy {
  if (!tableDraftProcesslistNeedsCapability(dialect, version)) { if (capabilityRows !== undefined) throw Error('旧版本草稿审计不接受额外能力覆盖'); return Object.freeze({ source: 'information_schema.PROCESSLIST', warningMode: 'zero' }); }
  const capability = fields(rows(capabilityRows, 1)[0], ['enabled']).enabled;
  if (capability === 1 || capability === '1') return Object.freeze({ source: 'performance_schema.processlist', warningMode: 'zero' });
  if (capability === 0 || capability === '0') return Object.freeze({ source: 'information_schema.PROCESSLIST', warningMode: 'mysql8-deprecated' });
  throw Error('草稿审计P_S能力值未知');
}

/** 只允许固定两表与显式诊断模式，不提供任意SQL或忽略告警开关。 */
function policy(value: TableDraftProcesslistPolicy): TableDraftProcesslistPolicy {
  const checked = fields(value, ['source', 'warningMode']);
  if (!['performance_schema.processlist', 'information_schema.PROCESSLIST'].includes(checked.source as string) || !['zero', 'mysql8-deprecated'].includes(checked.warningMode as string) || checked.source === 'performance_schema.processlist' && checked.warningMode !== 'zero') throw Error('草稿审计来源或诊断模式无效');
  return checked as unknown as TableDraftProcesslistPolicy;
}

/** 专用读请求生成受控SQL，调用方不能按SQL模糊模式给普通查询放开例外。 */
export function tableDraftProcesslistQuery(selected: TableDraftProcesslistPolicy, request: TableDraftProcesslistRequest): { sql: string; values: (string | number)[] } {
  const source = policy(selected).source;
  const id = (value: unknown): number => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw Error('草稿审计线程编号无效'); return value; };
  const descriptor = request && typeof request === 'object' ? Object.getOwnPropertyDescriptor(request, 'kind') : undefined;
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw Error('草稿审计用途必须是自有数据字段');
  const kind = descriptor.value;
  if (kind === 'ids') {
    const input = fields(request, ['kind', 'ids']), ids = rows(input.ids);
    if (!ids.length || ids.length > 10000) throw Error('草稿审计线程集合为空或过大');
    return { sql: 'SELECT ID FROM ' + source + ' WHERE ID IN (' + ids.map(() => '?').join(',') + ')', values: ids.map(id) };
  }
  if (kind !== 'database' && kind !== 'collect') throw Error('草稿审计请求用途无效');
  const input = fields(request, kind === 'database' ? ['kind', 'database'] : ['kind', 'database', 'excludeId']);
  if (typeof input.database !== 'string' || !input.database || input.database.length > 256 || input.database.includes('\0')) throw Error('草稿审计准确数据库无效');
  if (kind === 'database') return { sql: 'SELECT ID FROM ' + source + ' WHERE CAST(DB AS BINARY)=CAST(? AS BINARY)', values: [input.database] };
  if (kind === 'collect') return { sql: 'SELECT ID FROM ' + source + ' WHERE ID<>? AND (CAST(DB AS BINARY)=CAST(? AS BINARY) OR INFO LIKE ?)', values: [id(input.excludeId), input.database, '%' + input.database + '%'] };
  throw Error('草稿审计请求用途无效');
}

/** 审计来源必须能看见当前原观察连接，禁止把空目录或权限盲区当作资源零。 */
export function assertTableDraftProcesslistVisible(rows: unknown, ownId: number): void {
  if (!Number.isSafeInteger(ownId) || ownId < 1 || !Array.isArray(rows) || rows.length !== 1) throw Error('草稿审计原观察线程不可见或不唯一');
  const row = Object.getOwnPropertyDescriptor(rows, '0')?.value;
  const descriptor = row && typeof row === 'object' && !Array.isArray(row) ? Object.getOwnPropertyDescriptor(row, 'ID') : undefined;
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || Reflect.ownKeys(row).length !== 1 || ![ownId, String(ownId)].includes(descriptor.value)) throw Error('草稿审计原观察线程标识不符');
}

/** 原命令之后同时检查准确告警计数和原诊断列表，不允许忽略已弃用语法告警。 */
export function assertTableDraftNoWarnings(countRows: unknown, warningRows: unknown): void {
  const count = fields(rows(countRows, 1)[0], ['@@session.warning_count'])['@@session.warning_count'];
  rows(warningRows, 0);
  if (count !== 0 && count !== '0') throw Error('草稿观察命令原告警计数不为零或未知');
}

/** 仅经显式P_S关闭选择的专用PROCESSLIST读允许这一条逐字已知1287，任何其它诊断拒绝。 */
export function assertTableDraftProcesslistWarnings(selected: TableDraftProcesslistPolicy, countRows: unknown, warningRows: unknown): void {
  if (policy(selected).warningMode === 'zero') { assertTableDraftNoWarnings(countRows, warningRows); return; }
  const count = fields(rows(countRows, 1)[0], ['@@session.warning_count'])['@@session.warning_count'];
  const warning = fields(rows(warningRows, 1)[0], ['Level', 'Code', 'Message']);
  if ((count !== 1 && count !== '1') || warning.Level !== 'Warning' || warning.Code !== 1287 || warning.Message !== tableDraftProcesslistDeprecation) throw Error('草稿PROCESSLIST诊断与已核实的唯一弃用告警不符');
}
