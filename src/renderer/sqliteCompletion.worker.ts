import { analyzeSqliteCompletion, type SqliteAnalysisIntent } from '../shared/sqliteCompletionAnalysis';

/** SQLite补全只计算纯文本，不访问元数据、IPC、文件或网络；正文在真实ready握手后才到线程。 */
self.onmessage = (event: MessageEvent<{ id: number; source: string; offset: number; intent?: SqliteAnalysisIntent }>) => {
  const request = event.data;
  if (!request || !['id,offset,source', 'id,intent,offset,source'].includes(Object.keys(request).sort().join(',')) || request.intent !== undefined && request.intent !== 'hover' && request.intent !== 'definition' || !Number.isSafeInteger(request.id) || request.id < 1 || typeof request.source !== 'string' || !Number.isSafeInteger(request.offset)) {
    self.postMessage({ id: request?.id, result: { status: 'blocked', reason: 'input' } }); return;
  }
  self.postMessage({ id: request.id, result: analyzeSqliteCompletion(request.source, request.offset, request.intent) });
};
self.postMessage({ type: 'dbark-sqlite-completion-ready', version: 1 });
