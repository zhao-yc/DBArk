import type { editor, languages } from 'monaco-editor';
import type { CompletionSessionState } from '../shared/sqlCompletion';
import { completionLimits } from '../shared/sqlCompletion';
import { resolveCompletionContext, sameCompletionState, sameCompletionScope, type SqlCompletionScope } from './completionContext';
import { analyzeSqlSignature } from './sqlSignatureAnalysis';
import { sqlSignaturesZh as text } from './locales/sqlSignatures.zh-CN';

interface Ports { model(): editor.ITextModel | null; current(): boolean; dialect: 'mysql' | 'mariadb' | 'sqlite'; scope?: SqlCompletionScope; state(sessionId: string): Promise<CompletionSessionState>; }
/** 参数提示仅使用本地资料；已存在MySQL会话时前后只读模式缓存，不建连、不读目录、不执行SQL。 */
export function createSqlSignatureProvider(ports: Ports) {
  let generation = 0, disposed = false, checking = false;
  const dialect = ports.dialect, scope = ports.scope ? { ...ports.scope } : undefined; let scopeAlive = true;
  /** 外部守卫可能同步重入；回调后再核原代次，不能让旧请求覆盖继任。 */
  function available(model: editor.ITextModel, id = generation): boolean {
    if (checking || disposed || !scopeAlive) return false;
    if (ports.dialect !== dialect || (scope ? !sameCompletionScope(ports.scope, scope) : !!ports.scope)) { scopeAlive = false; return false; }
    checking = true; let okay = false;
    try { okay = ports.current() === true && ports.model() === model; } catch {} finally { checking = false; }
    if (ports.dialect !== dialect || (scope ? !sameCompletionScope(ports.scope, scope) : !!ports.scope)) scopeAlive = false;
    return okay && scopeAlive && !disposed && id === generation && !model.isDisposed();
  }
  const provider: languages.SignatureHelpProvider = {
    signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [',', ')'],
    async provideSignatureHelp(model, position, token) {
      const id = ++generation;
      if (!available(model, id) || token.isCancellationRequested || model.getValueLength() > completionLimits.sourceUnits) return null;
      const version = model.getVersionId(), source = model.getValue(), offset = model.getOffsetAt(position); let alive = true;
      const stop = () => { alive = false; }, cancellation = token.onCancellationRequested(stop), changed = model.onDidChangeContent(stop);
      const current = () => alive && !token.isCancellationRequested && model.getVersionId() === version && available(model, id) && alive && !token.isCancellationRequested && model.getVersionId() === version;
      try {
        const sessionId = dialect !== 'sqlite' ? scope?.sessionId : undefined;
        const raw = sessionId ? await ports.state(sessionId) : undefined, state = raw ? { ...raw } : undefined; if (!current() || state?.dialect === 'sqlite') return null;
        const context = resolveCompletionContext(scope?.database, state, scope?.databaseUnknown); if (!context.available) return null;
        const result = analyzeSqlSignature(source, offset, dialect, context.mode); if (!current() || !result) return null;
        if (sessionId) { const latest = await ports.state(sessionId); if (!current() || !sameCompletionState(state!, latest)) return null; }
        const signatures = result.signatures.map(value => {
          let label = result.name + '(' + (value.distinct ? 'DISTINCT ' : '');
          const parameters = value.parameters.map((parameter, index) => { if (index) label += ', '; const start = label.length; label += parameter; const end = label.length; if (value.variadic && index === value.parameters.length - 1) label += ', ...'; return { label: [start, end] as [number, number], documentation: value.variadic && index === value.parameters.length - 1 ? text.repeated : parameter }; });
          label += ')'; return { label, parameters, documentation: value.description + '\n' + text.notice };
        });
        if (!current()) return null;
        return { value: { signatures, activeSignature: result.activeSignature, activeParameter: result.activeParameter }, dispose() { stop(); } };
      } catch { return null; }
      finally { cancellation.dispose(); changed.dispose(); }
    },
  };
  return { provider, dispose(): void { disposed = true; generation++; } };
}
