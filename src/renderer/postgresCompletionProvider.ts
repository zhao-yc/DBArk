import type * as monaco from 'monaco-editor';
import type { PostgresCompletionInput, PostgresCompletionReference, PostgresCompletionResult } from '../shared/postgresCompletion';
import { postgresCompletionLimits } from '../shared/postgresCompletion';
import { postgresIdentifier } from '../shared/postgresSql';
import { analyzePostgresCompletion, analyzePostgresSignature } from './postgresCompletionAnalysis';
import { postgresSignatureHelp } from './postgresSignatureHelp';

export interface PostgresCompletionScope { tabId: string; connectionId: string; database: string; connectionVersion: number; sessionId?: string; }
type Kind = 'schema' | 'table' | 'view' | 'column' | 'routine' | 'keyword';
type Status = 'idle' | 'partial' | 'unavailable' | 'limited' | 'sessionUnknown';
const keywords = ['SELECT','FROM','JOIN','LEFT JOIN','RIGHT JOIN','INNER JOIN','WHERE','GROUP BY','ORDER BY',
  'HAVING','LIMIT','OFFSET','INSERT INTO','VALUES','UPDATE','SET','DELETE FROM','RETURNING','ON CONFLICT',
  'DISTINCT','WITH','UNION ALL','IS NULL','IS NOT NULL','CASE','WHEN','THEN','ELSE','END','BEGIN','COMMIT','ROLLBACK'];

