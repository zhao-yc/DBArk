import { databaseDropAcknowledgements, databaseDropIdentifier } from '../shared/databaseDrop';
import type { DatabaseDropTarget, DatabaseDropCounts } from '../shared/databaseDrop';
import { QueryFileSources } from './queryFileSources';
import { DatabaseDefaultEncodingOwners, type DatabaseEncodingOwnerCommand } from './databaseDefaultEncodingOwners';
import { ExplainSnapshotFiles } from './explainSnapshotFiles';
import { explainSnapshotZh } from '../shared/explainSnapshot.zh-CN';
import { ResultSqlPreviews } from './resultSqlPreviews';
import { QueryInsertExports } from './queryInsertExports';
import { resultSqlZh } from '../shared/resultSql.zh-CN';
import { connectionOrganizationZh } from '../shared/connectionOrganization.zh-CN';
import { tableCreateMessages } from '../shared/tableCreate';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage } from 'electron';
import { copyInsertSql } from './copyInsertSql';
import { join, basename } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { TableApplyReceipts } from './tableApplyReceipts';
import { EngineBroker } from './broker';
import { ColumnsMainCapabilities, type ColumnsInvocation } from './columnsMainCapabilities';
import { LocalStore } from './storage';
import { ConnectionConfigManager } from './connectionConfig';
import { ConnectionTransfer } from './connectionTransfer';
import { SnippetTransfers } from './snippetTransfer';
import { snippetTransferZh } from '../shared/snippetTransfer';
import { assertConnectionReady } from '../shared/connectionTransfer';
import { confirmConnectionFiles, resolveFileToken, revokeConnectionFiles } from './fileTokens';
import { connectionReplacementText } from '../shared/connectionTransferMessages';
import { ExportReservations } from './exportReservations';
import { persistedQueryError, persistedTaskMessage } from './taskPrivacy';
import { readQueryFile, writeQueryFile } from './queryFiles';
import { validateCommand } from '../shared/validation';
import type { Command, ConnectionProfile, HistoryEntry, QueryFileEncoding, TaskEvent, TaskRecord } from '../shared/contracts';
import { taskCancelSnapshot } from './taskCancelState';
import type { QueryExportProgress } from '../shared/queryStreamExport';
import type { TableColumnApplyProgress } from '../shared/tableColumnPatches';
import {queryDatabasePatch} from '../shared/queryContext';
import{SavedQuerySearches,SavedQuerySearchCancelled}from'./savedQuerySearch';
import{SavedQueryPages}from'./savedQueryPages';
import{HistoryPages}from'./historyPages';
import { resolveWorkbenchTarget } from './workbench';
import { objectUri } from '../shared/workbench';
import { applyTablePreset, TablePresetSources } from './tablePresets';
import { QueryResultPresetSources } from './queryResultPresetSources';

if (process.env.DBARK_USER_DATA) { mkdirSync(process.env.DBARK_USER_DATA, { recursive: true }); app.setPath('userData', process.env.DBARK_USER_DATA); }
app.setName('DBArk');
let window: BrowserWindow | undefined;
let store: LocalStore;
let broker: EngineBroker;
let tableApplyReceipts: TableApplyReceipts;
let connectionConfig: ConnectionConfigManager;
let connectionTransfer: ConnectionTransfer;
let snippetTransfers: SnippetTransfers;
let queryFileSources: QueryFileSources;
let explainSnapshotFiles: ExplainSnapshotFiles;
let savedQuerySearches:SavedQuerySearches;
let savedQueryPages:SavedQueryPages;
let historyPages:HistoryPages;
const localSearchOperations=new Set<Promise<unknown>>();
let shuttingDown = false;
let shutdownComplete = false;
let stateFlushed: { resolve(): void; reject(error: Error): void } | undefined;
let hasPendingEdits = false;
let rendererHasSettings = false;
// 标签清单写入失败后不能把旧布局当作当前空闲事实；必须先成功保存当前布局才能替换。
let rendererSettingsCurrent = true;
let lastStorageWarning = 0;
const sessions = new Map<string, { connectionId: string }>();
// 历史上下文由引擎在会话互斥内报告，不能由渲染进程提供或从较早的标签状态推测。
const pendingQueryHistory = new Map<string, { entry: HistoryEntry; currentStatement: boolean; executionSqlReceived: boolean }>();
const files = new Map<string, { path: string; purpose: string; format?: string }>();
const resultSqlPreviews = new ResultSqlPreviews(files);
const queryFileOperations = new Set<Promise<unknown>>();
const exportReservations = new ExportReservations();
const preparingTasks = new Map<string, { cancelled: boolean; failure?: string; connectionIds?: string[] }>();
const exportProgress = new Map<string, QueryExportProgress>();
const structureProgress = new Map<string, TableColumnApplyProgress>();
const structureTokens = new Map<string, { purpose: 'columns' | 'indexes' | 'foreignKeys' | 'tableComment' | 'tableDrop' | 'tableTruncate' | 'tableDefaultEncoding' | 'tableCreate' | 'databaseCreate' | 'databaseDrop' | 'databaseDefaultEncoding' | 'tableCopyData' | 'tableCopyStructure' | 'tableRename' | 'tableAutoIncrement'; connectionId: string; expires: number; kind: 'snapshot' | 'preview'; snapshotId?: string }>();
const tasks = new Map<string, TaskRecord>();
// 补全是高频短读，只在内存保留活动编号；不挤占用户任务历史或逐次触发SQLite写盘。
const completionTasks = new Set<string>();
const lastPersist = new Map<string, number>();
const rendererURL = process.env.DBARK_DEV_URL ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href;
// 字段令牌只绑定真实IPC文档；回收仍使用原引擎精确release，不扩其他结构业务。
const columnsMain = new ColumnsMainCapabilities(structureTokens, { currentWindow: () => window, rendererURL, connectionRevision: () => store.connectionRevision(), assertAvailable: id => connectionConfig.assertAvailable(id), shuttingDown: () => shuttingDown, release: input => broker.request('schema.columns.release', input) });
const queryInsertExports=new QueryInsertExports(files,{assert:value=>columnsMain.assertCapturedOwner(value),same:(left,right)=>columnsMain.sharesDocumentOwner(left,right),revision:()=>store.connectionRevision(),session:id=>sessions.get(id),closing:()=>shuttingDown,stop:async taskId=>{const preparing=preparingTasks.get(taskId);if(preparing){preparing.cancelled=true;return;}return broker.request('query.cancel',{taskId});}});
const tablePresetSources=new TablePresetSources({assert:value=>columnsMain.assertCapturedOwner(value),same:(left,right)=>columnsMain.sharesDocumentOwner(left,right)});
const resultPresetSources=new QueryResultPresetSources({assert:value=>columnsMain.assertCapturedOwner(value),same:(left,right)=>columnsMain.sharesDocumentOwner(left,right)});
const tablePresetReads=new Map<string,{cancelled:boolean;sent:boolean;stop?:Promise<unknown>}>();
/** 仅真实Main调用持有发布门；成功结果直到IPC最后同步检查后才释放取消登记。 */
type MainInvocation = ColumnsInvocation & { databaseDropRequest?: DatabaseDropMainRequest;databaseEncodingRevision?:number;snapshotSaved?:true;resultPresetPublication?:()=>void;presetPublication?:{pendingStop():Promise<unknown>|undefined;settledStop(stop:Promise<unknown>):void;assertCurrent():void;release():void}};
/** 数据库属性能力也绑定真实文档；连接修订只由Main捕获，不接受渲染进程注入。 */
const databaseEncodingOwners = new DatabaseDefaultEncodingOwners({
  assert: owner => { columnsMain.assertCapturedOwner(owner); if ((owner as MainInvocation).databaseEncodingRevision !== store.connectionRevision()) throw Error('连接配置已变化，请重新读取数据库属性'); },
  same: (left, right) => columnsMain.sharesDocumentOwner(left, right),
  release: releaseDatabaseEncoding
});
interface DatabaseDropMainRecord {
  token: string; kind: 'snapshot' | 'preview'; owner: MainInvocation; revision: number; target: DatabaseDropTarget;
  expires: number; catalogDigest: string; counts: DatabaseDropCounts; writable: boolean; main: { purpose: 'databaseDrop'; connectionId: string; expires: number; kind: 'snapshot' | 'preview'; snapshotId?: string };
  parent?: DatabaseDropMainRecord; snapshotId?: string;
}
interface DatabaseDropMainRequest {
  command: string; revision: number; target?: DatabaseDropTarget; parent?: DatabaseDropMainRecord; claimed?: DatabaseDropMainRecord;
  pendingCleanup?: Promise<unknown[]>; reserved?: boolean; returned?: { snapshotId?: string; previewToken?: string }; issued?: DatabaseDropMainRecord;
  published?: boolean; cleanup?: Promise<never>;
}
const databaseDropCapabilities = new Map<string, DatabaseDropMainRecord>();
const databaseDropRetired = new Map<string, { record: DatabaseDropMainRecord; cleanupExpires: number }>();
let databaseDropReservations = 0;
const databaseDropStale = '删除数据库能力、来源或连接配置已变化，请重新读取；不会自动重试删除';

