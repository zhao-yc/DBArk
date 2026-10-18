import { describe, expect, it } from 'vitest';
import { captureQueryFileSnapshot } from '../../src/renderer/queryFileSnapshot';
import { editorContentBridge } from '../../src/renderer/editorContentBridge';
import type { WorkspaceTab } from '../../src/renderer/store';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';

/** 真实正文桥与RAM编辑器端口核对捕获时序，不代表Monaco原生或文件系统验收。 */
function fixture() {
  let tab: WorkspaceTab | undefined = { id: 't', kind: 'query', connectionId: 'c', title: '合成查询', sql: 'SELECT 初始;' };
  const model = new ContentModelPort(tab.sql), editor = new ContentEditorPort(model);
  let onPublish: undefined | (() => void);
  const bridge = editorContentBridge(editor as any, () => ({ value: tab?.sql ?? '', readOnly: false, onChange(sql) { if (tab) tab = { ...tab, sql }; onPublish?.(); } }), () => {});
  return { model, editor, capture: () => captureQueryFileSnapshot(editor as any, () => tab), read: () => tab,
    patch(patch: Partial<WorkspaceTab>) { if (tab) tab = { ...tab, ...patch }; },
    publishing(callback: () => void) { onPublish = callback; }, remove() { tab = undefined; },
    dispose() { bridge.dispose(); editor.dispose(); } };
}

describe('文件保存的编辑器全文快照', () => {
  it('先flush未交付正文并捕获全文，后续编辑保留为新草稿且不修改保存快照', () => {
    const f = fixture();
    try {
      f.model.deferred = true; f.editor.nativeInput('SELECT 最新, \'中文😀\';'); const version = f.model.version;
      expect(f.read()?.sql).toBe('SELECT 初始;');
      const saved = f.capture();
      expect(saved.sql).toBe('SELECT 最新, \'中文😀\';'); expect(f.read()?.sql).toBe(saved.sql); expect(Object.isFrozen(saved)).toBe(true);
      f.editor.nativeInput('SELECT 后续草稿;'); f.model.flush();
      expect(saved.sql).toBe('SELECT 最新, \'中文😀\';'); expect(f.read()?.sql).toBe('SELECT 后续草稿;');
      expect(f.model.version).toBe(version + 1); expect(f.model.controlledEdits).toBe(0); expect(f.editor.setValueCalls).toBe(0); expect(f.editor.undoStops).toBe(0);
    } finally { f.dispose(); }
  });
  it('空正文也必须从已就绪正文桥捕获', () => {
    const f = fixture(); try { f.model.deferred = true; f.editor.nativeInput(''); expect(f.capture().sql).toBe(''); } finally { f.dispose(); }
  });
  it.each(['未就绪', '外部草稿', '标签关闭', '只读'] as const)('%s不能回退到旧store正文', kind => {
    const f = fixture();
    try {
      if (kind === '未就绪') f.dispose(); if (kind === '外部草稿') f.patch({ sql: 'SELECT 外部新草稿;' }); if (kind === '标签关闭') f.remove(); if (kind === '只读') f.editor.readOnly = true;
      expect(f.capture).toThrow(); expect(f.model.controlledEdits).toBe(0); expect(f.editor.setValueCalls).toBe(0);
    } finally { f.dispose(); }
  });
  it.each(['title', 'connectionId', 'sourceBinding'] as const)('flush交付期间%s变化必须拒绝，保留新状态', key => {
    const f = fixture();
    try {
      const patch = key === 'sourceBinding' ? { sourceBinding: { id: '新来源', digest: 'a'.repeat(64), connectionId: 'c', context: { state: 'legacy' as const } } } : { [key]: '新状态' };
      f.publishing(() => f.patch(patch)); f.model.deferred = true; f.editor.nativeInput('SELECT 新正文;');
      expect(f.capture).toThrow(); expect(f.read()).toMatchObject(patch); expect(f.read()?.sql).toBe('SELECT 新正文;');
    } finally { f.dispose(); }
  });
});