/** 等待短防抖，编辑取消立即唤醒，目录在途请求只由原承诺收尾。 */
function debounce(signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** 单编辑器请求串行，旧正文、光标、标签、连接及取消都不能交付迟到建议。 */
export function createPostgresCompletionProvider(options: {
  scope: PostgresCompletionScope;
  model(): monaco.editor.ITextModel | null;
  position(): monaco.Position | null;
  current(): boolean;
  request(input: PostgresCompletionInput): Promise<PostgresCompletionResult>;
  kinds: Record<Kind, monaco.languages.CompletionItemKind>;
  snippetRule: monaco.languages.CompletionItemInsertTextRule;
  status(value: Status): void;
}): monaco.languages.CompletionItemProvider & { signatureHelp: monaco.languages.SignatureHelpProvider; invalidate(): void; dispose(): void } {
  let active: AbortController | undefined;
  let inFlight: Promise<PostgresCompletionResult> | undefined;
  let signatureGeneration = 0;
  let disposed = false;
  const { connectionId, database, sessionId } = options.scope;
  const target = { connectionId, database, ...(sessionId ? { sessionId } : {}) };

  /** 两类提示共用原会话请求通道，过期请求在排队后也不能发出。 */
  async function request(input: PostgresCompletionInput, current: () => boolean) {
    while (inFlight && current()) await inFlight.catch(() => {});
    if (!current()) return;
    const pending = options.request(input);
    inFlight = pending;
    try { return await pending; }
    finally { if (inFlight === pending) inFlight = undefined; }
  }

  const signatureHelp: monaco.languages.SignatureHelpProvider = {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [',', ')', '>', '='],
    async provideSignatureHelp(model, position, token) {
      // 其他 SQL 模型也会调用全局注册的 provider，不能使原模型的在途提示失效。
      if (disposed || options.model() !== model || !options.current() || model.isDisposed() || token.isCancellationRequested ||
          model.getValueLength() > postgresCompletionLimits.source) return null;
      const generation = ++signatureGeneration, version = model.getVersionId();
      const current = () => {
        const cursor = options.position();
        return !disposed && signatureGeneration === generation && !token.isCancellationRequested &&
          options.current() && options.model() === model && !model.isDisposed() && model.getVersionId() === version &&
          cursor?.lineNumber === position.lineNumber && cursor.column === position.column;
      };
      const call = analyzePostgresSignature(model.getValue(), model.getOffsetAt(position));
      if (!call) return null;
      try {
        const result = await request({ ...target, kind: 'signatures', prefix: call.name, routine: call.routine }, current);
        if (!result || result.deferred || !current()) return null;
        const value = postgresSignatureHelp(result.items, call);
        return value ? { value, dispose() {} } : null;
      } catch { return null; }
    },
  };
  return {
    signatureHelp,
    triggerCharacters: ['.', '"'],
    /** 先校验本地词法，只向服务端发送目标和前缀。 */
    async provideCompletionItems(model, position, _context, token) {
      const empty = { suggestions: [] };
      if (disposed || !options.current() || options.model() !== model || model.isDisposed() || token.isCancellationRequested) return empty;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const version = model.getVersionId();
      const current = () => {
        const cursor = options.position();
        return !disposed && !controller.signal.aborted && active === controller && options.current() &&
          options.model() === model && !model.isDisposed() && model.getVersionId() === version &&
          cursor?.lineNumber === position.lineNumber && cursor.column === position.column;
      };
      const cancel = token.onCancellationRequested(() => controller.abort());
      const change = model.onDidChangeContent(() => controller.abort());
      try {
        options.status('idle');
        if (model.getValueLength() > postgresCompletionLimits.source) { options.status('limited'); return empty; }
        const source = model.getValue();
        const analysis = analyzePostgresCompletion(source, model.getOffsetAt(position));
        if (!analysis) return empty;
        const { query, prefix, quoted, routine } = analysis;
        const start = model.getPositionAt(analysis.start), end = model.getPositionAt(analysis.end);
        if (start.lineNumber !== end.lineNumber) return empty;
        const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
        const references: PostgresCompletionReference[] = [];
        const origins: number[] = [];
        const localColumns: { reference: number; name: string; type?: string }[] = [];
        const matches = (name: string) => name.toLowerCase().startsWith(prefix.toLowerCase());
        if (query?.kind === 'columns') {
          for (const [index, ref] of query.relations.entries()) {
            const { name, schema, projection } = ref;
            const directory = projection?.stars ?? [{ name, ...(schema ? { schema } : {}) }];
            for (const source of directory) {
              references.push(source);
              origins.push(index);
            }
            for (const name of projection?.names ?? []) {
              if (name && matches(name)) localColumns.push({ reference: index, name });
            }
          }
        }
        const base = { ...target, prefix, ...(routine ? { routine } : {}) };
        // CTE 名称、别名和投影只在编辑器中使用，目录只接收实际物理目标。
        const input: PostgresCompletionInput | undefined = query?.kind === 'relations'
          ? { ...base, kind: 'relations', ...(query.schema ? { schema: query.schema } : {}) }
          : references.length > 0 && references.length <= postgresCompletionLimits.relations
            ? { ...base, kind: 'columns', relations: references } : routine ? { ...base, kind: 'routines', routine } : undefined;
        let result: PostgresCompletionResult = { items: [], incomplete: false };
        if (input) {
          await debounce(controller.signal, 100);
          try { result = await request(input, current) ?? result; }
          catch { if (current()) options.status('unavailable'); }
          if (!current()) return empty;
        }
        const suggestions: monaco.languages.CompletionItem[] = [];
        // 本地对象排在目录前；显式 schema 仍可选择同名物理关系。
        for (const name of query?.kind === 'relations' ? query.ctes ?? [] : []) {
          if (!matches(name)) continue;
          suggestions.push({ range, kind: options.kinds.table, label: { label: name, description: 'CTE' },
            insertText: postgresIdentifier(name), filterText: quoted ? postgresIdentifier(name) : name,
            sortText: '0' + String(suggestions.length).padStart(3, '0') });
        }
        for (const item of result.items) {
          const filterText = quoted ? '"' + item.name.replaceAll('"', '""') : item.name;
          const common = { range, kind: options.kinds[item.kind], filterText, sortText: '0' + String(suggestions.length).padStart(3, '0') };
          if (item.kind === 'schema' && query?.kind === 'relations' && !query.schema) {
            suggestions.push({ ...common, label: item.name, insertText: postgresIdentifier(item.name) + '.',
              command: { id: 'editor.action.triggerSuggest', title: '' } });
          } else if ((item.kind === 'table' || item.kind === 'view') && query?.kind === 'relations') {
            suggestions.push({ ...common, label: { label: item.name, description: item.schema },
              insertText: (query.schema ? '' : postgresIdentifier(item.schema) + '.') + postgresIdentifier(item.name) });
          } else if (item.kind === 'column' && origins[item.reference] !== undefined) {
            localColumns.push({ reference: origins[item.reference], name: item.name, type: item.type });
          } else if (item.kind === 'routine' && routine) {
            const name = postgresIdentifier(item.name);
            const insert = analysis.existingCall ? { insertText: name } : {
              insertText: name.replace(/[\\$}]/g, value => '\\' + value) + '($0)', insertTextRules: options.snippetRule,
              command: { id: 'editor.action.triggerParameterHints', title: '' },
            };
            suggestions.push({ ...common, ...insert, sortText: '1' + common.sortText,
              label: { label: item.name, detail: '(' + item.arguments + ')', description: item.schema + (item.returns ? ' → ' + item.returns : '') } });
          }
        }
        if (query?.kind === 'columns') {
          const counts = new Map<string, number>();
          for (const { reference, name } of localColumns) {
            const key = reference + ':' + name;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
          for (const { reference, name, type } of localColumns) {
            if (counts.get(reference + ':' + name) !== 1) continue;
            const ref = query.relations[reference];
            const qualified = !query.qualified && query.relations.length > 1;
            const qualifier = qualified ? (ref.alias ? postgresIdentifier(ref.alias) : ref.schema
              ? postgresIdentifier(ref.schema) + '.' + postgresIdentifier(ref.name) : postgresIdentifier(ref.name)) + '.' : '';
            suggestions.push({ range, kind: options.kinds.column, label: { label: name, description: ref.alias ?? ref.name },
              insertText: qualifier + postgresIdentifier(name), detail: type,
              filterText: quoted ? postgresIdentifier(name) : name, sortText: '0' + String(suggestions.length).padStart(3, '0') });
          }
        }
        const hasDot = source.slice(0, analysis.start).trimEnd().endsWith('.');
        if (!quoted && !hasDot && query?.kind !== 'relations' && routine?.context !== 'call' && routine?.context !== 'from') {
          for (const label of keywords.filter(word => word.startsWith(prefix.toUpperCase()))) {
            suggestions.push({ label, kind: options.kinds.keyword, insertText: label, range, sortText: '9' + label });
          }
        }
        if (result.deferred === 'transaction') options.status('sessionUnknown');
        else if (result.deferred === 'busy') options.status('unavailable');
        else if (result.incomplete || suggestions.length > postgresCompletionLimits.items) options.status('partial');
        return { suggestions: suggestions.slice(0, postgresCompletionLimits.items), incomplete: !!query || !!routine };
      } finally {
        cancel.dispose();
        change.dispose();
        if (active === controller) active = undefined;
      }
    },
    /** 标签切换即撤销本次请求，返回原标签也不会复活旧建议。 */
    invalidate() { active?.abort(); signatureGeneration++; },
    /** 卸载后只终止本地交付，原目录承诺仍由引擎按原连接收尾。 */
    dispose() { disposed = true; active?.abort(); signatureGeneration++; },
  };
}