/** 真实主文档、原连接修订与原对象引用必须同时有效；到期能力只允许精确释放。 */
function assertDatabaseDropRecord(record: DatabaseDropMainRecord, owner: MainInvocation, releasing = false): void {
  if (!columnsMain.sharesDocumentOwner(record.owner, owner) || databaseDropCapabilities.get(record.token) !== record ||
    (!releasing && (record.revision !== store.connectionRevision() || record.expires <= Date.now() || structureTokens.get(record.token) !== record.main))) throw Error(databaseDropStale);
  if (!releasing) connectionConfig.assertAvailable(record.target.connectionId);
  if (record.parent && !releasing) assertDatabaseDropRecord(record.parent, owner);
}
/** 只撤销同用途同父对象能力，不允许相同字符串指向后来签发的其它能力。 */
function removeDatabaseDropRecord(record: DatabaseDropMainRecord): void {
  for (const [id, value] of databaseDropCapabilities) if (value === record || value.parent === record) {
    databaseDropCapabilities.delete(id); databaseDropRetired.set(id, { record: value, cleanupExpires: Date.now() + 600000 }); if (structureTokens.get(id) === value.main) structureTokens.delete(id);
  }
}
/** 旧修订、过期或失联文档的能力不占住预算；新任务必须等待精确引擎回收结算。 */
function sweepDatabaseDropCapabilities(): Promise<unknown[]> | undefined {
  const releases: { snapshotId?: string; previewToken?: string }[] = [];
  for (const record of [...databaseDropCapabilities.values()]) {
    if (databaseDropCapabilities.get(record.token) !== record) continue;
    let stale = record.expires <= Date.now() || record.revision !== store.connectionRevision() || structureTokens.get(record.token) !== record.main;
    try { columnsMain.assertCapturedOwner(record.owner); } catch { stale = true; }
    if (stale) {
      removeDatabaseDropRecord(record);
      releases.push(record.kind === 'snapshot' ? { snapshotId: record.token } : { previewToken: record.token });
    }
  }
  return releases.length ? Promise.allSettled(releases.map(input => Promise.resolve().then(() => broker.request('schema.databaseDrop.release', input)))).then(results => { const failures = results.filter(result => result.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(result => result.reason), '旧删除数据库能力回收失败；尚未投递新任务'); return results; }) : undefined;
}
/** 首个等待之前核对并领取删除能力；执行会同步消费父快照及全部兄弟预览，失败也不复活。 */
function beginDatabaseDrop(command: string, input: any, owner: MainInvocation): void {
  columnsMain.assertCapturedOwner(owner);
  for (const [id, value] of databaseDropRetired) if (value.cleanupExpires <= Date.now()) databaseDropRetired.delete(id);
  const request: DatabaseDropMainRequest = { command, revision: store.connectionRevision() }; owner.databaseDropRequest = request;
  if (!command.endsWith('.release')) request.pendingCleanup = sweepDatabaseDropCapabilities();
  if (command.endsWith('.release')) {
    const records = [input.snapshotId, input.previewToken].filter(Boolean).map(id => databaseDropCapabilities.get(id) ?? databaseDropRetired.get(id)?.record);
    if (!records.length || records.some(record => !record)) throw Error(databaseDropStale);
    // 已消费或已释放能力只保留原文档的有界清理凭证，不恢复其preview/apply权限。
    for (const record of records) {
      if (!columnsMain.sharesDocumentOwner(record!.owner, owner)) throw Error(databaseDropStale);
      if (databaseDropCapabilities.get(record!.token) !== record && databaseDropRetired.get(record!.token)?.record !== record) throw Error(databaseDropStale);
    }
    if (input.snapshotId && records.find(record => record!.token === input.snapshotId)?.kind !== 'snapshot' || input.previewToken && records.find(record => record!.token === input.previewToken)?.kind !== 'preview') throw Error(databaseDropStale);
    for (const record of records) removeDatabaseDropRecord(record!);
    return;
  }
  if (shuttingDown) throw Error('客户端正在退出，不能删除数据库');
  if (command.endsWith('.get')) request.target = { connectionId: input.connectionId, database: input.database };
  else {
    const record = databaseDropCapabilities.get(command.endsWith('.preview') ? input.snapshotId : input.previewToken);
    if (!record || record.kind !== (command.endsWith('.preview') ? 'snapshot' : 'preview')) throw Error(databaseDropStale);
    assertDatabaseDropRecord(record, owner); request.target = record.target;
    if (command.endsWith('.preview')) { if (!record.writable) throw Error(databaseDropStale); request.parent = record; }
    else {
      request.claimed = record;
      removeDatabaseDropRecord(record.parent!);
      if (input.confirmation !== record.target.database || input.acknowledgements.length !== databaseDropAcknowledgements.length || databaseDropAcknowledgements.some(id => input.acknowledgements.filter((value: string) => value === id).length !== 1)) throw Error('请输入准确数据库原名并确认全部删除风险；原预览已消费，未发送DDL');
    }
  }
  connectionConfig.assertAvailable(request.target!.connectionId);
  if (command.endsWith('.get') || command.endsWith('.preview')) {
    if (databaseDropCapabilities.size + databaseDropReservations >= 64 || databaseDropRetired.size + databaseDropCapabilities.size + databaseDropReservations >= 256) throw Error('删除数据库能力已达64项，请先关闭已有窗口并释放快照');
    request.reserved = true; databaseDropReservations++;
  }
}
/** 清理等待结算后重新核原发布来源；已领取apply只核原身份，不恢复已消费能力。 */
function assertDatabaseDropBeforeSend(owner: MainInvocation): void {
  const request = owner.databaseDropRequest!; columnsMain.assertCapturedOwner(owner);
  if (shuttingDown || request.revision !== store.connectionRevision()) throw Error(databaseDropStale);
  connectionConfig.assertAvailable(request.target!.connectionId);
  if (request.parent) assertDatabaseDropRecord(request.parent, owner);
  if (request.claimed && request.claimed.expires <= Date.now()) throw Error(databaseDropStale);
}
/** 验证只允许数据属性，避免能力响应中的访问器在检查期间执行代码。 */
function databaseDropResponse(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('删除数据库响应格式无效');
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.some(key => typeof key !== 'string' || ![...keys, ...optional].includes(key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable) || keys.some(key => !Object.hasOwn(descriptors, key))) throw Error('删除数据库响应字段无效');
  return Object.fromEntries(names.map(key => [key, descriptors[key as string].value]));
}
/** 只认有界完整对象计数和普通文案数组，不能用隐藏对象或未知目录替代零。 */
function databaseDropResponseCounts(value: unknown): DatabaseDropCounts {
  const data = databaseDropResponse(value, ['tables', 'views', 'procedures', 'functions', 'triggers', 'events']);
  if (Object.values(data).some(count => !Number.isSafeInteger(count) || count < 0 || count > 4096) || Object.values(data).reduce((sum: number, count: number) => sum + count, 0) > 4096) throw Error('删除数据库响应对象计数无效');
  return data as DatabaseDropCounts;
}
function databaseDropResponseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128 || Reflect.ownKeys(value).length !== value.length + 1) throw Error('删除数据库响应文案无效');
  const result: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' || descriptor.value.length > 8192 || descriptor.value.includes('\0')) throw Error('删除数据库响应文案无效');
    result.push(descriptor.value);
  }
  return result;
}
/** 先记录可精确回收的新令牌，全部原目标/父快照核验通过后才登记通用Map。 */
function publishDatabaseDrop(input: any, result: unknown, owner: MainInvocation): void {
  const request = owner.databaseDropRequest!, getting = request.command.endsWith('.get'), key = getting ? 'snapshotId' : 'previewToken';
  const descriptor = result && typeof result === 'object' ? Object.getOwnPropertyDescriptor(result, key) : undefined, token = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  if (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token) || structureTokens.has(token) || databaseDropCapabilities.has(token) || databaseDropRetired.has(token)) throw Error('删除数据库返回无效或重复能力；未覆盖或释放已有能力');
  request.returned = { [key]: token };
  columnsMain.assertCapturedOwner(owner);
  if (shuttingDown || request.revision !== store.connectionRevision() || input.connectionRevision !== request.revision || ['failed', 'cancelled'].includes(tasks.get(input.taskId)?.status ?? '')) throw Error(databaseDropStale);
  connectionConfig.assertAvailable(request.target!.connectionId);
  const data = databaseDropResponse(result, getting ? ['target', 'snapshotId', 'expiresAt', 'catalogDigest', 'counts', 'charset', 'collation', 'writable', 'reasons', 'warnings', 'serverVersion'] : ['target', 'previewToken', 'expiresAt', 'catalogDigest', 'counts', 'sql', 'requiredAcknowledgements', 'warnings']);
  const target = databaseDropResponse(data.target, ['connectionId', 'database']);
  if (target.connectionId !== request.target!.connectionId || target.database !== request.target!.database) throw Error(databaseDropStale);
  const expires = Date.parse(data.expiresAt), now = Date.now(), counts = databaseDropResponseCounts(data.counts);
  if (typeof data.expiresAt !== 'string' || !Number.isFinite(expires) || new Date(expires).toISOString() !== data.expiresAt || expires <= now || expires > now + 120000) throw Error('删除数据库能力期限无效');
  databaseDropResponseStrings(data.warnings);
  if (getting) {
    const reasons = databaseDropResponseStrings(data.reasons);
    if (typeof data.writable !== 'boolean' || ![data.charset, data.collation, data.serverVersion].every(value => typeof value === 'string' && value.length <= 1024 && !value.includes('\0')) || (typeof data.catalogDigest !== 'string' || !/^[0-9a-f]{64}$/i.test(data.catalogDigest) && !(data.catalogDigest === '' && data.writable === false && reasons.length))) throw Error('删除数据库目录响应无效');
  } else {
    assertDatabaseDropRecord(request.parent!, owner);
    const acknowledgements = databaseDropResponseStrings(data.requiredAcknowledgements), expected = 'DROP DATABASE ' + databaseDropIdentifier(request.target!.database);
    if (data.catalogDigest !== request.parent!.catalogDigest || Object.keys(counts).some(key => counts[key as keyof DatabaseDropCounts] !== request.parent!.counts[key as keyof DatabaseDropCounts]) || ![expected, expected + ';'].includes(data.sql) || acknowledgements.length !== databaseDropAcknowledgements.length || databaseDropAcknowledgements.some(id => acknowledgements.filter(value => value === id).length !== 1)) throw Error('删除数据库预览与原快照不符');
  }
  if (structureTokens.size >= 128) throw Error('结构令牌缓存已达上限，请先关闭旧预览');
  const main = { purpose: 'databaseDrop' as const, connectionId: request.target!.connectionId, expires: Math.min(expires, request.parent?.expires ?? expires), kind: getting ? 'snapshot' as const : 'preview' as const, ...(!getting ? { snapshotId: input.snapshotId } : {}) };
  const record: DatabaseDropMainRecord = { token, kind: main.kind, owner, revision: request.revision, target: { ...request.target! }, expires: main.expires, catalogDigest: data.catalogDigest, counts, writable: getting ? data.writable : true, main, ...(!getting ? { parent: request.parent, snapshotId: input.snapshotId } : {}) };
  databaseDropCapabilities.set(token, record); structureTokens.set(token, main); request.issued = record;
}
/** IPC最后一次等待之后同步检查，失败回执仍保留服务器已确认删除这一事实。 */
function assertDatabaseDropPublication(result: unknown, owner: MainInvocation): void {
  const request = owner.databaseDropRequest!;
  if (request.command.endsWith('.release')) return;
  columnsMain.assertCapturedOwner(owner);
  if (request.revision !== store.connectionRevision() || shuttingDown) throw Error(databaseDropStale);
  if (request.issued) assertDatabaseDropRecord(request.issued, owner);
  else {
    const data = databaseDropResponse(result, ['target', 'ddlSubmitted', 'ddlCompleted', 'definitionVerified', 'warnings'], ['after', 'verificationError']);
    const target = databaseDropResponse(data.target, ['connectionId', 'database']);
    if (!request.claimed || target.connectionId !== request.claimed.target.connectionId || target.database !== request.claimed.target.database || data.ddlSubmitted !== true || data.ddlCompleted !== true || typeof data.definitionVerified !== 'boolean') throw Error('删除数据库回执不符；删除可能已经完成，请人工核对，不要重试');
    databaseDropResponseStrings(data.warnings);
    if (data.after !== undefined) { const after = databaseDropResponse(data.after, ['databaseAbsent']); if (typeof after.databaseAbsent !== 'boolean' || data.definitionVerified && after.databaseAbsent !== true) throw Error('删除数据库后核回执不符；不能重试'); }
    else if (data.definitionVerified) throw Error('删除数据库缺少不存在的后核证据；不能重试');
    if (data.verificationError !== undefined && (typeof data.verificationError !== 'string' || data.verificationError.length > 8192)) throw Error('删除数据库后核错误格式无效；不能重试');
  }
  if (request.reserved) { request.reserved = false; databaseDropReservations--; } request.published = true;
}
/** 仅回收本请求新签发能力并等待原release结算；重复失败共享清理，不碰同ID旧能力。 */
function rejectDatabaseDropPublication(owner: MainInvocation, error: unknown): Promise<never> {
  const request = owner.databaseDropRequest;
  if (request?.reserved) { request.reserved = false; databaseDropReservations--; }
  if (request?.cleanup) return request.cleanup;
  let release: { snapshotId?: string; previewToken?: string } | undefined;
  if (request && !request.published && request.returned) {
    const token = request.returned.snapshotId ?? request.returned.previewToken!;
    if (request.issued && databaseDropCapabilities.get(token) === request.issued) { removeDatabaseDropRecord(request.issued); release = request.returned; }
    else if (!databaseDropCapabilities.has(token) && !structureTokens.has(token) && !databaseDropRetired.has(token)) release = request.returned;
  }
  const cleanup = (async (): Promise<never> => {
    const failures: unknown[] = [error];
    if (request?.pendingCleanup) try { await request.pendingCleanup; } catch (failure) { failures.push(failure); }
    if (release) try { await broker.request('schema.databaseDrop.release', release); } catch (failure) { failures.push(failure); }
    if (failures.length > 1) throw new AggregateError(failures, '删除数据库响应失效且能力清理失败；请保留原错误和清理错误');
    throw error;
  })();
  if (request) request.cleanup = cleanup; return cleanup;
}
/** 精确释放只撤销内存能力；退出或连接修订不能把已经开始的回收挡在新任务准入门外。 */
async function releaseDatabaseEncoding(input: { snapshotId?: string; previewToken?: string }): Promise<unknown> {
  if (input.snapshotId) for (const [id, value] of structureTokens) if (value.purpose === 'databaseDefaultEncoding' && (id === input.snapshotId || value.snapshotId === input.snapshotId)) structureTokens.delete(id);
  if (input.previewToken && structureTokens.get(input.previewToken)?.purpose === 'databaseDefaultEncoding') structureTokens.delete(input.previewToken);
  return broker.request('schema.databaseDefaultEncoding.release', input);
}
/** 取消只指向本片已登记的独立metadata任务；原请求仍等待utility严格资源结算。 */
function cancelTablePresetRead(taskId:string):Promise<unknown> {
  const state=tablePresetReads.get(taskId);if(!state)return Promise.resolve();
  state.cancelled=true;if(state.sent)state.stop??=broker.request('query.cancel',{taskId});
  return state.stop??Promise.resolve();
}
/** 来源销毁不依赖旧渲染进程继续发IPC；收尾失败由仍在等待的原请求保留。 */
function invalidateTablePresetSources():void {
  resultPresetSources.invalidate();
  tablePresetSources.invalidate();for(const taskId of tablePresetReads.keys())void cancelTablePresetRead(taskId).catch(()=>undefined);
}

