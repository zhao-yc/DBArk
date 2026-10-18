import type { TableCopyDataGetInput, TableCopyDataGetOutput, TableCopyDataPreviewInput, TableCopyDataPreviewOutput, TableCopyDataApplyInput, TableCopyDataApplyOutput, TableCopyDataReleaseInput } from './tableCopyData';
import type { TableCreateGetInput, TableCreateGetOutput, TableCreatePreviewInput, TableCreatePreviewOutput, TableCreateApplyInput, TableCreateApplyOutput, TableCreateReleaseInput } from './tableCreate';
import type { CsvExportFieldsInput, CsvExportFieldsOutput, CsvExportSelection } from './csvExportFields';
import type { TableCopyStructureGetInput, TableCopyStructureGetOutput, TableCopyStructurePreviewInput, TableCopyStructurePreviewOutput, TableCopyStructureApplyInput, TableCopyStructureApplyOutput, TableCopyStructureReleaseInput } from './tableCopyStructure';
/** 所有跨进程数据均为可结构化克隆的普通值，精确数值由驱动保留为字符串。 */
import type { DatabaseCreateGetInput, DatabaseCreateGetOutput, DatabaseCreatePreviewInput, DatabaseCreatePreviewOutput, DatabaseCreateApplyInput, DatabaseCreateApplyOutput, DatabaseCreateReleaseInput } from './databaseCreate';
import type { QueryParameter, QueryParameterNames } from './queryParameters';
import type { TableDefaultEncodingGetInput, TableDefaultEncodingGetOutput, TableDefaultEncodingPreviewInput, TableDefaultEncodingPreviewOutput, TableDefaultEncodingApplyInput, TableDefaultEncodingApplyOutput, TableDefaultEncodingReleaseInput } from './tableDefaultEncoding';
import type { TableRenameGetInput, TableRenameGetOutput, TableRenamePreviewInput, TableRenamePreviewOutput, TableRenameApplyInput, TableRenameApplyOutput, TableRenameReleaseInput } from './tableRename';
import type { TableAutoIncrementGetInput, TableAutoIncrementGetOutput, TableAutoIncrementPreviewInput, TableAutoIncrementPreviewOutput, TableAutoIncrementApplyInput, TableAutoIncrementApplyOutput, TableAutoIncrementReleaseInput } from './tableAutoIncrement';
import type { TableCommentGetInput, TableCommentGetOutput, TableCommentPreviewInput, TableCommentPreviewOutput, TableCommentApplyInput, TableCommentApplyOutput, TableCommentReleaseInput } from './tableComment';
import type { TableDropGetInput, TableDropGetOutput, TableDropPreviewInput, TableDropPreviewOutput, TableDropApplyInput, TableDropApplyOutput, TableDropReleaseInput } from './tableDrop';
import type { TableTruncateGetInput, TableTruncateGetOutput, TableTruncatePreviewInput, TableTruncatePreviewOutput, TableTruncateApplyInput, TableTruncateApplyOutput, TableTruncateReleaseInput } from './tableTruncate';
import type { ExcelSheet, ExcelSheetPreview, ExcelTextProtocol, ExcelImportRequest, ExcelImportResult, ExcelExportRequest } from './excelTransfer';
import type { QueryExportProgress, QueryStreamExportInput, QueryStreamExportOutput } from './queryStreamExport';
import type { ConnectionFileRequirement, ConnectionImportApply, ConnectionImportPreview, ConnectionImportResult, ConnectionImportReview, ConnectionImportReviewInput } from './connectionTransfer';
import type { TablePreferenceTarget, TablePreferences } from './tablePreferences';
import type { TablePresetTarget, TablePresetSave, TablePresetSelect, TablePresetApply, TablePresetSnapshot, TablePresetConfiguration } from './tablePresets';
import type { TableColumnGetInput, TableColumnGetOutput, TableColumnPreviewInput, TableColumnPreviewOutput, TableColumnApplyInput, TableColumnApplyOutput, TableColumnApplyProgress, TableColumnReleaseInput } from './tableColumnPatches';
import type { TableIndexGetInput, TableIndexGetOutput, TableIndexPreviewInput, TableIndexPreviewOutput, TableIndexApplyInput, TableIndexApplyOutput, TableIndexApplyProgress, TableIndexReleaseInput } from './tableIndexTasks';
import type { TableForeignKeyGetInput, TableForeignKeyGetOutput, TableForeignKeyPreviewInput, TableForeignKeyPreviewOutput, TableForeignKeyApplyInput, TableForeignKeyApplyOutput, TableForeignKeyApplyProgress, TableForeignKeyReleaseInput } from './tableForeignKeyTasks';
import type { CompletionMetadataInput, CompletionMetadataOutput,CompletionSessionState } from './sqlCompletion';
import type {QueryDatabaseContext} from './queryContext';
import type {SessionObjectSnapshot,SessionObjectCompletion,SessionObjectReadResult} from './sessionObjects';
import type {StructureSearchInput,StructureSearchContinue,StructureSearchPage} from './databaseSearch';
import type {DataSearchInput,DataSearchNext,DataSearchReply,DataSearchProgress} from './dataSearch';
import type {DataSearchCatalogueInput,DataSearchCataloguePage} from './dataSearchCatalogue';
import type{DataSearchRecordReadInput,DataSearchRecordsReleaseInput,DataSearchRecord}from'./dataSearchRecords';
import type{SavedQuerySearchInput,SavedQuerySearchNext,SavedQuerySearchPage,SavedQueryOpenResult}from'./savedQuerySearch';
import type{SavedQueryPageInput,SavedQueryPage}from'./savedQueryPages';
import type{HistoryPageInput,HistoryPage,HistoryOpenResult}from'./historyPages';
import type { ExplainPlan } from './explain';
import type { WorkbenchTarget, WorkbenchSnapshot } from './workbench';
import type { SchemaCompareInput, SchemaCompareResult, SchemaComparePreviewInput, SchemaComparePreview } from './schemaCompare';
import type { QuerySourceBinding, QuerySaveContent, QuerySaveResult } from './queryBinding';
import type { TableCopyPageSources, TableCopySourceReadInput, TableCopySourceReadResult, TableCopySourceReleaseInput } from './tableCopySource';
import type { CopyInsertSqlInput } from './copyInsertSql';
export type CellValue = string | number | boolean | null | { type: 'binary'; base64: string };
export type DataRow = Record<string, CellValue>;
export type ObjectKind = 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event';

