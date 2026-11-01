import { runSqliteTableFindInWorker, sqliteFindMessages, type SqliteFindWorkerRequest } from './sqliteTableFind';

/** 只接收纯本地页请求；不访问IPC、数据库、文件或网络。超时由拥有线程的Client真实terminate。 */
self.onmessage = (event: MessageEvent<{ id: number; request: SqliteFindWorkerRequest }>) => {
  const value = event.data;
  if (!value || !Number.isSafeInteger(value.id) || value.id < 1) { self.postMessage({ id: value?.id, result: { status: 'blocked', reason: 'invalid', message: sqliteFindMessages.invalid } }); return; }
  self.postMessage({ id: value.id, result: runSqliteTableFindInWorker(value.request) });
};
self.postMessage({ type: 'dbark-sqlite-table-find-ready', version: 1 });