/** 辅助记录失败不能改变已经完成的数据库操作结果，避免用户误以为 SQL 未执行。 */
function persistAuxiliary(action: () => void): void {
  try { action(); }
  catch {
    if (Date.now() - lastStorageWarning > 10000) {
      lastStorageWarning = Date.now();
      window?.webContents.send('dbark:menu', 'warning:数据库操作状态以结果为准，但本地历史或任务记录保存失败，请检查磁盘空间和权限。不要据此重复执行写操作。');
    }
  }
}

/** utility事件在进入原记录器前核INSERT owner；原任务概要仍记终态，敏感样例不交给新文档。 */
function engineTaskEvent(event:TaskEvent):void{if(event.queryInsert&&!queryInsertExports.has(event.taskId))return;taskEvent(event,queryInsertExports.receive(event.taskId,event.queryInsert));}

/** 任务进度只保留概要；分批结果直接传输，不把整批数据写入配置库。 */
function taskEvent(event: TaskEvent, deliverInsert=true): void {
  if(completionTasks.has(event.taskId))return;
  if (event.tableApply) tableApplyReceipts?.receive(event.taskId, event.tableApply);
  if (event.status !== 'running' && tableApplyReceipts?.confirmed(event.taskId)) event = { ...event, status: 'completed', progress: 100, message: '服务器已确认目标事务提交；附加错误请查看提交记录' };
  const pendingHistory=pendingQueryHistory.get(event.taskId), history=pendingHistory?.entry;
  if(history&&event.executionDatabase)Object.assign(history,queryDatabasePatch(event.executionDatabase));
  // 接收一次实际发送片段；独立布尔状态保证定位失败/发送前取消不能落全文或空SQL。
  if (pendingHistory?.currentStatement && !pendingHistory.executionSqlReceived && typeof event.executionSql === 'string' && event.executionSql.trim()) { pendingHistory.entry.sql = event.executionSql; pendingHistory.executionSqlReceived = true; }
  if (event.queryExport) exportProgress.set(event.taskId, { ...event.queryExport });
  const structure = event.tableCreate ?? event.tableCopyData ?? event.tableCopyStructure ?? event.databaseDrop ?? event.databaseDefaultEncoding ?? event.databaseCreate ?? event.tableDrop ?? event.tableTruncate ?? event.tableAutoIncrement ?? event.tableRename ?? event.tableDefaultEncoding ?? event.tableComment ?? event.foreignKeyPatch ?? event.indexPatch ?? event.columnPatch;
  if (structure) structureProgress.set(event.taskId, { ...structure });
  const current = tasks.get(event.taskId);
  if (current) {
    // 服务器错误可能回显已绑定值；参数查询的失败细节仅送给当前界面，不写入磁盘任务记录。
    const message = persistedTaskMessage(current.kind, event);
    const record = { ...current, status: event.status, progress: event.progress, message, finishedAt: event.status === 'running' ? undefined : new Date().toISOString() };
    tasks.set(event.taskId, record);
    if (event.status !== 'running' || Date.now() - (lastPersist.get(event.taskId) ?? 0) > 1000) {
      persistAuxiliary(() => store.saveTask(record)); lastPersist.set(event.taskId, Date.now());
    }
  }
  if (deliverInsert && window && !window.isDestroyed()) window.webContents.send('dbark:task', event);
}

/** 文件只能来自用户打开/保存对话框；数据库进程收到的是主进程解析后的实际路径。 */
async function chooseFile(input: any): Promise<{ token: string; name: string } | null> {
  const filters = input.format ? [{ name: `${String(input.format).toUpperCase()} 文件`, extensions: [input.format] }, { name: '所有文件', extensions: ['*'] }] : [{ name: '所有文件', extensions: ['*'] }];
  let filePath: string | undefined;
  if (input.purpose === 'export' || input.purpose === 'connection-export') {
    const result = await dialog.showSaveDialog(window!, { title: '导出文件', defaultPath: input.suggestedName, filters });
    filePath = result.canceled ? undefined : result.filePath;
  } else {
    const result = await dialog.showOpenDialog(window!, { title: '选择文件', properties: ['openFile'], filters });
    filePath = result.canceled ? undefined : result.filePaths[0];
  }
  if (!filePath) return null;
  const token = randomUUID(); files.set(token, { path: filePath, purpose: input.purpose, format: input.format });
  return { token, name: basename(filePath) };
}

/** SQL结果文件选择绑定本主文档和准确预览；原生对话框等待中撤销的映射不能领取迟到令牌。 */
async function chooseResultSqlFile(input: any, owner: MainInvocation | undefined) {
  columnsMain.assertCapturedOwner(owner); resultSqlPreviews.beginChoice(input.resultSqlPreviewId, owner!.owner.document);
  const selected = await chooseFile(input);
  try { columnsMain.assertCapturedOwner(owner); if (selected) resultSqlPreviews.bindFile(input.resultSqlPreviewId, owner!.owner.document, selected.token); return selected; }
  catch (error) { if (selected) files.delete(selected.token); throw error; }
}

/** 完整INSERT选择不执行SQL；原生等待两侧检查真实文档，迟到失败只删自己的令牌。 */
async function chooseQueryInsertFile(input:any,owner:MainInvocation|undefined){
  columnsMain.assertCapturedOwner(owner);if(shuttingDown)throw Error(resultSqlZh.shuttingDown);
  const selected=await chooseFile(input);
  try{columnsMain.assertCapturedOwner(owner);if(selected)queryInsertExports.bind(selected.token,owner!);return selected;}
  catch(error){if(selected)files.delete(selected.token);throw error;}
}

/** 布局请求到达即先撤销空闲依据；包括校验失败，只有完整保存成功才恢复可信标签事实。 */
function validateMainCommand(command: string, input: unknown) {
  if (command === 'settings.save') rendererSettingsCurrent = false;
  return validateCommand(command, input);
}

/** 正常退出等待已授权的小型文件操作，防止中途退出留下未关闭的临时文件。 */
async function queryFileOperation<T>(action: () => Promise<T>, allowShutdown = false): Promise<T> {
  if (shuttingDown && !allowShutdown) throw new Error('客户端正在退出，不能开始文件操作');
  const operation = action(); queryFileOperations.add(operation);
  try { return await operation; } finally { queryFileOperations.delete(operation); }
}

/** 小型 SQL 保存也占用目标直到原子操作清理完毕，避免与长任务并发覆盖。 */
async function writeSelectedQuery(input: { fileToken: string; sql: string; encoding: QueryFileEncoding }): Promise<void> {
  const path = resolveFileToken(files, input.fileToken, 'export', 'sql');
  const release = await exportReservations.acquire(path);
  try { await writeQueryFile(path, input.sql, input.encoding); } finally { release(); }
}

/** 文件任务先持久化固定概要，禁止复用任何既有任务编号，不借用数据库连接。 */
function registerQueryFileSourceTask(taskId: string, command: Command): void {
  if (tasks.has(taskId)) throw Error('任务编号已使用，请创建新的文件任务');
  const task: TaskRecord = { id: taskId, kind: command, status: 'running', progress: 0, message: '正在处理SQL文件；正文与路径未写入任务概要', startedAt: new Date().toISOString() };
  try { store.saveTask(task); } catch { throw Error('本地文件任务记录未保存，尚未开始文件IO'); }
  tasks.set(taskId, task);
}

