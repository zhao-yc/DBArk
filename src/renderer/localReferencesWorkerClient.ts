import type { CompletionLexicalMode } from '../shared/completionLexical';
import type { CompletionScopeCapabilities } from '../shared/completionCapabilities';
import { validLocalReferences, type LocalReferences } from '../shared/localReferences';
import { completionLimits } from '../shared/sqlCompletion';
import { validSqliteLocalReferences } from '../shared/sqliteLocalReferences';
import { sqliteCompletionLimits } from '../shared/sqliteCompletion';
import { completionLexicalContext } from '../shared/completionLexical';
import { sqliteReferenceContext } from '../shared/sqliteCompletionAnalysis';
import { quoteLocalRename, validLocalRename, type LocalRename, type LocalRenameContext } from '../shared/localRename';
import { validPhysicalObjectAnalysis, type PhysicalObjectAnalysis } from '../shared/physicalObjectAnalysis';

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;

/** 一次引用请求独占线程；启动8秒与分析2秒分开，正文只在握手后发送，终态准确释放所属线程。 */
export class LocalReferencesWorkerClient {
  private active?: { stop(reason: string): void }; private disposed = false;
  constructor(private readonly create: () => WorkerPort, private readonly dialect: 'mysql' | 'sqlite' = 'mysql') {}
  /** 输入绑定不可变快照；旧线程回包不能结束或污染继任请求。 */
  analyze(source: string, offset: number, mode: CompletionLexicalMode, signal: AbortSignal, capabilities: CompletionScopeCapabilities): Promise<LocalReferences> {
    return this.request<LocalReferences>(source, offset, mode, signal, capabilities, this.dialect === 'sqlite' ? {} : { intent: 'references' }, (value, snapshot): value is LocalReferences => this.dialect === 'sqlite' ? validSqliteLocalReferences(value, source, offset) : validLocalReferences(value, source, offset, snapshot));
  }
  /** 重命名复用线程资源合同，回包只准原语句内本次名称的完整替换。 */
  rename(source: string, offset: number, mode: CompletionLexicalMode, signal: AbortSignal, capabilities: CompletionScopeCapabilities, newName?: string): Promise<LocalRename> {
    if (newName !== undefined && !quoteLocalRename(newName, this.dialect)) return Promise.resolve({ status: 'blocked', reason: 'name' });
    return this.request<LocalRename>(source, offset, mode, signal, capabilities, { intent: 'rename', ...(newName === undefined ? {} : { newName }) }, (value, snapshot): value is LocalRename => {
      let context: LocalRenameContext;
      if (this.dialect === 'sqlite') context = sqliteReferenceContext(source, offset);
      else {
        const lexical = completionLexicalContext(source, offset, snapshot, completionLimits.aliasUnits);
        const target = lexical.status === 'ready' ? lexical.tokens.find(token => token.start === lexical.target.start && token.end === lexical.target.end) : undefined;
        context = lexical.status !== 'ready' ? lexical : target ? { status: 'ready', target, tokens: lexical.tokens.filter(token => ['word', 'identifier'].includes(token.kind)) } : { status: 'blocked', reason: 'syntax' };
      }
      return validLocalRename(value, context, this.dialect, newName);
    });
  }
  /** 物理对象分析复用独占可终止线程，只交付原语句的名称及范围，不交付可执行内容。 */
  object(source: string, offset: number, mode: CompletionLexicalMode, signal: AbortSignal, capabilities: CompletionScopeCapabilities): Promise<PhysicalObjectAnalysis> {
    return this.request<PhysicalObjectAnalysis>(source, offset, mode, signal, capabilities, { intent: 'object' }, (value, snapshot): value is PhysicalObjectAnalysis => validPhysicalObjectAnalysis(value, source, offset, this.dialect, snapshot));
  }
  /** 分析类型不改变8秒握手／2秒正文期限，替换或取消都终止准确owner。 */
  private request<T extends LocalReferences | LocalRename | PhysicalObjectAnalysis>(source: string, offset: number, mode: CompletionLexicalMode, signal: AbortSignal, capabilities: CompletionScopeCapabilities, intent: { intent?: 'references' | 'rename' | 'object'; newName?: string }, valid: (value: unknown, snapshot: CompletionLexicalMode) => value is T): Promise<T | { status: 'blocked'; reason: string }> {
    if (this.disposed || signal.aborted) return Promise.resolve({ status: 'blocked', reason: 'cancelled' });
    if (source.length > (this.dialect === 'sqlite' ? sqliteCompletionLimits : completionLimits).sourceUnits) return Promise.resolve({ status: 'blocked', reason: 'budget' });
    this.active?.stop('replaced');
    return new Promise(resolve => {
      const snapshot = { ansiQuotes: mode.ansiQuotes, noBackslashEscapes: mode.noBackslashEscapes };
      const facts = { lateralDerivedTables: capabilities.lateralDerivedTables === true, windowFunctions: capabilities.windowFunctions === true, insertRowAliases: capabilities.insertRowAliases === true };
      let worker: WorkerPort | undefined, timer: ReturnType<typeof setTimeout> | undefined, sent = false, finished = false;
      /** 先撤监听、引用及当前owner，再终止准确线程；重复回调无副作用。 */
      const finish = (result: T | { status: 'blocked'; reason: string }) => {
        if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (this.active === owner) this.active = undefined;
        if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); worker = undefined; }
        resolve(result);
      };
      const owner = { stop: (reason: string) => finish({ status: 'blocked', reason }) }, abort = () => owner.stop('cancelled');
      this.active = owner; signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => owner.stop('startup-timeout'), 8000);
      try {
        worker = this.create();
        // 构造器期间也可能同步取消；新取得的准确线程仍须释放，不能留下无人持有的owner。
        if (finished) { worker.terminate(); worker = undefined; return; }
        worker.onmessage = event => {
          if (finished) return;
          const message = event.data;
          const prefix = this.dialect === 'sqlite' ? 'dbark-sqlite-local-references' : 'dbark-completion';
          if (intent.intent === 'object' && (message?.type === prefix + '-ready' || message?.type === prefix + '-unavailable') && (typeof message !== 'object' || Array.isArray(message) || Object.keys(message).sort().join(',') !== 'type,version')) { owner.stop('worker'); return; }
          if (message?.type === prefix + '-unavailable') { owner.stop('worker'); return; }
          if (message?.type === prefix + '-ready') {
            if (message.version !== 1) { owner.stop('worker'); return; }
            if (sent) return;
            sent = true; clearTimeout(timer); timer = setTimeout(() => owner.stop('timeout'), 2000);
            try { worker!.postMessage(this.dialect === 'sqlite' ? { id: 1, source, offset, ...intent } : { id: 1, source, offset, mode: snapshot, capabilities: facts, ...intent }); } catch { owner.stop('worker'); }
            return;
          }
          if (!sent || message?.id !== 1 || intent.intent === 'object' && (!message || typeof message !== 'object' || Array.isArray(message) || Object.keys(message).sort().join(',') !== 'id,result') || !valid(message.result, snapshot)) { owner.stop('worker'); return; }
          finish(message.result);
        };
        worker.onerror = event => { event.preventDefault(); owner.stop('worker'); };
        worker.onmessageerror = () => owner.stop('worker');
      } catch { owner.stop('worker'); }
    });
  }
  /** 卸载后所有待发正文、计时器和线程立即释放，不允许重新分配。 */
  dispose(): void { this.disposed = true; this.active?.stop('disposed'); }
}
