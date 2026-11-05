import type * as monaco from 'monaco-editor';
import type { PostgresCompletionInput, PostgresCompletionResult } from '../shared/postgresCompletion';
import { postgresCompletionLimits } from '../shared/postgresCompletion';
import { postgresIdentifier } from '../shared/postgresSql';
import { analyzePostgresCompletion } from './postgresCompletionAnalysis';

export interface PostgresCompletionScope { tabId: string; connectionId: string; database: string; connectionVersion: number; }
type Kind = 'schema' | 'table' | 'view' | 'column' | 'keyword';
type Status = 'idle' | 'partial' | 'unavailable' | 'limited';
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
  status(value: Status): void;
}): monaco.languages.CompletionItemProvider & { invalidate(): void; dispose(): void } {
  let active: AbortController | undefined;
  let inFlight: Promise<PostgresCompletionResult> | undefined;
  let disposed = false;
  return {
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
        const { query, prefix, quoted } = analysis;
        const start = model.getPositionAt(analysis.start), end = model.getPositionAt(analysis.end);
        if (start.lineNumber !== end.lineNumber) return empty;
        const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
        let result: PostgresCompletionResult = { items: [], incomplete: false };
        if (query) {
          await debounce(controller.signal, 100);
          if (inFlight) await inFlight.catch(() => {});
          if (!current()) return empty;
          const base = { connectionId: options.scope.connectionId, database: options.scope.database, prefix };
          const input: PostgresCompletionInput = query.kind === 'relations' ? { ...base, ...query }
            : { ...base, kind: 'columns', relations: query.relations.map(ref => ({ name: ref.name, ...(ref.schema ? { schema: ref.schema } : {}) })) };
          const pending = options.request(input);
          inFlight = pending;
          try { result = await pending; }
          catch { if (current()) options.status('unavailable'); }
          finally { if (inFlight === pending) inFlight = undefined; }
          if (!current()) return empty;
        }
        const suggestions: monaco.languages.CompletionItem[] = [];
        for (const item of result.items) {
          const filterText = quoted ? '"' + item.name.replaceAll('"', '""') : item.name;
          const common = { range, kind: options.kinds[item.kind], filterText, sortText: '0' + String(suggestions.length).padStart(3, '0') };
          if (item.kind === 'schema' && query?.kind === 'relations' && !query.schema) {
            suggestions.push({ ...common, label: item.name, insertText: postgresIdentifier(item.name) + '.',
              command: { id: 'editor.action.triggerSuggest', title: '' } });
          } else if ((item.kind === 'table' || item.kind === 'view') && query?.kind === 'relations') {
            suggestions.push({ ...common, label: { label: item.name, description: item.schema },
              insertText: (query.schema ? '' : postgresIdentifier(item.schema) + '.') + postgresIdentifier(item.name) });
          } else if (item.kind === 'column' && query?.kind === 'columns') {
            const ref = query.relations[item.reference];
            if (!ref) continue;
            const qualified = !query.qualified && query.relations.length > 1;
            const qualifier = qualified ? (ref.alias ? postgresIdentifier(ref.alias) : ref.schema
              ? postgresIdentifier(ref.schema) + '.' + postgresIdentifier(ref.name) : postgresIdentifier(ref.name)) + '.' : '';
            suggestions.push({ ...common, label: { label: item.name, description: ref.alias ?? ref.name },
              insertText: qualifier + postgresIdentifier(item.name), detail: item.type });
          }
        }
        const hasDot = source.slice(0, analysis.start).trimEnd().endsWith('.');
        if (!quoted && !hasDot && query?.kind !== 'relations') {
          for (const label of keywords.filter(word => word.startsWith(prefix.toUpperCase()))) {
            suggestions.push({ label, kind: options.kinds.keyword, insertText: label, range, sortText: '9' + label });
          }
        }
        if (result.incomplete) options.status('partial');
        return { suggestions, incomplete: !!query };
      } finally {
        cancel.dispose();
        change.dispose();
        if (active === controller) active = undefined;
      }
    },
    /** 标签切换即撤销本次请求，返回原标签也不会复活旧建议。 */
    invalidate() { active?.abort(); },
    /** 卸载后只终止本地交付，原目录承诺仍由引擎按原连接收尾。 */
    dispose() { disposed = true; active?.abort(); },
  };
}