/** 分派前检查配置保存锁，防止检查通过后另一个请求用旧凭据抢先建连。 */
async function dispatch(command: Command, input: any, columns?: MainInvocation): Promise<unknown> {
  // 查询分组仅操作本地组织元数据，不占用连接锁、不委派数据库任务或执行历史。
  if (command === 'queries.organizationGet' || command === 'queries.organizationApply') {
    if (shuttingDown) throw Error('客户端正在退出，不能整理保存查询分组');
    return command === 'queries.organizationGet' ? store.queryOrganization() : store.applyQueryOrganization(input);
  }
  // 专属片段传输只认真实IPC文档与Main快照，永不转发给SQL引擎或接受任意文件路径。
  if (command.startsWith('snippets.transfer')) {
    columnsMain.assertCapturedOwner(columns);
    const owner = { document: columns!.owner.document, assertCurrent: () => { columnsMain.assertCapturedOwner(columns); if (shuttingDown) throw Error(snippetTransferZh.stale); } };
    if (command === 'snippets.transferOpen') return snippetTransfers.open(owner);
    if (command === 'snippets.transferPreview') return snippetTransfers.preview(input.scopeId, owner);
    if (command === 'snippets.transferExport') return snippetTransfers.export(input.scopeId, owner);
    if (command === 'snippets.transferApply') return snippetTransfers.apply(input.scopeId, owner, input.previewId, input.decisions);
    if (command === 'snippets.transferCancel') return snippetTransfers.cancel(input.scopeId, owner, input.close);
    throw Error(snippetTransferZh.stale);
  }
  if (command.startsWith('schema.databaseDrop.') && columns?.databaseDropRequest?.pendingCleanup) await columns.databaseDropRequest.pendingCleanup;
  if (command === 'schema.databaseDrop.release') return broker.request(command, input);
  if (command.startsWith('schema.databaseDrop.')) assertDatabaseDropBeforeSend(columns!);
  if (command === 'schema.databaseDefaultEncoding.release') {
    columnsMain.assertCapturedOwner(columns);
    return releaseDatabaseEncoding(input);
  }
  // 文件能力仅绑定本次真实主窗口文档，不接收渲染进程传入的磁盘路径或连接。
  if (command === 'explainFiles.open' || command === 'explainFiles.save') {
    columnsMain.assertCapturedOwner(columns);
    const owner = { assertCurrent: () => columnsMain.assertCapturedOwner(columns) };
    return queryFileOperation(async () => {
      if (command === 'explainFiles.open') return explainSnapshotFiles.open(owner);
      const result = await explainSnapshotFiles.save(input.snapshot, owner);
      if (result) columns!.snapshotSaved = true;
      return result;
    });
  }
  if(command==='query.confirmInsertExport'){
    // 最终确认先同步消费真实owner的发布令牌，随后仅向原引擎任务投递文件发布信号。
    queryInsertExports.grant(input,columns);return broker.request(command,input);
  }
  // 结果SQL预览与释放仅处理已返回快照，不经连接、任务或数据库broker。
  if (command === 'files.previewResultSql' || command === 'files.releaseResultSql') {
    columnsMain.assertCapturedOwner(columns);
    if (command === 'files.releaseResultSql') return resultSqlPreviews.release(input.previewId, columns!.owner.document);
    if (shuttingDown) throw Error(resultSqlZh.shuttingDown);
    return resultSqlPreviews.issue(input, columns!.owner.document);
  }
  // 来源释放只撤销内存能力，配置保存和退出收尾时也必须可用，不建立任务或历史。
  if (command === 'table.copySourceRelease' || command === 'files.releaseExportColumns') return broker.request(command, input);
  // 确认与释放不新建连接或任务，不受配置保存锁阻塞；归属由引擎在取消前校验。
  if(command==='search.dataNext'||command==='search.dataRelease'||command==='search.recordsRelease')return broker.request(command,input);
  // 文件来源独立使用Main授权，不经过数据库broker或连接配置保存。
  if (command.startsWith('queryFileSources.')) {
    const releasing = command === 'queryFileSources.release' || command === 'queryFileSources.cancel' || command === 'queryFileSources.discardReload';
    columnsMain.assertCapturedOwner(columns);
    const scope = { document: columns!.owner.document, assertCurrent: () => {
      columnsMain.assertCapturedOwner(columns);
      if (!releasing && (shuttingDown || !rendererHasSettings || !rendererSettingsCurrent)) throw Error('查询文档配置尚未同步或客户端正在退出');
    } };
    scope.assertCurrent();
    if (command === 'queryFileSources.open' || command === 'queryFileSources.save' || command === 'queryFileSources.saveAs' || command === 'queryFileSources.checkExternal' || command === 'queryFileSources.reload') registerQueryFileSourceTask(input.taskId, command);
    return queryFileOperation(async () => {
      switch (command) {
        case 'queryFileSources.checkExternal': return queryFileSources.checkExternal(input, scope);
        case 'queryFileSources.reload': return queryFileSources.reload(input, scope);
        case 'queryFileSources.discardReload': return queryFileSources.discardReload(input, scope);
        case 'queryFileSources.cancel': return queryFileSources.cancel(input, scope);
        case 'queryFileSources.open': return queryFileSources.open(input, scope);
        case 'queryFileSources.recent': return queryFileSources.recent(input, scope);
        case 'queryFileSources.forgetRecent': return queryFileSources.forgetRecent(input, scope);
        case 'queryFileSources.save': return queryFileSources.save(input, scope);
        case 'queryFileSources.saveAs': return queryFileSources.saveAs(input, scope);
        case 'queryFileSources.status': return queryFileSources.status(input, scope);
        case 'queryFileSources.release': return queryFileSources.release(input, scope);
        default: throw Error('文件来源命令未声明');
      }
    }, releasing);
  }
  // 既有任务中心仍发送query.cancel；本地文件任务只在当前Main中精确撤销。
  if (command === 'query.cancel' && tasks.get(input.taskId)?.kind.startsWith('queryFileSources.')) {
    columnsMain.assertCapturedOwner(columns);
    const scope = { document: columns!.owner.document, assertCurrent: () => columnsMain.assertCapturedOwner(columns) };
    return queryFileOperation(() => queryFileSources.cancelTask(input.taskId, scope), true);
  }
  const structurePurpose = command.startsWith('schema.databaseDrop.') ? 'databaseDrop' as const : command.startsWith('schema.databaseDefaultEncoding.') ? 'databaseDefaultEncoding' as const : command.startsWith('schema.tableCreate.') ? 'tableCreate' as const : command.startsWith('schema.tableCopyData.') ? 'tableCopyData' as const : command.startsWith('schema.tableCopyStructure.') ? 'tableCopyStructure' as const : command.startsWith('schema.databaseCreate.') ? 'databaseCreate' as const : command.startsWith('schema.tableRename.') ? 'tableRename' as const : command.startsWith('schema.tableAutoIncrement.') ? 'tableAutoIncrement' as const : command.startsWith('schema.tableDefaultEncoding.') ? 'tableDefaultEncoding' as const : command.startsWith('schema.tableDrop.') ? 'tableDrop' as const : command.startsWith('schema.tableTruncate.') ? 'tableTruncate' as const : command.startsWith('schema.tableComment.') ? 'tableComment' as const : command.startsWith('schema.columns.') ? 'columns' as const : command.startsWith('schema.indexes.') ? 'indexes' as const : command.startsWith('schema.foreignKeys.') ? 'foreignKeys' as const : undefined;
  const structureCommand = structurePurpose !== undefined, structurePrefix = structurePurpose ? `schema.${structurePurpose}.` : '';
  for (const [token, value] of structureTokens) if (value.expires <= Date.now()) structureTokens.delete(token);
  const structureToken = command === 'schema.databaseDrop.apply' ? columns?.databaseDropRequest?.claimed?.main : command === structurePrefix + 'preview' ? structureTokens.get(input.snapshotId) : command === structurePrefix + 'apply' ? structureTokens.get(input.previewToken) : undefined;
  if ((command === structurePrefix + 'preview' && (structureToken?.kind !== 'snapshot' || structureToken.purpose !== structurePurpose)) || (command === structurePrefix + 'apply' && (structureToken?.kind !== 'preview' || structureToken.purpose !== structurePurpose))) throw new Error('结构快照或预览已失效或用途不符，请重新读取；未发送 DDL');
  if (command === structurePrefix + 'release') for (const id of [input.snapshotId, input.previewToken]) {
    const value = id ? structureTokens.get(id) : undefined;
    if (value && value.purpose !== structurePurpose) throw new Error('结构令牌用途不符，未释放其他编辑器的预览');
  }
  const columnRequest = structurePurpose === 'columns' ? columnsMain.begin(command, input, columns) : undefined;
  // 纯能力释放先同步撤销父及关联预览，退出/保存锁不得阻止精确回收。
  if (command === 'schema.columns.release') return columnsMain.release(columnRequest!, input);
  const requestConnectionId = structureToken?.connectionId ?? input.connectionId ?? sessions.get(input.sessionId)?.connectionId ?? (command.startsWith('connections.') ? input.id : undefined);
  // 入向关联只接收本次连接修订的结果；迟到响应不能成为新配置下的目录或数据。
  const incomingReferenceRead = command === 'table.incomingReferences' || command === 'table.childReferencePage';
  const incomingReferenceRevision = incomingReferenceRead ? store.connectionRevision() : undefined;
  if (incomingReferenceRead && shuttingDown) throw Error('客户端正在退出，不能读取子记录');
  // 统计只发布原连接修订的完整结果，退出或改目标后不显示迟到聚合。
  const tableStatisticsRead = command === 'table.statistics';
  const tableStatisticsRevision = tableStatisticsRead ? store.connectionRevision() : undefined;
  if (tableStatisticsRead && shuttingDown) throw Error('客户端正在退出，不能统计表数据');
  if (structureCommand && shuttingDown) throw new Error('客户端正在退出，不能开始结构操作');
  connectionConfig.assertAvailable(requestConnectionId);
  // 删除整库的原目标已由私有能力核验；投递前一次性撤销同源快照和全部兄弟预览。
  if (command === 'schema.databaseDrop.apply') {
    const claimed = columns?.databaseDropRequest?.claimed;
    if (!claimed || claimed.main !== structureToken) throw Error(databaseDropStale);
    for (const [id, value] of structureTokens) if (value.purpose === 'databaseDrop' && (id === claimed.snapshotId || value.snapshotId === claimed.snapshotId)) structureTokens.delete(id);
  }
  // 新建表在第一次等待前消费主进程能力；目的和修订仍由引擎独立核验。
  if (command === 'schema.databaseDefaultEncoding.apply' || command === 'schema.tableCreate.apply' || command === 'schema.tableCopyData.apply') structureTokens.delete(input.previewToken);
  if (command.startsWith('schema.compare') && shuttingDown) throw new Error('客户端正在退出，不能开始结构比较');
  if (command === 'serverMonitor.read' && shuttingDown) throw new Error('客户端正在退出，不能刷新服务器监控');
  if (command === 'schema.compare') { connectionConfig.assertAvailable(input.source.connectionId); connectionConfig.assertAvailable(input.target.connectionId); }
  switch (command) {
    case 'result.presets.list':
    case 'result.presets.save':
    case 'result.presets.rename':
    case 'result.presets.delete': {
      if(shuttingDown)throw Error('客户端正在退出，不能操作结果整理方案');
      columnsMain.assertCapturedOwner(columns);
      if(command!=='result.presets.list')resultPresetSources.assert(columns,input);
      const snapshot=command==='result.presets.list'?store.queryResultPresets(input):command==='result.presets.save'?store.saveQueryResultPreset(input):command==='result.presets.rename'?store.renameQueryResultPreset(input):store.deleteQueryResultPreset(input);
      const result=resultPresetSources.issue(columns,input,snapshot);
      // 返回IPC之前最后核对真实主文档、当前连接及准确文档修订；不把迟到列表当可应用事实。
      columns!.resultPresetPublication=()=>{
        resultPresetSources.assert(columns,{...input,bindingToken:result.bindingToken,source:result.source});connectionConfig.assertAvailable(input.connectionId);
        const current=store.queryResultPresets({connectionId:input.connectionId});
        if(current.revision!==result.revision||current.source.connectionRevision!==result.source.connectionRevision||current.source.connectionDigest!==result.source.connectionDigest)throw Error('方案或连接配置已变化，请刷新后重试');
      };
      return result;
    }
    case 'result.presets.read': {
      if(shuttingDown)throw Error('客户端正在退出，不能读取结果整理方案');
      resultPresetSources.assert(columns,input);const result=store.selectedQueryResultPreset(input);
      columns!.resultPresetPublication=()=>{resultPresetSources.assert(columns,input);connectionConfig.assertAvailable(input.connectionId);store.selectedQueryResultPreset(input);};
      return result;
    }
    case 'table.presets.list':
      if(shuttingDown)throw Error('客户端正在退出，不能读取方案');
      return tablePresetSources.issue(columns,input,store.tablePresets(input));
    case 'table.presets.save':
      if(shuttingDown)throw Error('客户端正在退出，不能保存方案');
      tablePresetSources.assert(columns,input);
      return tablePresetSources.issue(columns,input,store.saveTablePreset(input));
    case 'table.presets.delete':
      if(shuttingDown)throw Error('客户端正在退出，不能删除方案');
      tablePresetSources.assert(columns,input);
      return tablePresetSources.issue(columns,input,store.deleteTablePreset(input));
    case 'table.presets.apply': {
      const revision=store.connectionRevision();
      tablePresetSources.assert(columns,input);
      if(tasks.has(input.taskId)||completionTasks.has(input.taskId)||savedQueryPages?.owns(input.taskId)||historyPages?.owns(input.taskId)||completionTasks.size>=8)throw Error('方案读取任务编号已使用或读取繁忙');
      const state={cancelled:false,sent:false,stop:undefined as Promise<unknown>|undefined};tablePresetReads.set(input.taskId,state);completionTasks.add(input.taskId);
      const check=()=>{tablePresetSources.assert(columns,input);connectionConfig.assertAvailable(input.connectionId);if(state.cancelled||shuttingDown||store.connectionRevision()!==revision)throw Error('方案读取已取消或连接配置已变化');};
      let result:unknown,failure:unknown,failed=false;
      try {result=await applyTablePreset(input,{
        selected:value=>store.selectedTablePreset(value),
        assertCurrent:check,
        metadata:target=>{check();const profile=store.resolveConnection(target.connectionId);state.sent=true;return broker.request('metadata.table',{...target,profile});},
      });}catch(reason){failed=true;failure=reason;}
      // 不让finally中的await预定成功结果；原读取及严格取消结算结束后才判断是否允许发布。
      try{if(state.stop)await state.stop;}
      catch(reason){failure=failed?new AggregateError([failure,reason],'原方案读取失败且取消结算失败',{cause:failure}):reason;failed=true;}
      const release=()=>{tablePresetReads.delete(input.taskId);completionTasks.delete(input.taskId);};
      if(failed){release();throw failure;}
      const assertPublication=()=>{check();const {taskId:_taskId,...selected}=input;store.selectedTablePreset(selected);};
      try{
        assertPublication();
        if(!columns)throw Error('缺少真实方案发布来源');
        let settledStop=state.stop;
        columns.presetPublication={pendingStop:()=>state.stop===settledStop?undefined:state.stop,settledStop:stop=>{settledStop=stop;},assertCurrent:assertPublication,release};
        return result;
      }catch(reason){release();throw reason;}
    }
    // 监控使用主进程解密的目标配置，避免为了打开只读窗口另建一次不受任务管理的测试连接。
    case 'serverMonitor.read': input = { ...input, profile: store.resolveConnection(input.connectionId) }; break;
    // 无 await、无引擎调用：全部校验和生成通过后才一次写入系统剪贴板。
    case 'table.copyInsertSql': return copyInsertSql(input, sql => clipboard.writeText(sql));
    case 'workbench.get': return store.workbench();
    // 主进程只写入由严格对象身份生成的链接，不开放任意剪贴板读写权限。
    case 'workbench.copyUri': return clipboard.writeText(objectUri(input));
    case 'workbench.save':
      if (shuttingDown) throw new Error('客户端正在退出，不能修改收藏配置');
      return store.saveWorkbench(input);
    case 'workbench.resolve': {
      if (shuttingDown) throw new Error('客户端正在退出，不能打开收藏');
      const revision = store.connectionRevision();
      return resolveWorkbenchTarget(input, {
        connectionExists: id => store.queryConnectionExists(id),
        connect: async id => { await broker.request('connections.open', { id, profile: store.resolveConnection(id) }); },
        databases: id => broker.request('metadata.databases', { connectionId: id }),
        objects: (id, database) => broker.request('metadata.objects', { connectionId: id, database }),
        assertCurrent: () => {
          connectionConfig.assertAvailable(input.connectionId);
          if (shuttingDown || store.connectionRevision() !== revision) throw new Error('连接配置已变化，请重新打开对象');
        }
      });
    }
    case 'schema.compare': input = { ...input, sourceProfile: store.resolveConnection(input.source.connectionId), targetProfile: store.resolveConnection(input.target.connectionId) }; break;
    case 'table.incomingReferences':case 'table.childReferencePage':
      input = { ...input, profile: store.resolveConnection(input.connectionId) }; break;
    case 'table.statistics':
      input = { ...input, profile: store.resolveConnection(input.connectionId) }; break;
    case 'search.structure':case 'search.structureContinue':case 'search.dataStart':case 'search.recordRead':
      if(shuttingDown)throw Error('客户端正在退出，不能开始搜索');
      input={...input,profile:store.resolveConnection(input.connectionId)};break;
    case 'table.page':case 'table.copySourceRead': {
      if (command === 'table.page' && !input.copySource) break;
      // 表来源短读仅占用内存任务编号，沿原取消通道；不写执行历史或持久化行值。
      if (shuttingDown) throw new Error('客户端正在退出，不能读取完整复制源');
      if (tasks.has(input.taskId) || completionTasks.has(input.taskId) || savedQueryPages?.owns(input.taskId) || historyPages?.owns(input.taskId)) throw new Error('任务编号已使用');
      if (completionTasks.size >= 8) throw new Error('只读请求繁忙，请稍后再读取');
      connectionConfig.assertAvailable(input.connectionId); completionTasks.add(input.taskId);
      try { return await broker.request(command, { ...input, profile: store.resolveConnection(input.connectionId) }); }
      finally { completionTasks.delete(input.taskId); }
    }
    case 'metadata.completion':case 'search.catalogue': {
      if(shuttingDown)throw new Error('客户端正在退出，不能读取补全目录');
      if(tasks.has(input.taskId)||completionTasks.has(input.taskId)||savedQueryPages?.owns(input.taskId)||historyPages?.owns(input.taskId))throw new Error('任务编号已使用，请重新发起操作');
      if(completionTasks.size>=8)throw new Error('补全目录读取繁忙，请稍后触发');
      completionTasks.add(input.taskId);
      try{return await broker.request(command,{...input,profile:store.resolveConnection(input.connectionId)});}
      finally{completionTasks.delete(input.taskId);}
    }
    case 'query.cancel': {
      if(columns&&tasks.get(input.taskId)?.kind==='query.exportStream')queryInsertExports.assertOwned(input.taskId,columns);
      if(tablePresetReads.has(input.taskId))return cancelTablePresetRead(input.taskId);
      if(historyPages?.owns(input.taskId))return historyPages.cancel(input.taskId);
      if(savedQueryPages?.owns(input.taskId))return savedQueryPages.cancel(input.taskId);
      if(savedQuerySearches.has(input.taskId))return savedQuerySearches.cancel(input.taskId);
      if(tasks.get(input.taskId)?.kind.startsWith('search.savedQueries'))return;
      const preparing = preparingTasks.get(input.taskId);
      if (preparing) { preparing.cancelled = true; return; }
      break;
    }
    // 启动元信息不触发系统加密；保留原app.info用于显式检测及真实凭据能力。
    case 'app.runtimeInfo': return { version: app.getVersion(), platform: process.platform, dataPath: app.getPath('userData') };
    case 'app.info': return { version: app.getVersion(), platform: process.platform, encryptionAvailable: safeStorage.isEncryptionAvailable(), dataPath: app.getPath('userData') };
    case 'app.setDirty': hasPendingEdits = input.dirty; return;
    case 'connections.list': return store.connections();
    case 'connections.export': return queryFileOperation(async () => {
      const path = resolveFileToken(files, input.fileToken, 'connection-export', 'json');
      const release = await exportReservations.acquire(path);
      try { return await connectionTransfer.exportFile(path, input.connectionIds); } finally { release(); }
    });
    case 'connections.importPreview': return queryFileOperation(() => connectionTransfer.preview(resolveFileToken(files, input.fileToken, 'connection-import', 'json')));
    case 'connections.importReview': if (shuttingDown) throw new Error('客户端正在退出，不能导入连接'); return connectionTransfer.review(input);
    case 'connections.importReviewRelease': return connectionTransfer.releaseReview(input);
    case 'connections.importApply': return queryFileOperation(() => connectionTransfer.applyBatch(input));
    case 'connections.organizationGet':
      if (shuttingDown) throw Error('客户端正在退出，不能读取连接整理');
      return store.connectionOrganization();
    case 'connections.organizationApply':
      if (shuttingDown) throw Error('客户端正在退出，不能整理连接');
      // 同步核完整批次，没有await或凭据解析，不能跨过正在保存的连接配置。
      for (const id of input.ids) connectionConfig.assertAvailable(id);
      // INSERT 导出能力绑定全局修订；等原请求 finally 释放账本后才允许整理，不主动取消导出。
      if ([...tasks.values()].some(task => task.kind === 'query.exportStream' && queryInsertExports.has(task.id))) throw Error(connectionOrganizationZh.busyExport);
      return store.applyConnectionOrganization(input);
    case 'connections.save': {
      // 保留原保存检查：被拒绝的配置修改不得先取消任务；成功保存后才撤销本片旧修订能力。
      const saved=await connectionConfig.save(confirmConnectionFiles(input,store.connections().find(profile=>profile.id===input.id),files));
      if([...tasks.values()].some(task=>task.kind==='query.exportStream'&&task.status==='running'))queryInsertExports.invalidateAll();
      return saved;
    }
    case 'connections.delete': await broker.request('connections.close', input); store.deleteConnection(input.id); return;
    case 'connections.open': input = { ...input, profile: store.resolveConnection(input.id) }; break;
    case 'connections.test': {
      const previous = store.connections().find(profile => profile.id === input.id);
      input = { ...input, pendingFiles: [...new Set([...previous?.pendingFiles ?? [], ...input.pendingFiles ?? []])] };
      assertConnectionReady(input); input = store.resolveConnection(input.id, input as ConnectionProfile); break;
    }
    case 'connections.close':
      for (const [id, session] of sessions) if (session.connectionId === input.id) sessions.delete(id);
      for (const [token, value] of structureTokens) if (value.connectionId === input.id) structureTokens.delete(token);
      break;
    case 'table.preferences.get': return store.tablePreferences(input);
    case 'table.preferences.save': return store.saveTablePreferences(input);
    case 'table.preferences.reset': return store.resetTablePreferences(input);
    case 'queries.list': return store.queries();
    case 'queries.read': { const result = savedQuerySearches.read(input); return { ...result, sourceBinding: store.bindQuerySource(input.id, input.digest) }; }
    case 'queries.pageRelease':return savedQueryPages.release(input);
    case 'queries.deleteChecked':if(shuttingDown)throw Error('客户端正在退出，不能删除保存查询');return savedQueryPages.deleteChecked(input);
    case 'queries.page':case 'queries.pageContinue':case 'history.page':case 'history.pageContinue':{
      if(shuttingDown)throw Error('客户端正在退出，不能读取查询列表');
      if(tasks.has(input.taskId)||completionTasks.has(input.taskId)||savedQueryPages?.owns(input.taskId)||historyPages?.owns(input.taskId))throw Error('请求编号已使用');
      // 列表和补全同属高频短读，活动编号只放内存，不逐次写任务或执行历史。
      completionTasks.add(input.taskId);try{return command==='queries.page'?await savedQueryPages.start(input):command==='queries.pageContinue'?await savedQueryPages.next(input):command==='history.page'?await historyPages.start(input):await historyPages.next(input);}finally{completionTasks.delete(input.taskId);}
    }
    case 'search.savedQueriesRelease':return savedQuerySearches.release(input);
    case 'search.savedQueries':case 'search.savedQueriesContinue':if(shuttingDown)throw Error('客户端正在退出，不能搜索本地查询');break;
    case 'snippets.list': return store.snippets();
    case 'snippets.save': return store.saveSnippet(input);
    case 'snippets.delete': return store.deleteSnippet(input.id);
    case 'queries.create': if(shuttingDown)throw Error('客户端正在退出，不能保存查询'); return store.createBoundQuery(input);
    case 'queries.updateSource': if(shuttingDown)throw Error('客户端正在退出，不能更新原查询'); connectionConfig.assertAvailable(input.content.connectionId); return store.updateBoundQuery(input);
    case 'queries.save': return store.createLegacyQuery({ ...input, updatedAt: new Date().toISOString() });
    case 'queries.delete': return store.deleteQuery(input.id);
    case 'history.list': return store.history(input.connectionId);
    case 'history.pageRelease':return historyPages.release(input);
    case 'history.read':return historyPages.read(input);
    case 'history.readError':return historyPages.readError(input);
    case 'table.applyReceipt.list': return store.tableApplyReceipts(input);
    case 'table.applyReceipt.detail': return store.tableApplyReceipt(input.operationId);
    case 'tasks.list': return store.tasks();
    case 'tasks.cancelState': return taskCancelSnapshot(input.taskIds, tasks, (id, operationId) => tableApplyReceipts.cancelState(id, operationId)).map(item => tasks.get(item.taskId)?.status === 'running' && tasks.get(item.taskId)?.kind.startsWith('queryFileSources.') ? { ...item, state: queryFileSources.cancelState(item.taskId) } : item);
    case 'settings.get': rendererHasSettings = true; return store.settings();
    case 'settings.save': {
      try { store.saveSettings(input); rendererSettingsCurrent = true; stateFlushed?.resolve(); }
      catch (error) { rendererSettingsCurrent = false; stateFlushed?.reject(error instanceof Error ? error : new Error(String(error))); throw error; }
      finally { stateFlushed = undefined; }
      return;
    }
    case 'files.choose': return input.queryInsertExport ? chooseQueryInsertFile(input,columns) : input.resultSqlPreviewId ? chooseResultSqlFile(input, columns) : chooseFile(input);
    case 'files.path': { const file = files.get(input.token); if (!file) throw new Error('文件选择已失效，请重新选择'); return file.path; }
    case 'files.readQuery': return queryFileOperation(() => readQueryFile(resolveFileToken(files, input.fileToken, 'query', 'sql'), input.encoding));
    case 'files.writeQuery': return queryFileOperation(() => writeSelectedQuery(input));
    case 'query.exportStream': if(input.format==='sql')columnsMain.assertCapturedOwner(columns);else input = { ...input, filePath: resolveFileToken(files,input.fileToken,'export',input.format==='csv-zip'?'zip':input.format) }; break;
    case 'excel.sheets':
    case 'excel.preview':
    case 'excel.import':
    case 'excel.export': input = { ...input, filePath: resolveFileToken(files, input.fileToken, command === 'excel.export' ? 'export' : 'import', 'xlsx') }; break;
    case 'files.preview':
    case 'files.import':
    case 'files.export':
    case 'files.exportResult': {
      if (command === 'files.exportResult' && input.format === 'sql') {
        columnsMain.assertCapturedOwner(columns);
        input = { ...input, filePath: resultSqlPreviews.consume(input, columns!.owner.document) }; break;
      }
      const expected = command === 'files.export' || command === 'files.exportResult' ? 'export' : 'import';
      // 已返回XLSX只消费本窗口明确选择的Excel文件能力，不借其它导出格式令牌。
      input = { ...input, filePath: resolveFileToken(files, input.fileToken, expected, command === 'files.exportResult' && input.format === 'xlsx' ? 'xlsx' : undefined) }; break;
    }
  }
  const taskId: string | undefined = command !== 'query.cancel' ? input.taskId : undefined;
  const startedAt = new Date().toISOString(); const start = Date.now();
  if (taskId) {
    if (tasks.has(taskId)||completionTasks.has(taskId)||savedQueryPages?.owns(taskId)||historyPages?.owns(taskId)) throw new Error('任务编号已使用，请重新发起操作');
    const task: TaskRecord = { id: taskId, kind: command, status: 'running', progress: 0, message: '正在执行', startedAt };
    tasks.set(taskId, task); store.saveTask(task);
  }
  const session = sessions.get(input.sessionId);
  const currentStatement = command === 'query.execute' && input.currentStatement !== undefined;
  const history: HistoryEntry | undefined = (command === 'query.execute' || command === 'query.executeParameterized' || command === 'query.exportStream') && session ? { id: randomUUID(), connectionId: session.connectionId, databaseContext:{state:'unknown'}, sql: currentStatement ? '' : input.sql, startedAt, elapsedMs: 0, success: false } : undefined;
  const pendingHistory = history ? { entry: history, currentStatement, executionSqlReceived: !currentStatement } : undefined;
  if(pendingHistory&&taskId)pendingQueryHistory.set(taskId,pendingHistory);
  const preparing: { cancelled: boolean; failure?: string; connectionIds?: string[] } = { cancelled: false, connectionIds: command === 'schema.compare' ? [input.source.connectionId, input.target.connectionId] : requestConnectionId ? [requestConnectionId] : [] }; if (taskId) preparingTasks.set(taskId, preparing);
  let releaseTarget: (() => void) | undefined;
  let sentToEngine = false;
  const previewConnectionRevision = command === 'table.preview' ? store.connectionRevision() : 0;
  try {
    if(command==='query.exportStream'&&input.format==='sql')input={...input,filePath:queryInsertExports.begin(input,columns)};
    if (command === 'query.exportStream' || command === 'files.export' || command === 'files.exportResult' || command === 'excel.export') releaseTarget = await exportReservations.acquire(input.filePath);
    if (preparing.failure) throw new Error(preparing.failure);
    // 文件路径归一化期间的取消在主进程捕获，不能丢失后继续发送用户 SQL。
    if (preparing.cancelled) throw new Error('任务在准备阶段已取消，尚未发送用户 SQL；原目标文件保持不变');
    connectionConfig.assertAvailable(requestConnectionId);
    if(command==='query.exportStream'&&input.format==='sql')queryInsertExports.assert(input.taskId);
    if (command === 'files.exportResult' && input.format === 'sql') columnsMain.assertCapturedOwner(columns);
  // 新建表在第一次等待前消费主进程能力；目的和修订仍由引擎独立核验。
  if (command === 'schema.databaseDefaultEncoding.apply' || command === 'schema.tableCreate.apply' || command === 'schema.tableCopyData.apply') structureTokens.delete(input.previewToken);
    if (command === 'table.apply') {
      const binding = tableApplyReceipts.prepare(input.taskId, input.previewId, { connectionId: input.connectionId, connectionRevision: store.connectionRevision(), database: input.database, table: input.table }, input.changes);
      const linked = { ...tasks.get(input.taskId)!, tableApplyReceiptId: binding.operationId };
      store.saveTask(linked); tasks.set(input.taskId, linked);
      input = { ...input, tableApplyBinding: binding };
    }
    // 令牌目标只来自可信引擎输出；修订在投递前同步读取，客户端不能注入或覆盖。
    if (structureCommand && command !== structurePrefix + 'release') input = { ...input, connectionRevision: store.connectionRevision() };
    if (columnRequest) columnsMain.beforeSend(columnRequest, input.connectionRevision);
    if (command === 'files.exportColumns' || command === 'files.export' && input.csvSelection) input = { ...input, connectionRevision: store.connectionRevision() };
    if (command.startsWith('schema.compare')) {
      input = { ...input, connectionRevision: store.connectionRevision() };
      if (command === 'schema.compare') { connectionConfig.assertAvailable(input.source.connectionId); connectionConfig.assertAvailable(input.target.connectionId); }
    }
    if (taskId) preparingTasks.delete(taskId);
    sentToEngine = true;
    const result = command==='search.savedQueries'?await savedQuerySearches.start(input):command==='search.savedQueriesContinue'?await savedQuerySearches.next(input):await broker.request(command, input);
    if (incomingReferenceRead && (shuttingDown || incomingReferenceRevision !== store.connectionRevision())) throw Error('连接配置或客户端状态已变化，请重新打开子记录');
    if (tableStatisticsRead && (shuttingDown || tableStatisticsRevision !== store.connectionRevision())) throw Error('连接配置或客户端状态已变化，请重新统计表数据');
    if (columnRequest && (command === 'schema.columns.get' || command === 'schema.columns.preview')) {
      try { columnsMain.publish(columnRequest, result); }
      catch (error) { await columnsMain.rejectReply(columnRequest, error); }
    }
    if ((structurePurpose === 'tableCreate' || structurePurpose === 'databaseDefaultEncoding') && (command === structurePrefix + 'get' || command === structurePrefix + 'preview') && store.connectionRevision() !== input.connectionRevision) {
      await broker.request(structurePurpose === 'tableCreate' ? 'schema.tableCreate.release' : 'schema.databaseDefaultEncoding.release', command === structurePrefix + 'get' ? { snapshotId: result.snapshotId } : { previewToken: result.previewToken });
      throw Error(tableCreateMessages.stale);
    }
    if (command === 'table.preview' && previewConnectionRevision !== store.connectionRevision()) throw Error('连接配置自预览开始后已变化，请重新预览');
    if (command === 'table.preview') return { ...result, ...tableApplyReceipts.preview({ connectionId: input.connectionId, connectionRevision: store.connectionRevision(), database: input.database, table: input.table }, input.changes, result) };
    if (structurePurpose === 'databaseDrop' && (command === structurePrefix + 'get' || command === structurePrefix + 'preview')) publishDatabaseDrop(input, result, columns!);
    if (structurePurpose !== 'columns' && structurePurpose !== 'databaseDrop' && (command === structurePrefix + 'get' || command === structurePrefix + 'preview')) {
      const token = command === structurePrefix + 'get' ? result.snapshotId : result.previewToken;
      if (structurePurpose === 'databaseDefaultEncoding' && (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token) || structureTokens.has(token))) throw Error('数据库默认编码返回了无效或重复能力，原有预览保持不变');
      if (structureTokens.size >= 128) {
        if (structurePurpose === 'databaseDefaultEncoding') await broker.request('schema.databaseDefaultEncoding.release', command === structurePrefix + 'get' ? { snapshotId: result.snapshotId } : { previewToken: result.previewToken });
        throw new Error('结构令牌缓存已达上限，请关闭旧预览后重试');
      }
      structureTokens.set(token, { purpose: structurePurpose!, connectionId: result.target.connectionId, expires: Date.parse(result.expiresAt), kind: command === structurePrefix + 'get' ? 'snapshot' : 'preview', ...(command === structurePrefix + 'preview' ? { snapshotId: input.snapshotId } : {}) });
    }
    if (command === structurePrefix + 'release') {
      if (input.snapshotId) for (const [token, value] of structureTokens) if (value.purpose === structurePurpose && (token === input.snapshotId || value.snapshotId === input.snapshotId)) structureTokens.delete(token);
      if (input.previewToken) structureTokens.delete(input.previewToken);
    }
    if (command === 'sessions.open') sessions.set(result.sessionId, { connectionId: input.connectionId });
    if (command === 'sessions.close') sessions.delete(input.sessionId);
    if (command === 'table.apply' && !tableApplyReceipts.confirmed(taskId!)) throw Error('未收到可信提交确认，结果未知；请查看提交记录，不要重复执行原批次');
    // 查询可带首错停止前的完整结果返回；响应成功不代表整份脚本执行成功。
    const queryFailure = command === 'query.execute' || command === 'query.executeParameterized' ? result?.failure : undefined;
    const terminalStatus = taskId ? tasks.get(taskId)?.status : undefined;
    if (taskId && queryFailure && (terminalStatus === 'running' || terminalStatus === 'completed')) taskEvent({ taskId, status: 'failed', progress: 100, message: queryFailure.message });
    else if (taskId && command!=='search.dataStart' && terminalStatus === 'running') taskEvent({ taskId, status: 'completed', progress: 100, message: '执行完成' });
    if (history && pendingHistory?.executionSqlReceived) persistAuxiliary(() => store.addHistory({ ...history, elapsedMs: Date.now() - start, success: !queryFailure, ...(queryFailure ? { error: persistedQueryError(command, queryFailure.message) } : {}) }));
    return command === 'table.apply' ? { ...result, ...tableApplyReceipts.finish(taskId!) } : result;
  } catch (error) {
    if (command === 'table.apply' && taskId && !sentToEngine) tableApplyReceipts.notDispatched(taskId);
    if (command === 'table.apply' && taskId && tableApplyReceipts.confirmed(taskId)) {
      const confirmed = tableApplyReceipts.confirmed(taskId)!; tableApplyReceipts.cleanupFailed(taskId);
      taskEvent({ taskId, status: 'completed', progress: 100, message: '服务器已确认目标事务提交，后续收尾异常；请查看提交记录' });
      return { affectedRows: confirmed.evidence.serverReportedRows, cleanupWarning: true, ...tableApplyReceipts.finish(taskId) };
    }
    const message = error instanceof Error ? error.message : '操作失败';
    if (taskId && tasks.get(taskId)?.status === 'running') taskEvent({ taskId, status: preparing.cancelled || error instanceof SavedQuerySearchCancelled ? 'cancelled' : 'failed', progress: 0, message, ...(structureCommand ? { [structurePurpose === 'tableCreate' ? 'tableCreate' : structurePurpose === 'tableCopyData' ? 'tableCopyData' : structurePurpose === 'tableCopyStructure' ? 'tableCopyStructure' : structurePurpose === 'databaseDrop' ? 'databaseDrop' : structurePurpose === 'databaseDefaultEncoding' ? 'databaseDefaultEncoding' : structurePurpose === 'databaseCreate' ? 'databaseCreate' : structurePurpose === 'tableRename' ? 'tableRename' : structurePurpose === 'tableAutoIncrement' ? 'tableAutoIncrement' : structurePurpose === 'tableDefaultEncoding' ? 'tableDefaultEncoding' : structurePurpose === 'tableDrop' ? 'tableDrop' : structurePurpose === 'tableTruncate' ? 'tableTruncate' : structurePurpose === 'tableComment' ? 'tableComment' : structurePurpose === 'indexes' ? 'indexPatch' : structurePurpose === 'foreignKeys' ? 'foreignKeyPatch' : 'columnPatch']: { phase: 'connecting' as const, ddlSubmitted: sentToEngine && command === structurePrefix + 'apply', ddlCompleted: false, definitionVerified: false, outcome: sentToEngine && command === structurePrefix + 'apply' ? 'unknown' as const : 'not-sent' as const, ...structureProgress.get(taskId) } } : {}), ...(command === 'query.exportStream' ? { queryExport: { phase: 'preparing' as const, statementsCompleted: 0, rowsWritten: 0, bytesWritten: 0, fileCommitted: false, ...exportProgress.get(taskId), sqlMayHaveExecuted: sentToEngine, transactionKnown: false } } : {}) });
    if (history && pendingHistory?.executionSqlReceived) persistAuxiliary(() => store.addHistory({ ...history, elapsedMs: Date.now() - start, error: persistedQueryError(command, message) }));
    throw error;
  } finally { if (command === 'table.apply' && taskId) tableApplyReceipts.finish(taskId); if (command === structurePrefix + 'apply') structureTokens.delete(input.previewToken); if (taskId) { pendingQueryHistory.delete(taskId); preparingTasks.delete(taskId); exportProgress.delete(taskId); structureProgress.delete(taskId); } if(command==='query.exportStream'&&input.format==='sql')queryInsertExports.finish(input.taskId); releaseTarget?.(); }
}

