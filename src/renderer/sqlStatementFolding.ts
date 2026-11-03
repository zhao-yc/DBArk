import type { editor, languages } from 'monaco-editor';
import { statementNavigationLimits, type NavigableStatement } from '../shared/statementNavigation';
import type { StatementNavigationWorkerClient } from './statementNavigationWorkerClient';

/** 折叠整行时保留起始行。末行带有其他语句或注释时也必须保留。 */
export function statementFoldingRanges(model: Pick<editor.ITextModel, 'getPositionAt' | 'getLineContent'>, statements: readonly NavigableStatement[]): languages.FoldingRange[] {
  const ranges: languages.FoldingRange[] = [];
  for (const statement of statements) {
    const start = model.getPositionAt(statement.start).lineNumber;
    const offset = statement.delimiterStart < statement.delimiterEnd ? statement.delimiterEnd : statement.end;
    const last = model.getPositionAt(offset - 1);
    const suffix = model.getLineContent(last.lineNumber).slice(last.column);
    const end = last.lineNumber - (suffix.trim() ? 1 : 0);
    if (end > start) ranges.push({ start, end });
  }
  return ranges;
}

/** 只扫描当前编辑器模型。取消、正文更新或卸载后，旧线程不能提交折叠范围。 */
export function sqlStatementFoldingProvider(instance: Pick<editor.IStandaloneCodeEditor, 'getModel'>, dialect: 'mysql' | 'mariadb' | 'sqlite', client: Pick<StatementNavigationWorkerClient, 'analyze'>, active: () => boolean): languages.FoldingRangeProvider {
  let cached: { model: editor.ITextModel; version: number; ranges?: languages.FoldingRange[] } | undefined;
  return {
    async provideFoldingRanges(model, _context, token) {
      const current = () => active() && !token.isCancellationRequested && !model.isDisposed() && instance.getModel() === model;
      if (!current() || model.getLineCount() < 2 || model.getValueLength() > statementNavigationLimits.sourceUnits) return;
      const version = model.getVersionId();
      if (cached?.model === model && cached.version === version) return cached.ranges;
      const abort = new AbortController();
      const subscription = token.onCancellationRequested(() => abort.abort());
      try {
        // 折叠不读取会话。MySQL 和 MariaDB 的未知模式必须得到一致分段。
        const result = await client.analyze(model.getValue(), dialect, {}, abort.signal);
        if (!current() || model.getVersionId() !== version) return;
        if (result.status === 'blocked') {
          if (['script', 'budget', 'input'].includes(result.reason)) cached = { model, version };
          return;
        }
        const ranges = statementFoldingRanges(model, result.statements);
        cached = { model, version, ranges: ranges.length ? ranges : undefined };
        return cached.ranges;
      } finally { subscription.dispose(); }
    },
  };
}