export interface ConnectionProfile {
  id: string; name: string; group: string; color: string; dialect: 'mysql' | 'mariadb';
  host: string; port: number; user: string; database?: string;
  pendingFiles?: ConnectionFileRequirement[];
  password?: string; rememberPassword?: boolean; hasPassword?: boolean;
  ssh?: { enabled: boolean; host: string; port: number; user: string; password?: string; hasPassword?: boolean; privateKeyPath?: string; passphrase?: string; hasPassphrase?: boolean; hostFingerprint?: string };
  tls?: { enabled: boolean; rejectUnauthorized: boolean; caPath?: string; certPath?: string; keyPath?: string; passphrase?: string; hasPassphrase?: boolean };
}
export interface ConnectionStatus { version: string; dialect: 'mysql' | 'mariadb'; connectionId?: number; }
/** 内部配置检查仅由主进程调用，不加入渲染进程可访问的 CommandMap/参数白名单。 */
export type EngineCommand = Command | '__connections.prepareSave';
export interface DatabaseObject { name: string; kind: ObjectKind; }
export interface ColumnInfo { name: string; type: string; nullable: boolean; defaultValue: string | null; extra: string; comment: string; generated: boolean; /** 来自该列目录，文本容量不能套用整表默认字符集。 */ characterSet?: string | null; }
export interface IndexInfo { name: string; unique: boolean; columns: string[]; }
export interface ForeignKeyInfo { name: string; columns: string[]; referencedDatabase: string; referencedTable: string; referencedColumns: string[]; onUpdate: string; onDelete: string; }
export interface TableInfo { database: string; name: string; columns: ColumnInfo[]; indexes: IndexInfo[]; foreignKeys: ForeignKeyInfo[]; primaryKey: string[]; editableKey: string[]; engine: string; ddl: string; charset?: string; collation?: string; comment?: string; /** 来自可信 information_schema.TABLES；未知类型不通过空 engine 推测。 */ objectKind?: 'table' | 'view'; }
export interface ResultColumn { key: string; name: string; type: string; }
export interface QueryResult { columns: ResultColumn[]; rows: DataRow[]; affectedRows?: number; insertId?: string; warningCount?: number; truncated: boolean; elapsedMs: number; statement: string; }
export interface QueryOutcome { results: QueryResult[]; elapsedMs: number; transactionOpen?: boolean; explain?: ExplainPlan; }
export type FilterMode = 'all' | 'any';
export interface FilterRule { column: string; operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'NOT IN' | 'BETWEEN' | 'IS NULL' | 'IS NOT NULL'; value?: string; values?: string[]; }
export interface SortRule { column: string; direction: 'ASC' | 'DESC'; }
export interface TablePage { rows: DataRow[]; columns: ResultColumn[]; hasMore: boolean; page: number; pageSize: number; /** 显式复制页在同一MDL内读取的目录身份；缺失时只能查看。 */ copyMetadataKey?: string; copySource?: TableCopyPageSources; }
export type RowChange = { kind: 'insert'; values: DataRow } | { kind: 'update'; before: DataRow; values: DataRow } | { kind: 'delete'; before: DataRow };
export interface SqlPreview { sql: string; statements: { sql: string; params: CellValue[] }[]; warnings: string[]; }
export interface TableDesign { database: string; name: string; originalName?: string; engine: string; charset: string; comment: string; columns: { name: string; originalName?: string; type: string; nullable: boolean; defaultValue?: string | null; autoIncrement: boolean; comment: string }[]; indexes: IndexInfo[]; foreignKeys: ForeignKeyInfo[]; }
export interface SavedQuery { id: string; name: string; connectionId?: string; database?: string; databaseContext?:QueryDatabaseContext; sql: string; updatedAt: string; }
/** 可复用片段独立于连接、查询标签与执行历史。 */
export interface SqlSnippet { id: string; name: string; group: string; description: string; sql: string; updatedAt: string; }
export interface HistoryEntry { id: string; connectionId: string; database?: string; databaseContext?:QueryDatabaseContext; sql: string; startedAt: string; elapsedMs: number; success: boolean; error?: string; }
export interface TaskRecord { /** 仅由main签发的随机回执关联，不能按可复用taskId补造提交事实。 */ tableApplyReceiptId?: string; id: string; kind: string; status: 'running' | 'completed' | 'cancelled' | 'failed'; progress: number; message: string; startedAt: string; finishedAt?: string; errors?: string[]; }
export interface TaskEvent { tableCreate?: import('./tableCreate').TableCreateProgress; databaseCreate?: import('./databaseCreate').DatabaseCreateProgress; tableApply?: import('./tableApplyReceipt').TableApplyProgress; taskId: string; status: TaskRecord['status']; progress: number; message: string; rows?: number; resultIndex?: number; columns?: ResultColumn[]; batch?: DataRow[]; executionDatabase?:QueryDatabaseContext; /** 当前语句开始发送时只报告一次实际片段，历史不得使用完整源脚本。 */ executionSql?: string; queryExport?: QueryExportProgress; columnPatch?: TableColumnApplyProgress; indexPatch?: TableIndexApplyProgress; foreignKeyPatch?: TableForeignKeyApplyProgress; tableCopyData?: import('./tableCopyData').TableCopyDataProgress; tableCopyStructure?: TableColumnApplyProgress; tableRename?: TableColumnApplyProgress; tableAutoIncrement?: TableColumnApplyProgress; tableComment?: TableColumnApplyProgress; tableDrop?: TableColumnApplyProgress; tableTruncate?: TableColumnApplyProgress; tableDefaultEncoding?: TableColumnApplyProgress; dataSearch?:DataSearchProgress; }
export interface FileChoice { token: string; name: string; }
export type QueryFileEncoding = 'utf8' | 'utf16le' | 'gb18030';
export interface AppSettings { theme: 'dark' | 'light'; sidebarWidth: number; resultLimit: number; pageSize: number; dataTypeColors?: boolean; editorFontSize?: number; editorWordWrap?: boolean; editorTabSize?: number; editorInsertSpaces?: boolean; tabs: { id: string; kind: 'query' | 'table'; title: string; connectionId: string; database?: string; databaseContext?:QueryDatabaseContext; table?: string; sql?: string; sourceBinding?: QuerySourceBinding; /** 仅查询标签可保存的编辑区像素高度；缺项由读取合同回退300。 */ queryEditorHeight?: number }[]; activeTabId?: string; }
export interface ImportOptions { connectionId: string; database: string; table: string; fileToken: string; format: 'csv' | 'json' | 'sql'; encoding: 'utf8' | 'utf16le' | 'gb18030'; mapping: Record<string, string>; taskId: string; }
export interface ExportOptions { csvSelection?: CsvExportSelection; connectionId: string; database: string; table: string; fileToken: string; format: 'csv' | 'json' | 'sql'; encoding: 'utf8' | 'utf16le' | 'gb18030'; includeStructure: boolean; includeData: boolean; taskId: string; }
/** 仅包含已经返回的结果，不携带可触发数据库访问的 SQL、连接或会话。 */
export interface ResultExportData { columns: Pick<ResultColumn, 'key' | 'name'>[]; rows: DataRow[]; truncated: boolean; }
export interface ResultExportOptions { fileToken: string; format: 'csv' | 'json'; encoding: 'utf8' | 'utf16le' | 'gb18030'; taskId: string; result: ResultExportData; }