/** 按平台生成中文原生菜单，查询快捷键统一发送给当前工作区。 */
function createMenu(): void {
  const action = (name: string) => () => window?.webContents.send('dbark:menu', name);
  const mac = process.platform === 'darwin';
  const menu: Electron.MenuItemConstructorOptions[] = [
    ...(mac ? [{ label: 'DBArk', submenu: [{ label: '关于 DBArk', role: 'about' }, { type: 'separator' }, { label: '隐藏 DBArk', role: 'hide' }, { label: '退出 DBArk', role: 'quit' }] } as Electron.MenuItemConstructorOptions] : []),
    { label: '文件', submenu: [{ label: '新建连接', accelerator: 'CmdOrCtrl+Shift+N', click: action('new-connection') }, { label: '新建查询', accelerator: 'CmdOrCtrl+N', click: action('new-query') }, { label: '打开 SQL 文件', accelerator: 'CmdOrCtrl+O', click: action('open-sql-file') }, { label: '最近 SQL 文件', click: action('recent-sql-file') }, { label: '另存 SQL 文件', accelerator: 'CmdOrCtrl+Shift+S', click: action('save-sql-file') }, { label: '保存查询', accelerator: 'CmdOrCtrl+S', click: action('save-query') }, { type: 'separator' }, { label: '退出', role: 'quit' }] },
    { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
    { label: '查询', submenu: [{ label: '执行查询', accelerator: 'CmdOrCtrl+Enter', click: action('execute') },{label:'全库搜索',accelerator:'CmdOrCtrl+Shift+F',click:action('structure-search')}] },
    { label: '视图', submenu: [{ label: '切换明暗主题', click: action('toggle-theme') }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { label: '重置缩放', role: 'resetZoom' }, { label: '全屏', role: 'togglefullscreen' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
}

/** 创建启用沙箱与上下文隔离的窗口，限制导航并等待页面就绪后显示。 */
async function createWindow(): Promise<void> {
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 1024, minHeight: 680, show: false, backgroundColor: '#101319', title: 'DBArk', icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png'), webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false } });
  columnsMain.trackWindow(window);
  // 主文档换代立即撤销尚未确认的暂存发布，不依赖旧renderer继续发送取消。
  window.webContents.on('did-start-navigation',details=>{if(details.isMainFrame&&!details.isSameDocument)queryInsertExports.invalidateAll();});
  window.webContents.on('did-navigate',()=>queryInsertExports.invalidateAll());
  window.webContents.on('render-process-gone',()=>queryInsertExports.invalidateAll());
  window.webContents.on('destroyed',()=>queryInsertExports.invalidateAll());
  // 导航仅取消文件来源的在途意图，私有重启授权仍属于保存的查询文档。
  window.webContents.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) queryFileSources.invalidate(); });
  window.webContents.on('did-navigate', () => queryFileSources.invalidate());
  window.webContents.on('render-process-gone', () => queryFileSources.invalidate());
  window.webContents.on('destroyed', () => queryFileSources.invalidate());
  window.webContents.on('did-start-navigation',details=>{if(details.isMainFrame&&!details.isSameDocument)invalidateTablePresetSources();});
  window.webContents.on('did-navigate',invalidateTablePresetSources);
  window.webContents.on('render-process-gone',invalidateTablePresetSources);
  window.webContents.on('destroyed',invalidateTablePresetSources);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== rendererURL) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window?.show());
  window.on('close', event => { if (!shutdownComplete) { event.preventDefault(); app.quit(); } });
  window.on('closed', () => { window = undefined; resultSqlPreviews.clear(); files.clear(); });
  await window.loadURL(rendererURL);
}

