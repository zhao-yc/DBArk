import { analyzeLocalReferences } from '../shared/localReferencesAnalysis';
import { warmupCompletionAnalysis } from '../shared/completionWarmup';
import { completionLimits } from '../shared/sqlCompletion';
import type { CompletionLexicalMode } from '../shared/completionLexical';
import type { CompletionScopeCapabilities } from '../shared/completionCapabilities';

/** 独占、可终止的纯文本线程，不提供数据库、IPC、文件或网络入口。 */
self.onmessage = (event: MessageEvent<{ id: number; source: string; offset: number; mode: CompletionLexicalMode; capabilities: CompletionScopeCapabilities }>) => {
  const input = event.data;
  if (!input || Object.keys(input).sort().join(',') !== 'capabilities,id,mode,offset,source' || !Number.isSafeInteger(input.id) || input.id < 1 || typeof input.source !== 'string' || input.source.length > completionLimits.sourceUnits || !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > input.source.length
    || !input.mode || typeof input.mode !== 'object' || Array.isArray(input.mode) || Object.keys(input.mode).some(key => !['ansiQuotes', 'noBackslashEscapes'].includes(key)) || [input.mode.ansiQuotes, input.mode.noBackslashEscapes].some(value => value !== undefined && typeof value !== 'boolean')
    || !input.capabilities || typeof input.capabilities !== 'object' || Array.isArray(input.capabilities) || Object.keys(input.capabilities).some(key => !['lateralDerivedTables', 'windowFunctions', 'insertRowAliases'].includes(key)) || Object.values(input.capabilities).some(value => typeof value !== 'boolean')) {
    self.postMessage({ id: input?.id, result: { status: 'blocked', reason: 'input' } }); return;
  }
  self.postMessage({ id: input.id, result: analyzeLocalReferences(input.source, input.offset, input.mode, input.capabilities) });
};
try { warmupCompletionAnalysis(); self.postMessage({ type: 'dbark-local-references-ready', version: 1 }); }
catch { self.postMessage({ type: 'dbark-local-references-unavailable', version: 1 }); }
