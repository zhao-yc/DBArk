import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { captureQueryFileSnapshot } from '../../src/renderer/queryFileSnapshot';
import { editorContentBridge, flushEditorContent } from '../../src/renderer/editorContentBridge';
import { queryFileSourceHasChanges, type QueryFileSourceView } from '../../src/shared/queryFileSources';
import type { WorkspaceTab } from '../../src/renderer/store';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';

const policy = 'preserve-equivalent-draft-eol' as const;
/** 真实正文桥/文件快照配合旧RAM端口；不运行Monaco、磁盘、IPC或数据库。 */
function fixture(stored = 'SELECT 原文;\n', eol = '\r\n') {
  let tab: WorkspaceTab = { id: '原标签', kind: 'query', connectionId: '原连接', title: '原文件', sql: stored, fileSourceBinding: { id: '11111111-1111-4111-8111-111111111111', revision: 1 } }, readonly = false;
  const model = new ContentModelPort(stored, eol), editor = new ContentEditorPort(model), published = vi.fn(); let duringPublish: undefined | (() => void);
  const props = () => ({ value: tab.sql ?? '', readOnly: readonly, onChange(sql: string) { published(sql); tab = { ...tab, sql }; duringPublish?.(); } });
  const bridge = editorContentBridge(editor as any, props, () => {});
  return { tab: () => tab, model, editor, bridge, published, props,
    capture: () => captureQueryFileSnapshot(editor as any, () => tab), external(sql: string) { tab = { ...tab, sql }; },
    readonly() { readonly = true; }, patch(value: Partial<WorkspaceTab>) { tab = { ...tab, ...value }; }, publishing(callback: () => void) { duringPublish = callback; },
    dispose() { bridge.dispose(); editor.dispose(); } };
}
describe('来源操作保留已同步且未编辑草稿的原EOL（RAM）', () => {
  it.each([{ stored: 'SELECT 原文;\n', eol: '\r\n' }, { stored: 'SELECT 原文;\r\n', eol: '\n' }])('原文$stored与模型$eol仅规范化等价：连续捕获不回声，源摘要仍clean', async ({ stored, eol }) => {
    const f = fixture(stored, eol), before = f.tab(), version = f.model.version, source: QueryFileSourceView = { ref: before.fileSourceBinding!, name: '原文件.sql', displayPath: 'RAM原文件.sql', encoding: 'utf8', bom: 'none', eol: stored.includes('\r') ? 'crlf' : 'lf', savedSqlDigest: createHash('sha256').update(stored).digest('hex') };
    try {
      for (let capture = 0; capture < 3; capture++) { const snapshot = f.capture(); expect(snapshot.sql).toBe(stored); expect(await queryFileSourceHasChanges(snapshot.sql!, source)).toBe(false); expect(Object.isFrozen(snapshot)).toBe(true); }
      expect(f.tab()).toBe(before); expect(f.published).not.toHaveBeenCalled(); expect(f.model.getValue()).toBe(eol === '\n' ? 'SELECT 原文;\n' : 'SELECT 原文;\r\n'); expect(f.model.version).toBe(version); expect(f.editor.getModel()).toBe(f.model); expect([f.model.controlledEdits, f.model.stackStops, f.editor.setValueCalls, f.editor.undoStops]).toEqual([0, 0, 0, 0]);
    } finally { f.dispose(); }
  });
  it('通用flush没有选择策略时仍交付实际模型全文，保持原默认语义', () => {
    const f = fixture(); try { expect(flushEditorContent(f.editor as any, f.tab().sql)).toBe('SELECT 原文;\r\n'); expect(f.tab().sql).toBe('SELECT 原文;\r\n'); expect(f.published).toHaveBeenCalledExactlyOnceWith('SELECT 原文;\r\n'); } finally { f.dispose(); }
  });
  it.each(['SELECT 新输入;\r\n', 'SELECT 原文;\r\n'])('尚未交付的真实模型版本%s不能当作未编辑草稿，仍交付实际输入', sql => {
    const f = fixture(); try { f.model.deferred = true; f.editor.nativeInput(sql); const version = f.model.version; const snapshot = f.capture(); expect(snapshot.sql).toBe(sql); expect(f.tab().sql).toBe(sql); expect(f.published).toHaveBeenCalledExactlyOnceWith(sql); expect(f.model.version).toBe(version); expect(f.editor.setValueCalls).toBe(0); } finally { f.dispose(); }
  });
  it('未交付原生版本之后的等价sync不能洗掉仅换行输入，仍必须交付', () => {
    const f = fixture(); try { f.model.deferred = true; f.editor.nativeInput('SELECT 原文;\r\n'); f.bridge.sync(); const version = f.model.version; expect(f.capture().sql).toBe('SELECT 原文;\r\n'); expect(f.published).toHaveBeenCalledExactlyOnceWith('SELECT 原文;\r\n'); expect(f.model.version).toBe(version); expect(f.model.controlledEdits).toBe(0); } finally { f.dispose(); }
  });
  it.each(['SELECT 外部新草稿;\n', 'SELECT 原文;\r\n'])('外部props%s尚未sync即拒绝，即使只改EOL且碰巧等于模型', sql => {
    const f = fixture(); try { f.external(sql); expect(f.capture).toThrow(); expect(f.tab().sql).toBe(sql); expect(f.published).not.toHaveBeenCalled(); f.bridge.sync(); expect(f.capture().sql).toBe(sql); } finally { f.dispose(); }
  });
  it('陈旧expected不能借EOL策略取得新草稿正文', () => {
    const f = fixture(); try { expect(() => flushEditorContent(f.editor as any, 'SELECT 旧稿;', policy)).toThrow(); expect(f.published).not.toHaveBeenCalled(); } finally { f.dispose(); }
  });
  it.each(['props只读', '原生只读', '模型已释放', '桥已释放', '原模型归属丢失'])('%s仍拒绝来源捕获，不退回store正文', mode => {
    const f = fixture(); try { if (mode === 'props只读') f.readonly(); if (mode === '原生只读') f.editor.readOnly = true; if (mode === '模型已释放') f.model.dispose(); if (mode === '桥已释放') f.bridge.dispose(); if (mode === '原模型归属丢失') f.editor.model = null; expect(f.capture).toThrow(); expect(f.published).not.toHaveBeenCalled(); expect(f.tab().sql).toBe('SELECT 原文;\n'); } finally { f.dispose(); }
  });
  it('读取EOL期间模型版本漂移必须拒绝且不回声', () => {
    const f = fixture(); try { f.model.getEOL = () => { f.model.version++; return '\r\n'; }; expect(f.capture).toThrow(); expect(f.published).not.toHaveBeenCalled(); expect(f.tab().sql).toBe('SELECT 原文;\n'); } finally { f.dispose(); }
  });
  it('旧桥释放后不能借策略操作同editor的新桥或改变其只读状态', () => {
    const f = fixture(); f.bridge.dispose(); const replacement = editorContentBridge(f.editor as any, f.props, () => {});
    try { expect(() => f.bridge.flush(f.tab().sql, policy)).toThrow(); expect(f.editor.readOnly).toBe(false); expect(f.capture().sql).toBe('SELECT 原文;\n'); expect(f.published).not.toHaveBeenCalled(); } finally { replacement.dispose(); f.dispose(); }
  });
  it('真实交付期间fileSourceBinding变代，原逐字段门仍拒绝并保留新状态', () => {
    const f = fixture(); try { f.model.deferred = true; f.editor.nativeInput('SELECT 新输入;'); f.publishing(() => f.patch({ fileSourceBinding: { ...f.tab().fileSourceBinding!, revision: 2 } })); expect(f.capture).toThrow(); expect(f.tab().fileSourceBinding?.revision).toBe(2); expect(f.tab().sql).toBe('SELECT 新输入;'); } finally { f.dispose(); }
  });
});