/** 关闭前提示仍在执行的任务，退出后不得留下数据库执行进程。 */
app.on('before-quit', event => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    if ((hasPendingEdits || [...tasks.values()].some(t => t.status === 'running')) && window) {
      const answer = await dialog.showMessageBox(window, { type: 'warning', title: '仍有待完成的工作', message: '退出会放弃尚未提交的表格修改、断开数据库连接并回滚未提交事务。已提交的操作不会撤销。', buttons: ['继续工作','退出客户端'], defaultId: 0, cancelId: 0 });
      if (answer.response === 0) { shuttingDown = false; return; }
    }
    // 先让界面把防抖队列里的最新编辑落盘，再关闭配置库。
    if (rendererHasSettings && window && !window.isDestroyed()) {
      await Promise.race([new Promise<void>((resolve, reject) => { stateFlushed = { resolve, reject }; window!.webContents.send('dbark:menu', 'persist-state'); }), new Promise((_, reject) => setTimeout(() => reject(new Error('工作台未能及时保存状态')), 3000))]);
      stateFlushed = undefined;
    }
    await savedQuerySearches?.close();await savedQueryPages?.close();await historyPages?.close();await Promise.allSettled([...localSearchOperations]);
    await Promise.allSettled([...queryFileOperations]);
    await broker?.close();
    tableApplyReceipts?.interrupt();
    for (const task of tasks.values()) if (task.status === 'running') {
      const committed = task.kind === 'table.apply' && tableApplyReceipts?.confirmed(task.id);
      persistAuxiliary(() => store.saveTask({ ...task, status: committed ? 'completed' : 'cancelled', finishedAt: new Date().toISOString(), message: committed ? '服务器已确认目标事务提交；请查看提交记录' : '客户端已退出，请核对操作结果' }));
    }
    store?.close(); shutdownComplete = true; app.quit();
  })().catch(async error => {
    stateFlushed = undefined;
    const answer = await dialog.showMessageBox({ type: 'error', title: '退出前保存或收尾失败', message: error instanceof Error ? error.message : String(error), detail: '返回工作台可排查后重试。强制退出会终止本地执行进程并放弃未保存配置，不能确认远端操作已停止，也不能撤销已提交操作。', buttons: ['返回工作台','强制退出客户端'], defaultId: 0, cancelId: 0 });
    if (answer.response === 1) {
      await savedQuerySearches?.close();await savedQueryPages?.close();await historyPages?.close();await Promise.allSettled([...localSearchOperations]);
      await Promise.allSettled([...queryFileOperations]);
      try { broker?.forceClose(); } catch (failure) { shuttingDown = false; dialog.showErrorBox('强制退出失败', failure instanceof Error ? failure.message : '数据库执行进程未能终止'); return; }
      try { store?.close(); } catch { /* 用户已明确选择退出，避免退出状态永久锁死。 */ }
      shutdownComplete = true; app.quit();
    } else shuttingDown = false;
  });
});
app.on('window-all-closed', () => app.quit());

