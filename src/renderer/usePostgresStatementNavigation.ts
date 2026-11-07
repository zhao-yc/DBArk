import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as monaco from 'monaco-editor';
import { adjacentNavigableStatement, currentNavigableStatement, statementNavigationStart, type NavigableStatement } from '../shared/statementNavigation';
import { StatementNavigationController, type StatementNavigationView } from './statementNavigationController';
import { StatementNavigationWorkerClient } from './statementNavigationWorkerClient';
import StatementNavigationWorker from './statementNavigation.worker?worker';
import type { StatementNavigationPanelProps } from './components/StatementNavigationPanel';
import { statementNavigationZh as text } from './locales/statementNavigation.zh-CN';
import { invoke } from './lib';
import { useWorkspace } from './store';

interface Target {
  instance: monaco.editor.IStandaloneCodeEditor;
  model: monaco.editor.ITextModel;
  sessionId?: string;
  current(): boolean;
}
interface Owner extends Target {
  source: string;
  controller?: StatementNavigationController;
  ranges?: NavigableStatement[];
}
type Action = 'panel' | 'select' | 'previous' | 'next';
interface Navigation {
  open(action?: Action): void;
  panel?: StatementNavigationPanelProps;
  busy: boolean;
}

/** 目录和单次导航都绑定原编辑器与会话。清理先撤权，迟到线程无法移动继任草稿的光标。 */
export function usePostgresStatementNavigation(capture: () => Target | undefined): Navigation {
  const owner = useRef<Owner | undefined>(undefined);
  const [view, setView] = useState<StatementNavigationView>();
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  useEffect(() => () => { owner.current?.controller?.dispose(); owner.current = undefined; }, []);
  useLayoutEffect(() => { owner.current?.controller?.observe(); });

  function close() {
    const original = owner.current;
    owner.current = undefined;
    original?.controller?.dispose();
    setView(undefined);
    setBusy(false);
  }
  function apply(original: Owner, range: NavigableStatement, select: boolean) {
    const { model, instance } = original;
    const start = model.getPositionAt(statementNavigationStart(original.source, range, 'postgresql'));
    if (select) {
      const end = model.getPositionAt(range.end);
      const selection = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
      instance.setSelection(selection);
      instance.revealRangeInCenter(selection);
    } else {
      instance.setPosition(start);
      instance.revealPositionInCenter(start);
    }
    instance.focus();
  }
  function open(action: Action = 'panel') {
    const target = capture();
    if (!target || owner.current?.controller?.busy) return;
    const { instance, model } = target;
    const single = action === 'panel' ? undefined : instance.getSelections();
    if (action !== 'panel' && single?.length !== 1) return;
    const selection = single?.[0];
    const point = instance.getPosition();
    const offset = point ? model.getOffsetAt(point) : 0;
    const direction = action === 'previous' ? -1 : action === 'next' ? 1 : undefined;
    function useRanges(original: Owner, ranges: NavigableStatement[]) {
      const range = direction
        ? adjacentNavigableStatement(original.source, ranges, offset, direction, 'postgresql')
        : ranges[currentNavigableStatement(original.source, ranges, offset, 'postgresql')];
      if (range) apply(original, range, action === 'select');
      else useWorkspace.getState().notify(direction === -1 ? text.noPrevious : direction === 1 ? text.noNext : text.noCurrent);
    }
    const previous = owner.current;
    if (selection && previous?.ranges && previous.model === model && previous.controller?.current()) {
      useRanges(previous, previous.ranges);
      return;
    }
    close();
    const original: Owner = { ...target, source: model.getValue() };
    const version = model.getVersionId();
    const current = () => {
      if (owner.current !== original || !target.current() || model.isDisposed() || instance.getModel() !== model || model.getVersionId() !== version) return false;
      const latest = selection ? instance.getSelections() : undefined;
      return !selection || latest?.length === 1 && selection.equalsSelection(latest[0]);
    };
    original.controller = new StatementNavigationController({
      source: original.source, dialect: 'postgresql', sessionId: target.sessionId, current,
      state: async sessionId => {
        const cached = await invoke('query.sessionState', { sessionId });
        return { dialect: 'postgresql', busy: !cached.transactionKnown, broken: cached.broken,
          noBackslashEscapes: cached.standardConformingStrings };
      },
      create: () => new StatementNavigationWorkerClient(() => new StatementNavigationWorker()),
      subscribe: changed => {
        const release = useWorkspace.subscribe(changed);
        const subscriptions = [model.onDidChangeContent(changed), model.onWillDispose(changed), instance.onDidChangeModel(changed), instance.onDidDispose(changed)];
        subscriptions.push(selection ? instance.onDidChangeCursorSelection(changed) : instance.onDidChangeCursorPosition(event => {
          if (current()) setCursor(model.getOffsetAt(event.position));
        }));
        return () => { release(); subscriptions.forEach(item => item.dispose()); };
      },
      decorate: result => { original.ranges = result.statements; },
      clear: () => { original.ranges = undefined; },
      changed: next => {
        if (owner.current !== original) return;
        setBusy(next.busy);
        if (action === 'panel') { setView(next); return; }
        const result = next.result;
        if (!result) return;
        const ready = result.status === 'ready' && current();
        close();
        if (ready) useRanges(original, result.statements);
        else if (result.status === 'blocked' && result.reason !== 'stale')
          useWorkspace.getState().notify(text.reasons[result.reason] ?? text.unavailable, true);
      },
    });
    owner.current = original;
    setCursor(offset);
    void original.controller.start();
  }

  const original = owner.current;
  const panel: StatementNavigationPanelProps | undefined = view && original ? {
    source: original.source, dialect: 'postgresql', view, cursor,
    position: offset => original.model.isDisposed() ? { lineNumber: 1, column: 1 } : original.model.getPositionAt(offset),
    onNavigate(index, select) {
      const range = original.ranges?.[index];
      if (range && original.controller?.current()) apply(original, range, select);
    },
    onRefresh: () => open(),
    onCancel: () => original.controller?.stop(),
    onClose: () => { if (owner.current === original) close(); },
  } : undefined;
  return { open, panel, busy };
}
