// 基于员工1独立RAM反例整理；只替换传输，不连接数据库。
import { EventEmitter } from 'node:events';
import { tableCreateAcknowledgements } from '../../src/shared/tableCreate';
import { TableCreateTasks } from '../../src/engine/tableCreateTasks';
const draft = (charset = 'utf8mb4'): any => ({ database: 'review_db', name: 'fresh_table', engine: 'InnoDB', charset, comment: '', columns: [{ name: 'id', type: 'int', nullable: false, autoIncrement: false, comment: '' }, { name: 's', type: 'char(255)', nullable: false, defaultValue: 'x', autoIncrement: false, comment: '' }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'ix', unique: false, keyParts: [{ columnName: 's', prefixLength: 5 }] }], foreignKeys: [] });
/** 所有查询仅由RAM端口返回明确合成行；未导入或创建mysql连接。 */
function fixture(charset = 'utf8mb4', collateShown = true, auxiliaryType?: string) {
  const state: any = { page: 16384, maxBytes: charset === 'latin1' ? 1 : 4, rowFormat: 'DYNAMIC', collation: charset === 'latin1' ? 'latin1_swedish_ci' : 'utf8mb4_bin', created: false, prefix: 5, showPrefix: 5, columnPatch: {}, tablePatch: {}, statisticsPatch: {}, queries: [] };
  const design = draft(charset);
  if (auxiliaryType) design.columns.push({ name: 'aux', type: auxiliaryType, nullable: false, autoIncrement: false, comment: '' });
  const ddl = () => "CREATE TABLE `fresh_table` (`id` int NOT NULL,`s` char(255) NOT NULL DEFAULT 'x'" + (auxiliaryType ? ',`aux` ' + auxiliaryType + ' NOT NULL' : '') + ',PRIMARY KEY (`id`),KEY `ix` (`s`' + (state.showPrefix === null ? '' : '(' + state.showPrefix + ')') + ')) ENGINE=InnoDB DEFAULT CHARSET=' + charset + (collateShown ? ' COLLATE=' + state.collation : '') + ' ROW_FORMAT=DYNAMIC';
  const answer = (sql: string): any => {
    state.queries.push(sql);
    if (sql.startsWith('SELECT @@hostname')) return [{ hostname: 'synthetic', port: 3306, serverId: 1, currentUser: 'synthetic@host', sqlMode: '', lowerNames: 0, charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
    if (sql.startsWith('SELECT @@server_uuid')) return [{ uuid: 'synthetic-uuid' }];
    if (sql.startsWith('SELECT SCHEMA_NAME')) return [{ name: 'review_db', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
    if (sql.startsWith('SELECT @@innodb_page_size')) return [{ pageSize: state.page, defaultRowFormat: state.rowFormat }];
    if (sql.startsWith('SELECT CHARACTER_SET_NAME AS name,DEFAULT_COLLATE_NAME')) return state.defaultCatalog ?? [{ name: charset, collation: state.collation, maxBytes: state.maxBytes }];
    if (sql.startsWith('SELECT CHARACTER_SET_NAME AS name')) return [{ name: charset, maxBytes: state.maxBytes }];
    if (sql.startsWith('SELECT TABLE_NAME FROM')) return state.created ? [{ TABLE_NAME: 'fresh_table' }] : [];
    if (sql.startsWith('CREATE TABLE')) { state.created = true; return { affectedRows: 0, warningStatus: 0 }; }
    if (sql.startsWith('SHOW CREATE')) return [{ 'Create Table': ddl() }];
    if (sql.startsWith('SELECT t.TABLE_NAME')) return [{ name: 'fresh_table', engine: 'InnoDB', charset, collation: state.collation, comment: '' }];
    if (sql.startsWith('SELECT TABLE_NAME AS name')) return [{ name: 'fresh_table', engine: 'InnoDB', rowFormat: 'Dynamic', collation: state.collation, ...state.tablePatch }];
    if (sql.startsWith('SELECT COLUMN_NAME AS name')) return design.columns.map((column: any) => ({ name: column.name, type: column.type, nullable: 'NO', defaultValue: column.defaultValue ?? null, extra: '', comment: '' }));
    if (sql.startsWith('SELECT COLUMN_NAME,DATA_TYPE')) return design.columns.map((column: any) => column.name === 'aux' ? { COLUMN_NAME: 'aux', DATA_TYPE: auxiliaryType!.split('(')[0], COLUMN_TYPE: auxiliaryType, IS_NULLABLE: 'NO', CHARACTER_SET_NAME: null, COLLATION_NAME: null, CHARACTER_MAXIMUM_LENGTH: auxiliaryType === 'blob' ? 65535 : auxiliaryType === 'varbinary(64)' ? 64 : null, CHARACTER_OCTET_LENGTH: auxiliaryType === 'blob' ? 65535 : auxiliaryType === 'varbinary(64)' ? 64 : null, EXTRA: '', ...state.auxiliaryPatch } : { COLUMN_NAME: column.name, DATA_TYPE: column.name === 'id' ? 'int' : 'char', COLUMN_TYPE: column.type, IS_NULLABLE: 'NO', CHARACTER_SET_NAME: column.name === 'id' ? null : charset, COLLATION_NAME: column.name === 'id' ? null : state.collation, CHARACTER_MAXIMUM_LENGTH: column.name === 'id' ? null : 255, CHARACTER_OCTET_LENGTH: column.name === 'id' ? null : 255 * (charset === 'latin1' ? 1 : 4), EXTRA: '', ...(column.name === 's' ? state.columnPatch : {}) });
    if (sql.startsWith('SELECT INDEX_NAME,NON_UNIQUE')) return [['PRIMARY', 0, 'id', null], ['ix', 1, 's', state.prefix]].map(([INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SUB_PART]) => ({ INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SUB_PART, SEQ_IN_INDEX: 1, INDEX_TYPE: 'BTREE', COLLATION: 'A', INDEX_COMMENT: '', EXPRESSION: null, IS_VISIBLE: 'YES', ...(INDEX_NAME === 'ix' ? state.statisticsPatch : {}) }));
    throw Error('独立审查禁止未声明查询：' + sql);
  };
  const connection = Object.assign(new EventEmitter(), { query(sql: string, callback: Function) { try { callback(null, answer(sql)); } catch (reason) { callback(reason); } } });
  const context: any = { managed: { connection, status: { dialect: 'mysql', version: '8.4.11' }, broken: false }, checkCancelled() {}, report() {}, commandStarted: () => () => {} };
  const host: any = { async run(_connectionId: string, _taskId: string, action: Function, options: any) { try { return await action(context); } finally { options.onResourcesReleased?.(); } } };
  return { state, design, context, ddl, tasks: new TableCreateTasks(host) };
}
async function prepared(f: ReturnType<typeof fixture>, prefix = true) {
  const get = await f.tasks.get({ connectionId: 'review', database: 'review_db', taskId: 'get', ...(prefix ? { includePrefixFacts: true } : {}) }, 1);
  const preview = await f.tasks.preview({ snapshotId: get.snapshotId, design: f.design, taskId: 'preview' }, 1);
  return { get, preview };
}
const apply = (f: ReturnType<typeof fixture>, value: any) => f.tasks.apply({ previewToken: value.previewToken, confirmation: 'review_db.fresh_table', acknowledgements: [...tableCreateAcknowledgements], taskId: 'apply' }, 1);


export { fixture, prepared, apply };