/** 请求映射是界面、主进程与数据库进程共同使用的唯一接口定义。 */
export interface CommandMap {
  'workbench.get': { input: Record<string, never>; output: WorkbenchSnapshot };
  'workbench.save': { input: WorkbenchSnapshot; output: WorkbenchSnapshot };
  'workbench.resolve': { input: WorkbenchTarget; output: WorkbenchTarget };
  'workbench.copyUri': { input: WorkbenchTarget; output: void };
  'queries.create': { input: QuerySaveContent; output: QuerySaveResult };
  'queries.updateSource': { input: { source: QuerySourceBinding; content: QuerySaveContent }; output: QuerySaveResult };
  'table.presets.list': {input:TablePresetTarget;output:TablePresetSnapshot};
  'table.presets.save': {input:TablePresetSave;output:TablePresetSnapshot};
  'table.presets.delete': {input:TablePresetSelect;output:TablePresetSnapshot};
  'table.presets.apply': {input:TablePresetApply;output:TablePresetConfiguration};
  'table.preferences.get': { input: TablePreferenceTarget; output: TablePreferences | null };
  'table.preferences.save': { input: TablePreferenceTarget & { preferences: TablePreferences }; output: TablePreferences };
  'table.preferences.reset': { input: TablePreferenceTarget; output: void };
  'app.runtimeInfo': { input: Record<string, never>; output: { version: string; platform: string; dataPath: string } };
  'app.info': { input: Record<string, never>; output: { version: string; platform: string; encryptionAvailable: boolean; dataPath: string } };
  'app.setDirty': { input: { dirty: boolean }; output: void };
  'connections.export': { input: { connectionIds: string[]; fileToken: string }; output: { count: number } };
  'connections.importPreview': { input: { fileToken: string }; output: ConnectionImportPreview };
  'connections.importReview': { input: ConnectionImportReviewInput; output: ConnectionImportReview };
  'connections.importReviewRelease': { input: { previewToken: string; confirmationToken: string }; output: void };
  'connections.importApply': { input: ConnectionImportApply; output: ConnectionImportResult };
  'connections.list': { input: Record<string, never>; output: ConnectionProfile[] };
  'connections.save': { input: ConnectionProfile; output: ConnectionProfile };
  'connections.delete': { input: { id: string }; output: void };
  'connections.test': { input: ConnectionProfile; output: ConnectionStatus };
  'connections.open': { input: { id: string }; output: ConnectionStatus };
  'connections.close': { input: { id: string }; output: void };
  'metadata.databases': { input: { connectionId: string }; output: string[] };
  'serverMonitor.read': { input: import('./serverMonitor').ServerMonitorInput; output: import('./serverMonitor').ServerMonitorSnapshot };
  'metadata.completion': { input: CompletionMetadataInput; output: CompletionMetadataOutput };
  'search.structure':{input:StructureSearchInput;output:StructureSearchPage};
  'search.savedQueries':{input:SavedQuerySearchInput;output:SavedQuerySearchPage};
  'search.savedQueriesContinue':{input:SavedQuerySearchNext;output:SavedQuerySearchPage};
  'search.savedQueriesRelease':{input:{cursor:string};output:void};
  'queries.read':{input:{id:string;digest:string;connectionId:string};output:SavedQueryOpenResult};
  'queries.page':{input:SavedQueryPageInput;output:SavedQueryPage};
  'queries.pageContinue':{input:{taskId:string;cursor:string};output:SavedQueryPage};
  'queries.pageRelease':{input:{cursor:string};output:void};
  'queries.deleteChecked':{input:{id:string;digest:string};output:void};
  'search.structureContinue':{input:StructureSearchContinue;output:StructureSearchPage};
  'search.release':{input:{connectionId:string;cursor:string};output:void};
  'search.dataStart':{input:DataSearchInput;output:DataSearchReply};
  'search.recordRead':{input:DataSearchRecordReadInput;output:DataSearchRecord};
  'search.recordsRelease':{input:DataSearchRecordsReleaseInput;output:void};
  'search.catalogue':{input:DataSearchCatalogueInput;output:DataSearchCataloguePage};
  'search.dataNext':{input:DataSearchNext;output:DataSearchReply};
  'search.dataRelease':{input:{connectionId:string;taskId:string};output:void};
  'metadata.objects': { input: { connectionId: string; database: string }; output: DatabaseObject[] };
  'metadata.table': { input: { connectionId: string; database: string; table: string; taskId?: string }; output: TableInfo };
  'metadata.ddl': { input: { connectionId: string; database: string; name: string; kind: ObjectKind }; output: string };
  'sessions.open': { input: { connectionId: string; database?: string|null }; output: { sessionId: string } };
  'sessions.close': { input: { sessionId: string }; output: void };
  'query.execute': { input: { sessionId: string; sql: string; taskId: string; maxRows: number; /** 同一Monaco模型全文中的UTF-16光标；缺省保持原选区/全部行为。 */ currentStatement?: { offset: number } }; output: QueryOutcome };
  'query.explain': { input: { sessionId: string; sql: string; taskId: string; maxRows: number; format?: 'auto' | 'text' }; output: QueryOutcome };
  'query.parameterNames': { input: { sessionId: string; sql: string }; output: QueryParameterNames };
  'query.sessionState': { input: { sessionId: string }; output: { transactionOpen: boolean; transactionKnown: boolean; broken: boolean } };
  'query.completionState':{input:{sessionId:string};output:CompletionSessionState};
  'query.temporaryState':{input:{sessionId:string};output:SessionObjectSnapshot};
  'query.temporaryCompletion':{input:{sessionId:string;database:string;prefix:string;kind:'objects'}|{sessionId:string;database:string;table:string;prefix:string;kind:'columns'};output:SessionObjectCompletion};
  'query.temporaryRead':{input:{sessionId:string;database:string;table:string;taskId:string};output:SessionObjectReadResult};
  'query.executeParameterized': { input: { sessionId: string; sql: string; parameters: QueryParameter[]; taskId: string; maxRows: number }; output: QueryOutcome };
  'query.exportStream': { input: QueryStreamExportInput; output: QueryStreamExportOutput };
  'query.cancel': { input: { taskId: string }; output: void };
  'query.transaction': { input: { sessionId: string; action: 'begin' | 'commit' | 'rollback' }; output: void };
  'table.page': { input: { connectionId: string; database: string; table: string; page: number; pageSize: number; filters: FilterRule[]; filterMode?: FilterMode; sort: SortRule[]; copySource?: boolean; taskId?: string }; output: TablePage };
  'table.copySourceRead': { input: TableCopySourceReadInput; output: TableCopySourceReadResult };
  'table.copySourceRelease': { input: TableCopySourceReleaseInput; output: void };
  /** 只生成并复制受限的已加载表行 INSERT，不访问数据库。 */
  'table.copyInsertSql': { input: CopyInsertSqlInput; output: void };
  /** 目标仅由服务器来源表的外键解析；值元组保留精确字符串及二进制，不以普通文本筛选代替关联。 */
  'table.referencePage': { input: { connectionId: string; database: string; table: string; foreignKeyName: string; matchValues?: CellValue[]; page: number; pageSize: number; filters: FilterRule[]; filterMode?: FilterMode; sort: SortRule[]; taskId: string }; output: { source: TableInfo; foreignKey: ForeignKeyInfo; target: TableInfo; page: TablePage } };
  'table.preview': { input: { connectionId: string; database: string; table: string; changes: RowChange[] }; output: SqlPreview & { previewId?: string; previewExpiresAt?: string } };
  'table.apply': { input: { connectionId: string; database: string; table: string; changes: RowChange[]; taskId: string; previewId?: string }; output: { affectedRows: number; receiptId?: string; receiptSaved?: boolean; cleanupWarning?: boolean } };
  'schema.preview': { input: { connectionId: string; design: TableDesign }; output: SqlPreview };
  'schema.apply': { input: { connectionId: string; database: string; sql: string; taskId: string }; output: QueryOutcome };
  'schema.compare': { input: SchemaCompareInput; output: SchemaCompareResult };
  'schema.comparePreview': { input: SchemaComparePreviewInput; output: SchemaComparePreview };
  'schema.compareRelease': { input: { snapshotId: string }; output: void };
  'schema.columns.get': { input: TableColumnGetInput; output: TableColumnGetOutput };
  'schema.columns.preview': { input: TableColumnPreviewInput; output: TableColumnPreviewOutput };
  'schema.columns.apply': { input: TableColumnApplyInput; output: TableColumnApplyOutput };
  'schema.columns.release': { input: TableColumnReleaseInput; output: void };
  'schema.indexes.get': { input: TableIndexGetInput; output: TableIndexGetOutput };
  'schema.indexes.preview': { input: TableIndexPreviewInput; output: TableIndexPreviewOutput };
  'schema.indexes.apply': { input: TableIndexApplyInput; output: TableIndexApplyOutput };
  'schema.indexes.release': { input: TableIndexReleaseInput; output: void };
  'schema.foreignKeys.get': { input: TableForeignKeyGetInput; output: TableForeignKeyGetOutput };
  'schema.foreignKeys.preview': { input: TableForeignKeyPreviewInput; output: TableForeignKeyPreviewOutput };
  'schema.foreignKeys.apply': { input: TableForeignKeyApplyInput; output: TableForeignKeyApplyOutput };
  'schema.foreignKeys.release': { input: TableForeignKeyReleaseInput; output: void };
  'files.choose': { input: { purpose: 'import' | 'export' | 'key' | 'certificate' | 'query' | 'connection-import' | 'connection-export'; format?: string; suggestedName?: string }; output: FileChoice | null };
  'files.path': { input: { token: string }; output: string };
  'excel.sheets': { input: { fileToken: string; taskId: string }; output: ExcelSheet[] };
  'excel.preview': { input: { fileToken: string; taskId: string; sheetId: string; headerRow?: number; protocol: ExcelTextProtocol }; output: ExcelSheetPreview };
  'excel.import': { input: ExcelImportRequest; output: ExcelImportResult };
  'excel.export': { input: ExcelExportRequest; output: { rows: number } };
  'files.readQuery': { input: { fileToken: string; encoding: QueryFileEncoding }; output: { sql: string; encoding: QueryFileEncoding } };
  'files.writeQuery': { input: { fileToken: string; encoding: QueryFileEncoding; sql: string }; output: void };
  'files.preview': { input: { fileToken: string; format: 'csv' | 'json'; encoding: string }; output: { columns: string[]; rows: DataRow[] } };
  'files.import': { input: ImportOptions; output: { rows: number; errors: string[] } };
  'files.exportColumns': { input: CsvExportFieldsInput; output: CsvExportFieldsOutput };
  'files.releaseExportColumns': { input: { catalogId: string }; output: void };
  'files.export': { input: ExportOptions; output: { rows: number } };
  'files.exportResult': { input: ResultExportOptions; output: { rows: number } };
  'queries.list': { input: Record<string, never>; output: SavedQuery[] };
  'snippets.list': { input: Record<string, never>; output: SqlSnippet[] };
  'snippets.save': { input: SqlSnippet; output: SqlSnippet };
  'snippets.delete': { input: { id: string }; output: void };
  'queries.save': { input: SavedQuery; output: void };
  'queries.delete': { input: { id: string }; output: void };
  'history.list': { input: { connectionId?: string }; output: HistoryEntry[] };
  'history.page':{input:HistoryPageInput;output:HistoryPage};
  'history.pageContinue':{input:{taskId:string;cursor:string};output:HistoryPage};
  'history.pageRelease':{input:{cursor:string};output:void};
  'history.read':{input:{id:string;digest:string;connectionId:string};output:HistoryOpenResult};
  'history.readError':{input:{id:string;digest:string};output:{error:string}};
  'table.applyReceipt.list': { input: import('./tableApplyReceipt').TableApplyReceiptListInput; output: import('./tableApplyReceipt').TableApplyReceiptPage };
  'table.applyReceipt.detail': { input: { operationId: string }; output: import('./tableApplyReceipt').TableApplyReceipt };
  'tasks.list': { input: Record<string, never>; output: TaskRecord[] };
  'tasks.cancelState': { input: { taskIds: string[] }; output: import('./taskCancelState').TaskCancelSnapshot };
  'settings.get': { input: Record<string, never>; output: AppSettings };
  'settings.save': { input: AppSettings; output: void };
  'schema.tableCopyData.get': { input: TableCopyDataGetInput; output: TableCopyDataGetOutput };
  'schema.tableCopyData.preview': { input: TableCopyDataPreviewInput; output: TableCopyDataPreviewOutput };
  'schema.tableCopyData.apply': { input: TableCopyDataApplyInput; output: TableCopyDataApplyOutput };
  'schema.tableCopyData.release': { input: TableCopyDataReleaseInput; output: void };
  'schema.tableCopyStructure.get': { input: TableCopyStructureGetInput; output: TableCopyStructureGetOutput };
  'schema.tableCopyStructure.preview': { input: TableCopyStructurePreviewInput; output: TableCopyStructurePreviewOutput };
  'schema.tableCopyStructure.apply': { input: TableCopyStructureApplyInput; output: TableCopyStructureApplyOutput };
  'schema.tableCopyStructure.release': { input: TableCopyStructureReleaseInput; output: void };
  'schema.tableRename.get': { input: TableRenameGetInput; output: TableRenameGetOutput };
  'schema.tableRename.preview': { input: TableRenamePreviewInput; output: TableRenamePreviewOutput };
  'schema.tableRename.apply': { input: TableRenameApplyInput; output: TableRenameApplyOutput };
  'schema.tableRename.release': { input: TableRenameReleaseInput; output: void };
  'schema.tableAutoIncrement.get': { input: TableAutoIncrementGetInput; output: TableAutoIncrementGetOutput };
  'schema.tableAutoIncrement.preview': { input: TableAutoIncrementPreviewInput; output: TableAutoIncrementPreviewOutput };
  'schema.tableAutoIncrement.apply': { input: TableAutoIncrementApplyInput; output: TableAutoIncrementApplyOutput };
  'schema.tableAutoIncrement.release': { input: TableAutoIncrementReleaseInput; output: void };
  'schema.tableComment.get': { input: TableCommentGetInput; output: TableCommentGetOutput };
  'schema.tableComment.preview': { input: TableCommentPreviewInput; output: TableCommentPreviewOutput };
  'schema.tableComment.apply': { input: TableCommentApplyInput; output: TableCommentApplyOutput };
  'schema.tableComment.release': { input: TableCommentReleaseInput; output: void };
  'schema.tableDrop.get': { input: TableDropGetInput; output: TableDropGetOutput };
  'schema.tableDrop.preview': { input: TableDropPreviewInput; output: TableDropPreviewOutput };
  'schema.tableDrop.apply': { input: TableDropApplyInput; output: TableDropApplyOutput };
  'schema.tableDrop.release': { input: TableDropReleaseInput; output: void };
  'schema.tableTruncate.get': { input: TableTruncateGetInput; output: TableTruncateGetOutput };
  'schema.tableTruncate.preview': { input: TableTruncatePreviewInput; output: TableTruncatePreviewOutput };
  'schema.tableTruncate.apply': { input: TableTruncateApplyInput; output: TableTruncateApplyOutput };
  'schema.tableTruncate.release': { input: TableTruncateReleaseInput; output: void };
  'schema.tableCreate.get': { input: TableCreateGetInput; output: TableCreateGetOutput };
  'schema.tableCreate.preview': { input: TableCreatePreviewInput; output: TableCreatePreviewOutput };
  'schema.tableCreate.apply': { input: TableCreateApplyInput; output: TableCreateApplyOutput };
  'schema.tableCreate.release': { input: TableCreateReleaseInput; output: void };
  'schema.databaseCreate.get': { input: DatabaseCreateGetInput; output: DatabaseCreateGetOutput };
  'schema.databaseCreate.preview': { input: DatabaseCreatePreviewInput; output: DatabaseCreatePreviewOutput };
  'schema.databaseCreate.apply': { input: DatabaseCreateApplyInput; output: DatabaseCreateApplyOutput };
  'schema.databaseCreate.release': { input: DatabaseCreateReleaseInput; output: void };
  'schema.tableDefaultEncoding.get': { input: TableDefaultEncodingGetInput; output: TableDefaultEncodingGetOutput };
  'schema.tableDefaultEncoding.preview': { input: TableDefaultEncodingPreviewInput; output: TableDefaultEncodingPreviewOutput };
  'schema.tableDefaultEncoding.apply': { input: TableDefaultEncodingApplyInput; output: TableDefaultEncodingApplyOutput };
  'schema.tableDefaultEncoding.release': { input: TableDefaultEncodingReleaseInput; output: void };
}
export type Command = keyof CommandMap;
export interface DesktopApi {
  invoke<C extends Command>(command: C, input: CommandMap[C]['input']): Promise<CommandMap[C]['output']>;
  onTask(listener: (event: TaskEvent) => void): () => void;
  onMenu(listener: (action: string) => void): () => void;
}
declare global { interface Window { dbark: DesktopApi; } }