/** 进程退出使所有尚未投递的准备请求失效，迟到的文件检查不能启动新进程继续写入。 */
function engineExited(): void {
  tableApplyReceipts?.interrupt();
  // 本地保存查询的匹配线程独立于数据库工具进程，不能被数据库进程退出误判为失败。
  for (const preparing of preparingTasks.values()) preparing.failure = '数据库进程已退出，准备任务已停止；尚未发送用户 SQL，原目标文件保持不变';
  sessions.clear();
  structureTokens.clear();
  for (const task of tasks.values()) if (task.status === 'running'&&!task.kind.startsWith('search.savedQueries')) {
    const preparing = preparingTasks.has(task.id);
    if (task.kind.startsWith('schema.databaseDrop.') || task.kind.startsWith('schema.tableCreate.') || task.kind.startsWith('schema.tableCopyData.') || task.kind.startsWith('schema.tableCopyStructure.') || task.kind.startsWith('schema.databaseDefaultEncoding.') || task.kind.startsWith('schema.databaseCreate.') || task.kind.startsWith('schema.tableRename.') || task.kind.startsWith('schema.tableAutoIncrement.') || task.kind.startsWith('schema.tableDefaultEncoding.') || task.kind.startsWith('schema.tableDrop.') || task.kind.startsWith('schema.tableTruncate.') || task.kind.startsWith('schema.tableComment.') || task.kind.startsWith('schema.columns.') || task.kind.startsWith('schema.indexes.') || task.kind.startsWith('schema.foreignKeys.')) {
      const last = structureProgress.get(task.id), possiblySent = !preparing && (task.kind === 'schema.databaseDrop.apply' || task.kind === 'schema.tableCreate.apply' || task.kind === 'schema.tableCopyData.apply' || task.kind === 'schema.tableCopyStructure.apply' || task.kind === 'schema.databaseDefaultEncoding.apply' || task.kind === 'schema.databaseCreate.apply' || task.kind === 'schema.tableRename.apply' || task.kind === 'schema.tableAutoIncrement.apply' || task.kind === 'schema.tableDefaultEncoding.apply' || task.kind === 'schema.tableDrop.apply' || task.kind === 'schema.tableTruncate.apply' || task.kind === 'schema.tableComment.apply' || task.kind === 'schema.columns.apply' || task.kind === 'schema.indexes.apply' || task.kind === 'schema.foreignKeys.apply');
      const progress: TableColumnApplyProgress = { ...last, phase: last?.phase ?? 'connecting', ddlSubmitted: Boolean(last?.ddlSubmitted || possiblySent), ddlCompleted: last?.ddlCompleted ?? false, definitionVerified: last?.definitionVerified ?? false, outcome: task.kind.startsWith('schema.tableCopyData.') ? ((last as import('../shared/tableCopyData').TableCopyDataProgress)?.dataCompleted ? 'succeeded' : last?.ddlSubmitted || possiblySent ? 'unknown' : 'not-sent') : last?.ddlCompleted ? 'succeeded' : possiblySent ? 'unknown' : 'not-sent' };
      taskEvent({ taskId: task.id, status: 'failed', progress: task.progress, message: '数据库进程已退出，结构操作不会自动重放，请核对最新定义', ...(task.kind.startsWith('schema.databaseDrop.') ? { databaseDrop: progress } : task.kind.startsWith('schema.tableCreate.') ? { tableCreate: progress } : task.kind.startsWith('schema.tableCopyData.') ? { tableCopyData: progress } : task.kind.startsWith('schema.tableCopyStructure.') ? { tableCopyStructure: progress } : task.kind.startsWith('schema.databaseDefaultEncoding.') ? { databaseDefaultEncoding: progress } : task.kind.startsWith('schema.databaseCreate.') ? { databaseCreate: progress } : task.kind.startsWith('schema.tableRename.') ? { tableRename: progress } : task.kind.startsWith('schema.tableAutoIncrement.') ? { tableAutoIncrement: progress } : task.kind.startsWith('schema.tableDefaultEncoding.') ? { tableDefaultEncoding: progress } : task.kind.startsWith('schema.tableDrop.') ? { tableDrop: progress } : task.kind.startsWith('schema.tableTruncate.') ? { tableTruncate: progress } : task.kind.startsWith('schema.tableComment.') ? { tableComment: progress } : task.kind.startsWith('schema.indexes.') ? { indexPatch: progress } : task.kind.startsWith('schema.foreignKeys.') ? { foreignKeyPatch: progress } : { columnPatch: progress }) });
      continue;
    }
    taskEvent({ taskId: task.id, status: 'failed', progress: task.progress, message: '数据库进程已退出，请核对操作结果并重新连接', ...(task.kind === 'query.exportStream' ? { queryExport: { phase: 'executing' as const, statementsCompleted: 0, rowsWritten: 0, bytesWritten: 0, fileCommitted: false, ...exportProgress.get(task.id), ...(preparing ? { phase: 'preparing' as const } : {}), sqlMayHaveExecuted: !preparing, transactionKnown: false } } : {}) });
  }
}

