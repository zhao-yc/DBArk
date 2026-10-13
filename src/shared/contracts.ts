/** 所有跨进程数据均为可结构化克隆的普通值，精确数值由驱动保留为字符串。 */
import type { QueryParameter, QueryParameterNames } from './queryParameters';
import type { QueryExportProgress, QueryStreamExportInput, QueryStreamExportOutput } from './queryStreamExport';
import type { TablePreferenceTarget, TablePreferences } from './tablePreferences';
export type CellValue = string | number | boolean | null | { type: 'binary'; base64: string };
export type DataRow = Record<string, CellValue>;
export type ObjectKind = 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event';

export interface ConnectionProfile {
  id: string; name: string; group: string; color: string; dialect: 'mysql' | 'mariadb';
  host: string; port: number; user: string; database?: string;
  password?: string; rememberPassword?: boolean; hasPassword?: boolean;
  ssh?: { enabled: boolean; host: string; port: number; user: string; password?: string; hasPassword?: boolean; privateKeyPath?: string; passphrase?: string; hasPassphrase?: boolean; hostFingerprint?: string };
  tls?: { enabled: boolean; rejectUnauthorized: boolean; caPath?: string; certPath?: string; keyPath?: string };
}
export interface ConnectionStatus { version: string; dialect: 'mysql' | 'mariadb'; connectionId?: number; }
/** 内部配置检查仅由主进程调用，不加入渲染进程可访问的 CommandMap/参数白名单。 */
export type EngineCommand = Command | '__connections.prepareSave';
export interface DatabaseObject { name: string; kind: ObjectKind; }
export interface ColumnInfo { name: string; type: string; nullable: boolean; defaultValue: string | null; extra: string; comment: string; generated: boolean; }
export interface IndexInfo { name: string; unique: boolean; columns: string[]; }
export interface ForeignKeyInfo { name: string; columns: string[]; referencedDatabase: string; referencedTable: string; referencedColumns: string[]; onUpdate: string; onDelete: string; }
export interface TableInfo { database: string; name: string; columns: ColumnInfo[]; indexes: IndexInfo[]; foreignKeys: ForeignKeyInfo[]; primaryKey: string[]; editableKey: string[]; engine: string; ddl: string; charset?: string; collation?: string; comment?: string; }
export interface ResultColumn { key: string; name: string; type: string; }
export interface QueryResult { columns: ResultColumn[]; rows: DataRow[]; affectedRows?: number; insertId?: string; warningCount?: number; truncated: boolean; elapsedMs: number; statement: string; }
export interface QueryOutcome { results: QueryResult[]; elapsedMs: number; transactionOpen?: boolean; }
export type FilterMode = 'all' | 'any';
export interface FilterRule { column: string; operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'NOT IN' | 'BETWEEN' | 'IS NULL' | 'IS NOT NULL'; value?: string; values?: string[]; }
export interface SortRule { column: string; direction: 'ASC' | 'DESC'; }
export interface TablePage { rows: DataRow[]; columns: ResultColumn[]; hasMore: boolean; page: number; pageSize: number; }
export type RowChange = { kind: 'insert'; values: DataRow } | { kind: 'update'; before: DataRow; values: DataRow } | { kind: 'delete'; before: DataRow };
export interface SqlPreview { sql: string; statements: { sql: string; params: CellValue[] }[]; warnings: string[]; }
export interface TableDesign { database: string; name: string; originalName?: string; engine: string; charset: string; comment: string; columns: { name: string; originalName?: string; type: string; nullable: boolean; defaultValue?: string | null; autoIncrement: boolean; comment: string }[]; indexes: IndexInfo[]; foreignKeys: ForeignKeyInfo[]; }
export interface SavedQuery { id: string; name: string; connectionId?: string; database?: string; sql: string; updatedAt: string; }
/** 可复用片段独立于连接、查询标签与执行历史。 */
export interface SqlSnippet { id: string; name: string; group: string; description: string; sql: string; updatedAt: string; }
export interface HistoryEntry { id: string; connectionId: string; database?: string; sql: string; startedAt: string; elapsedMs: number; success: boolean; error?: string; }
export interface TaskRecord { id: string; kind: string; status: 'running' | 'completed' | 'cancelled' | 'failed'; progress: number; message: string; startedAt: string; finishedAt?: string; errors?: string[]; }
export interface TaskEvent { taskId: string; status: TaskRecord['status']; progress: number; message: string; rows?: number; resultIndex?: number; columns?: ResultColumn[]; batch?: DataRow[]; queryExport?: QueryExportProgress; }
export interface FileChoice { token: string; name: string; }
export type QueryFileEncoding = 'utf8' | 'utf16le' | 'gb18030';
export interface AppSettings { theme: 'dark' | 'light'; sidebarWidth: number; resultLimit: number; pageSize: number; tabs: { id: string; kind: 'query' | 'table'; title: string; connectionId: string; database?: string; table?: string; sql?: string }[]; activeTabId?: string; }
export interface ImportOptions { connectionId: string; database: string; table: string; fileToken: string; format: 'csv' | 'json' | 'sql'; encoding: 'utf8' | 'utf16le' | 'gb18030'; mapping: Record<string, string>; taskId: string; }
export interface ExportOptions { connectionId: string; database: string; table: string; fileToken: string; format: 'csv' | 'json' | 'sql'; encoding: 'utf8' | 'utf16le' | 'gb18030'; includeStructure: boolean; includeData: boolean; taskId: string; }
/** 仅包含已经返回的结果，不携带可触发数据库访问的 SQL、连接或会话。 */
export interface ResultExportData { columns: Pick<ResultColumn, 'key' | 'name'>[]; rows: DataRow[]; truncated: boolean; }
export interface ResultExportOptions { fileToken: string; format: 'csv' | 'json'; encoding: 'utf8' | 'utf16le' | 'gb18030'; taskId: string; result: ResultExportData; }

