import { analyzeStatementNavigation } from '../shared/statementNavigation';

/** 独立纯扫描线程没有文件、IPC或数据库端口；只接收固定原文快照和方言模式。 */
self.onmessage = (event: MessageEvent) => {
  const input = event.data;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Reflect.ownKeys(input).some(key => typeof key !== 'string') || Object.keys(input).sort().join(',') !== 'dialect,id,mode,source' || !Number.isSafeInteger(input.id) || input.id < 1 || typeof input.source !== 'string' || !['mysql', 'mariadb', 'sqlite'].includes(input.dialect)) { self.postMessage({ id: input?.id, result: { status: 'blocked', reason: 'input' } }); return; }
  self.postMessage({ id: input.id, result: analyzeStatementNavigation(input.source, input.dialect, input.mode) });
};
self.postMessage({ type: 'dbark-statement-navigation-ready', version: 1 });