if (!app.requestSingleInstanceLock()) { shutdownComplete = true; app.quit(); }
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  void app.whenReady().then(async () => {
    const wasm = app.isPackaged ? join(process.resourcesPath, 'sql-wasm.wasm') : require.resolve('sql.js/dist/sql-wasm.wasm');
    store = await LocalStore.open(join(app.getPath('userData'), 'dbark.sqlite'), wasm, { available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value).toString('base64'), decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64')) });
    tableApplyReceipts = new TableApplyReceipts(store, () => persistAuxiliary(() => { throw Error('提交记录保存失败'); }));
    broker = new EngineBroker(engineTaskEvent, engineExited);
    connectionConfig = new ConnectionConfigManager(store, broker, {
      /** 主进程会话与尚未投递的长任务也必须为空；真实引擎继续检查建连、事务和独立任务。 */
      assertIdle: ids => {
        if (shuttingDown || !rendererSettingsCurrent || [...sessions.values()].some(session => ids.includes(session.connectionId)) || [...preparingTasks.values()].some(task => task.connectionIds?.some(id => ids.includes(id)))) throw new Error(connectionReplacementText.active);
      },
      revokeFiles: ids => {
        revokeConnectionFiles(ids, files);
        for (const [token, value] of structureTokens) if (ids.includes(value.connectionId)) structureTokens.delete(token);
      },
    });
    queryFileSources = new QueryFileSources({ store, report: taskEvent, reserve: path => exportReservations.acquire(path), choose: async (mode, name) => {
      if (!window) throw Error('文件选择窗口已关闭');
      const filters = [{ name: 'SQL文件', extensions: ['sql'] }];
      if (mode === 'open') { const result = await dialog.showOpenDialog(window, { title: '打开SQL文件', properties: ['openFile'], filters }); return result.canceled ? undefined : result.filePaths[0]; }
      const result = await dialog.showSaveDialog(window, { title: '另存SQL文件', defaultPath: name ?? '查询.sql', filters }); return result.canceled ? undefined : result.filePath;
    } });
    connectionTransfer = new ConnectionTransfer(store, Date.now, undefined, connectionConfig);
    explainSnapshotFiles = new ExplainSnapshotFiles({ reserve: path => exportReservations.acquire(path), choose: async mode => {
      const ownerWindow = window;
      if (!ownerWindow) throw Error(explainSnapshotZh.stale);
      const filters = [{ name: 'DBArk 执行计划快照', extensions: ['json'] }];
      if (mode === 'open') {
        const selected = await dialog.showOpenDialog(ownerWindow, { title: explainSnapshotZh.choose, properties: ['openFile'], filters });
        return selected.canceled ? undefined : selected.filePaths[0];
      }
      const selected = await dialog.showSaveDialog(ownerWindow, { title: explainSnapshotZh.save, defaultPath: explainSnapshotZh.defaultName, filters });
      return selected.canceled ? undefined : selected.filePath;
    } });
    snippetTransfers = new SnippetTransfers(store, { choose: async mode => {
      if (!window) throw Error(snippetTransferZh.stale);
      const filters = [{ name: 'SQL片段 JSON', extensions: ['json'] }];
      if (mode === 'import') { const selected = await dialog.showOpenDialog(window, { title: snippetTransferZh.import, properties: ['openFile'], filters }); return selected.canceled ? undefined : selected.filePaths[0]; }
      const selected = await dialog.showSaveDialog(window, { title: snippetTransferZh.export, defaultPath: 'SQL片段.json', filters }); return selected.canceled ? undefined : selected.filePath;
    } });
    savedQuerySearches=new SavedQuerySearches(store,join(__dirname,'savedQuerySearchWorker.cjs'),taskEvent);
    savedQueryPages=new SavedQueryPages(store,join(__dirname,'savedQuerySearchWorker.cjs'));
    historyPages=new HistoryPages(store,join(__dirname,'savedQuerySearchWorker.cjs'));
    ipcMain.handle('dbark:request', async (event, payload: unknown) => {
      let columns: MainInvocation | undefined;
      let databaseEncodingCommand: DatabaseEncodingOwnerCommand | undefined, databaseEncodingResult: unknown;
      try {
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== rendererURL) throw new Error('不允许的请求来源');
        if (!payload || typeof payload !== 'object' || !('command' in payload) || !('input' in payload) || typeof payload.command !== 'string') throw new Error('请求格式无效');
        const fileCancel = Boolean(payload.command === 'query.cancel' && payload.input && typeof payload.input === 'object' && 'taskId' in payload.input && typeof payload.input.taskId === 'string' && tasks.get(payload.input.taskId)?.kind.startsWith('queryFileSources.'));
        const insertRequest = payload.command==='query.confirmInsertExport' || payload.command==='query.exportStream' && !!payload.input && typeof payload.input==='object' && 'format' in payload.input && payload.input.format==='sql' || payload.command==='files.choose' && !!payload.input && typeof payload.input==='object' && 'queryInsertExport' in payload.input || payload.command==='query.cancel' && !!payload.input && typeof payload.input==='object' && 'taskId' in payload.input && typeof payload.input.taskId==='string' && queryInsertExports.has(payload.input.taskId);
        const resultSql = payload.command === 'files.previewResultSql' || payload.command === 'files.releaseResultSql' || (payload.command === 'files.exportResult' || payload.command === 'files.choose') && !!payload.input && typeof payload.input === 'object' && ('format' in payload.input && payload.input.format === 'sql') && (payload.command === 'files.exportResult' || 'resultSqlPreviewId' in payload.input);
        if (payload.command.startsWith('schema.databaseDrop.')) columns = columnsMain.capture(event);
        if (payload.command.startsWith('schema.databaseDefaultEncoding.')) {
          columns = columnsMain.capture(event); columns.databaseEncodingRevision = store.connectionRevision();
          databaseEncodingCommand = payload.command.slice('schema.databaseDefaultEncoding.'.length) as DatabaseEncodingOwnerCommand;
        }
        if (payload.command.startsWith('explainFiles.')||payload.command.startsWith('schema.columns.')||payload.command.startsWith('table.presets.')||payload.command.startsWith('result.presets.')||payload.command.startsWith('queryFileSources.')||fileCancel||resultSql||insertRequest||payload.command.startsWith('snippets.transfer')) columns = columnsMain.capture(event);
        const input = validateMainCommand(payload.command, payload.input);
        if (payload.command.startsWith('schema.databaseDrop.')) beginDatabaseDrop(payload.command, input, columns!);
        if (databaseEncodingCommand) databaseEncodingOwners.before(databaseEncodingCommand, input, columns!);
        const operation=dispatch(payload.command as Command,input,columns),local=payload.command==='search.savedQueries'||payload.command==='search.savedQueriesContinue'||payload.command==='queries.page'||payload.command==='queries.pageContinue'||payload.command==='history.page'||payload.command==='history.pageContinue';if(local)localSearchOperations.add(operation);
        // 片段文件操作及清理全部结算后才允许退出关闭存储，复用现有文件操作等待集合。
        const snippetTransferOperation=payload.command.startsWith('snippets.transfer');if(snippetTransferOperation)queryFileOperations.add(operation);
        try {
          const result = await operation;
          if (databaseEncodingCommand) { databaseEncodingResult = result; await databaseEncodingOwners.after(databaseEncodingCommand, input, result, columns!); }
          if(payload.command.startsWith('result.presets.')){columnsMain.assertCapturedOwner(columns);columns?.resultPresetPublication?.();}
          if(payload.command.startsWith('table.presets.')){
            // dispatch成功到IPC发布之间仍允许取消；新取消必须结算，最后检查之后不能再await。
            const publication=columns?.presetPublication;let stop=publication?.pendingStop();
            while(stop){await stop;publication!.settledStop(stop);stop=publication!.pendingStop();}
            columnsMain.assertCapturedOwner(columns);publication?.assertCurrent();
          }
          if (columns && (payload.command === 'schema.columns.get' || payload.command === 'schema.columns.preview')) {
            try { columnsMain.assertReply(columns); }
            catch (error) { await columnsMain.rejectReply(columns, error); }
          }
          if (payload.command.startsWith('queryFileSources.') || fileCancel || payload.command.startsWith('snippets.transfer')) columnsMain.assertCapturedOwner(columns);
          if (payload.command.startsWith('explainFiles.')) try { columnsMain.assertCapturedOwner(columns); } catch (error) {
            // 文件已提交后的最后发布门失效时，不能诱导用户自动重试覆盖文件。
            if (columns?.snapshotSaved) throw Error(explainSnapshotZh.unknownWrite);
            throw error;
          }
          if(insertRequest)columnsMain.assertCapturedOwner(columns);
          if (resultSql) try { columnsMain.assertCapturedOwner(columns); } catch (error) {
            // 仅撤销本次未发布的能力，迟到旧失败不能清掉同文档其他导出窗口的新预览。
            if (payload.command === 'files.previewResultSql' && result && typeof result === 'object' && 'previewId' in result && typeof result.previewId === 'string') resultSqlPreviews.release(result.previewId, columns!.owner.document);
            if (payload.command === 'files.choose' && input && typeof input === 'object' && 'resultSqlPreviewId' in input && typeof input.resultSqlPreviewId === 'string') resultSqlPreviews.release(input.resultSqlPreviewId, columns!.owner.document);
            throw error;
          }
          if (payload.command.startsWith('schema.databaseDrop.')) assertDatabaseDropPublication(result, columns!);
          if (databaseEncodingCommand) databaseEncodingOwners.assertPublication(databaseEncodingCommand, result, columns!);
          return { ok: true, result };
        } finally { columns?.presetPublication?.release();if(local)localSearchOperations.delete(operation);if(snippetTransferOperation)queryFileOperations.delete(operation); }
      } catch (error) {
        let failure = error;
        if (payload && typeof payload === 'object' && 'command' in payload && typeof payload.command === 'string' && payload.command.startsWith('schema.databaseDrop.') && columns) try { await rejectDatabaseDropPublication(columns, error); } catch (cleanup) { failure = cleanup; }
        if (databaseEncodingCommand && columns) try { await databaseEncodingOwners.rejectPublication(databaseEncodingCommand, databaseEncodingResult, columns, error); } catch (cleanup) { failure = cleanup; }
        if (columns && columnsMain.hasUnpublished(columns)) try { await columnsMain.rejectReply(columns, error); } catch (cleanup) { failure = cleanup; }
        return { ok: false, error: failure instanceof Error ? failure.message : '客户端操作失败' };
      }
    });
    createMenu(); await createWindow();
  }).catch(error => { dialog.showErrorBox('DBArk 启动失败', error instanceof Error ? error.message : String(error)); shutdownComplete = true; app.quit(); });
}