/** 请求映射是界面、主进程与数据库进程共同使用的唯一接口定义。 */
export interface CommandMap {
  'table.preferences.get': { input: TablePreferenceTarget; output: TablePreferences | null };
  'table.preferences.save': { input: TablePreferenceTarget & { preferences: TablePreferences }; output: TablePreferences };
  'table.preferences.reset': { input: TablePreferenceTarget; output: void };
  'app.info': { input: Record<string, never>; output: { version: string; platform: string; encryptionAvailable: boolean; dataPath: string } };
  'app.setDirty': { input: { dirty: boolean }; output: void };
  'connections.list': { input: Record<string, never>; output: ConnectionProfile[] };
  'connections.save': { input: ConnectionProfile; output: ConnectionProfile };
  'connections.delete': { input: { id: string }; output: void };
  'connections.test': { input: ConnectionProfile; output: ConnectionStatus };
  'connections.open': { input: { id: string }; output: ConnectionStatus };
  'connections.close': { input: { id: string }; output: void };
  'metadata.databases': { input: { connectionId: string }; output: string[] };
  'metadata.objects': { input: { connectionId: string; database: string }; output: DatabaseObject[] };
  'metadata.table': { input: { connectionId: string; database: string; table: string; taskId?: string }; output: TableInfo };
  'metadata.ddl': { input: { connectionId: string; database: string; name: string; kind: ObjectKind }; output: string };
  'sessions.open': { input: { connectionId: string; database?: string }; output: { sessionId: string } };
  'sessions.close': { input: { sessionId: string }; output: void };
  'query.execute': { input: { sessionId: string; sql: string; taskId: string; maxRows: number }; output: QueryOutcome };
  'query.explain': { input: { sessionId: string; sql: string; taskId: string; maxRows: number }; output: QueryOutcome };
  'query.parameterNames': { input: { sessionId: string; sql: string }; output: QueryParameterNames };
  'query.sessionState': { input: { sessionId: string }; output: { transactionOpen: boolean; transactionKnown: boolean; broken: boolean } };
  'query.executeParameterized': { input: { sessionId: string; sql: string; parameters: QueryParameter[]; taskId: string; maxRows: number }; output: QueryOutcome };
  'query.exportStream': { input: QueryStreamExportInput; output: QueryStreamExportOutput };
  'query.cancel': { input: { taskId: string }; output: void };
  'query.transaction': { input: { sessionId: string; action: 'begin' | 'commit' | 'rollback' }; output: void };
  'table.page': { input: { connectionId: string; database: string; table: string; page: number; pageSize: number; filters: FilterRule[]; filterMode?: FilterMode; sort: SortRule[] }; output: TablePage };
  /** 目标仅由服务器来源表的外键解析；值元组保留精确字符串及二进制，不以普通文本筛选代替关联。 */
  'table.referencePage': { input: { connectionId: string; database: string; table: string; foreignKeyName: string; matchValues?: CellValue[]; page: number; pageSize: number; filters: FilterRule[]; filterMode?: FilterMode; sort: SortRule[]; taskId: string }; output: { source: TableInfo; foreignKey: ForeignKeyInfo; target: TableInfo; page: TablePage } };
  'table.preview': { input: { connectionId: string; database: string; table: string; changes: RowChange[] }; output: SqlPreview };
  'table.apply': { input: { connectionId: string; database: string; table: string; changes: RowChange[]; taskId: string }; output: { affectedRows: number } };
  'schema.preview': { input: { connectionId: string; design: TableDesign }; output: SqlPreview };
  'schema.apply': { input: { connectionId: string; database: string; sql: string; taskId: string }; output: QueryOutcome };
  'files.choose': { input: { purpose: 'import' | 'export' | 'key' | 'certificate' | 'query'; format?: string; suggestedName?: string }; output: FileChoice | null };
  'files.path': { input: { token: string }; output: string };
  'files.readQuery': { input: { fileToken: string; encoding: QueryFileEncoding }; output: { sql: string; encoding: QueryFileEncoding } };
  'files.writeQuery': { input: { fileToken: string; encoding: QueryFileEncoding; sql: string }; output: void };
  'files.preview': { input: { fileToken: string; format: 'csv' | 'json'; encoding: string }; output: { columns: string[]; rows: DataRow[] } };
  'files.import': { input: ImportOptions; output: { rows: number; errors: string[] } };
  'files.export': { input: ExportOptions; output: { rows: number } };
  'files.exportResult': { input: ResultExportOptions; output: { rows: number } };
  'queries.list': { input: Record<string, never>; output: SavedQuery[] };
  'snippets.list': { input: Record<string, never>; output: SqlSnippet[] };
  'snippets.save': { input: SqlSnippet; output: SqlSnippet };
  'snippets.delete': { input: { id: string }; output: void };
  'queries.save': { input: SavedQuery; output: void };
  'queries.delete': { input: { id: string }; output: void };
  'history.list': { input: { connectionId?: string }; output: HistoryEntry[] };
  'tasks.list': { input: Record<string, never>; output: TaskRecord[] };
  'settings.get': { input: Record<string, never>; output: AppSettings };
  'settings.save': { input: AppSettings; output: void };
}
export type Command = keyof CommandMap;
export interface DesktopApi {
  invoke<C extends Command>(command: C, input: CommandMap[C]['input']): Promise<CommandMap[C]['output']>;
  onTask(listener: (event: TaskEvent) => void): () => void;
  onMenu(listener: (action: string) => void): () => void;
}
declare global { interface Window { dbark: DesktopApi; } }
