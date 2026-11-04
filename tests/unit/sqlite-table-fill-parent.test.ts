import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';
import { prepareSqliteFill, sqliteFillSourceCurrent, type SqliteFillField } from '../../src/renderer/sqliteTableFill';
import { sqliteRecordBatchZh as batchText } from '../../src/renderer/locales/sqliteRecordBatch.zh-CN';
import { sqliteTableFillZh as fillText } from '../../src/renderer/locales/sqliteTableFill.zh-CN';

/** 真实父处理器、来源签发与editor；DOM、store、Grid通知及React发布为RAM，不冒充窗口。 */
function fixture() {
  const file = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['selectCheckedRows', 'checkedRowsCurrent', 'openFill', 'fillCurrent', 'stageFill', 'stageRecordBatch', 'closeFill'], methods: string[] = [];
  function walk(node: ts.Node) { if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) methods.push(node.getText(file)); ts.forEachChild(node, walk); }
  walk(file); expect(methods).toHaveLength(names.length);
  const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'note', declaredType: 'TEXT' }, { name: 'exact', declaredType: 'INTEGER' }, { name: 'g', declaredType: 'TEXT', generated: true }];
  const page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), columns, offset: 0, limit: 100, hasMore: false,
    result: { columns: columns.map((column, index) => ({ name: column.name, key: 'c' + index, type: 'SQLITE' })), rows: [{}, {}, {}], statement: '', elapsedMs: 0, truncated: false },
    edit: { kind: 'editable', snapshotId: 'snapshot', expiresAt: new Date(Date.now() + 300000).toISOString(), columns: columns.map(column => ({ ...column, generated: !!column.generated, nullable: true, hasDefault: false })), rows: Array.from({ length: 3 }, (_, index) => [{ kind: 'integer', value: String(index + 1) }, { kind: 'text', value: '原值' + index }, { kind: 'integer', value: '9223372036854775807' }, { kind: 'text', value: '原生成' }]), locator: { kind: 'rowid', columns: [] } } };
  let sequence = 0; const alive = { value: true }, active = { value: true }, dialogs = { owners: [] as string[], count: 1 }, captureLive = { value: true };
  const workspace = { settings: { activeTabId: 't' }, activeJobs: {} as Record<string, boolean>, notify: vi.fn() };
  const preview = vi.fn(), apply = vi.fn(), release = vi.fn(async () => {}), changed = vi.fn(), editor = new SqliteTableEditor(page, { current: () => alive.value, active: () => active.value && workspace.settings.activeTabId === 't', available: () => !workspace.activeJobs.t, acquire: () => ({ owns: () => true, release: () => true }), id: () => 'new-' + ++sequence, now: Date.now, changed, dirty: () => {}, preview, apply, release, cancel: vi.fn(), committed: () => {} });
  // 仅将VM父方法生成的外层ids数组转回真实Editor realm，业务校验和账本仍运行真实实现。
  const fill = editor.fillRows.bind(editor); vi.spyOn(editor, 'fillRows').mockImplementation((ids, fields) => fill(Array.from(ids), fields));
  const editorRef = { current: editor as SqliteTableEditor | null }, checkedRef = { current: undefined as any }, fillRef = { current: null as any }, rows = editor.view.rows;
  const context: any = createContext({ page, editRows: rows, checkedRows: undefined, checkedRef, fillRef, editorRef, renderedEditor: editor, tab: { id: 't' }, latest: { current: { active: true } },
    editActionCurrent: () => editorRef.current === editor && editor.canEdit(), available: () => !fillRef.current && !dialogs.owners.length,
    inputRef: { current: null }, previewRef: { current: null }, pasteRef: { current: null }, rangeRef: { current: null }, importRef: { current: null }, fullExportRef: { current: null }, findRef: { current: null }, exportData: null,
    document: { querySelectorAll: () => dialogs.owners.map(owner => ({ querySelectorAll: () => Array.from({ length: dialogs.count }, () => ({ getAttribute: () => owner })) })) },
    useWorkspace: { getState: () => workspace }, uid: () => 'fill-' + ++sequence, prepareSqliteFill, sqliteFillSourceCurrent, fillText, batchText, closeFind: vi.fn(), setValidation: vi.fn(), setFillOpen: vi.fn(), errorMessage: (reason: Error) => reason.message });
  context.setCheckedRows = vi.fn((owner: unknown) => { context.checkedRows = owner; });
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.api={' + names.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  function choose(indices = [0, 1]) { context.editRows = editor.view.rows; captureLive.value = true; const capture = Object.freeze({ page, rows: editor.view.rows, selected: Object.freeze(indices.map(index => editor.view.rows[index])), current: () => captureLive.value }); context.api.selectCheckedRows(capture); expect(checkedRef.current?.capture).toBe(capture); return capture; }
  function open(mode: 'fill' | 'records' = 'fill') { choose(); context.api.openFill(mode); const ticket = fillRef.current; expect(ticket).toBeTruthy(); dialogs.owners = [ticket.id]; expect(context.api.fillCurrent(ticket)).toBe(true); return ticket; }
  return { context, api: context.api, editor, editorRef, page, rows, alive, active, dialogs, workspace, checkedRef, fillRef, captureLive, preview, apply, release, changed, choose, open, dispose: () => editor.dispose() };
}
const fields: readonly SqliteFillField[] = [{ column: 1, value: { kind: 'text', value: '新\0🚢' } }, { column: 2, value: { kind: 'integer', value: '-9223372036854775808' } }];
it('只打开取消不改原行、撤销栈或预览，也不投递任何数据库操作', () => {
  const f = fixture(), ticket = f.open(); expect(f.editor.view.rows).toBe(f.rows); expect(f.editor.changes).toEqual([]); expect(f.editor.view.undo).toBe(false); f.api.closeFill(ticket);
  expect(f.fillRef.current).toBeNull(); expect(f.editor.dirty).toBe(false); expect(f.editor.view.rows).toBe(f.rows); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); f.dispose();
});
it('自己Modal撤销旧Grid捕获后仍靠独立原来源暂存，一次undo/redo且不提交', () => {
  const f = fixture(), ticket = f.open(); f.captureLive.value = false; expect(f.api.stageFill(ticket, fields)).toBe(true);
  expect(f.editor.changes).toHaveLength(2); expect(f.editor.view.rows[0].values[2]).toEqual(fields[1].value); expect(f.editor.view.rows[2]).toBe(f.rows[2]); expect(f.checkedRef.current).toBeUndefined(); expect(f.workspace.notify).toHaveBeenCalledWith(fillText.changed(4));
  f.dialogs.owners = []; f.editor.undo(); expect(f.editor.view.rows).toBe(f.rows); expect(f.editor.changes).toEqual([]); f.editor.redo(); expect(f.editor.changes).toHaveLength(2); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); f.dispose();
});
it('同值暂存不制造撤销步骤，输入占用仍正常释放', () => {
  const f = fixture(); f.choose([0]); f.api.openFill(); const ticket = f.fillRef.current; f.dialogs.owners = [ticket.id]; expect(f.api.stageFill(ticket, [{ column: 1, value: { kind: 'text', value: '原值0' } }])).toBe(true); expect(f.editor.view.rows).toBe(f.rows); expect(f.editor.view.undo).toBe(false); expect(f.editor.dirty).toBe(false); f.dispose();
});
it('生成列拒绝保留输入票据、原行和历史，随后合法修正仍可暂存', () => {
  const f = fixture(), ticket = f.open(); expect(() => f.api.stageFill(ticket, [{ column: 3, value: { kind: 'text', value: '非法生成' } }])).toThrow(); expect(f.fillRef.current).toBe(ticket); expect(f.editor.view.rows).toBe(f.rows); expect(f.editor.view.undo).toBe(false); expect(f.api.stageFill(ticket, fields)).toBe(true); f.dispose();
});
it.each(['inactive', 'busy', 'source-value', 'source-row', 'metadata', 'profile', 'foreign-modal', 'two-modals', 'duplicate-marker', 'detached'] as const)('%s改变后旧输入不复活、不发预览或修改', change => {
  const f = fixture(), ticket = f.open();
  if (change === 'inactive') f.workspace.settings.activeTabId = 'other';
  if (change === 'busy') f.workspace.activeJobs.t = true;
  if (change === 'source-value') (f.rows[0].values[1] as { value: string }).value = '外部变化';
  if (change === 'source-row') f.rows[0].values = [...f.rows[0].values];
  if (change === 'metadata') f.page.columns[0].name = '后来字段';
  if (change === 'profile') { f.alive.value = false; f.editor.observe(); }
  if (change === 'foreign-modal') f.dialogs.owners = ['other'];
  if (change === 'two-modals') f.dialogs.owners.push('other');
  if (change === 'duplicate-marker') f.dialogs.count = 2;
  if (change === 'detached') f.dialogs.owners = [];
  expect(f.api.fillCurrent(ticket)).toBe(false); f.workspace.settings.activeTabId = 't'; delete f.workspace.activeJobs.t; f.alive.value = true; f.dialogs.owners = [ticket.id]; f.dialogs.count = 1;
  expect(f.api.stageFill(ticket, fields)).toBe(false); expect(f.editor.fillRows).not.toHaveBeenCalled(); expect(f.editor.view.undo).toBe(false); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); f.api.closeFill(ticket); expect(f.fillRef.current).toBeNull(); f.dispose();
});
it('无准确自身Modal时暂存拒绝，初次未挂DOM不撤合法打开票据', () => {
  const f = fixture(); f.choose(); f.api.openFill(); const ticket = f.fillRef.current; expect(f.api.fillCurrent(ticket)).toBe(true); expect(f.api.stageFill(ticket, fields)).toBe(false); expect(f.editor.fillRows).not.toHaveBeenCalled(); f.api.closeFill(ticket); f.dispose();
});
it('旧保存／关闭回调不能清后来窗口或写新页同ID记录', () => {
  const f = fixture(), first = f.open(); f.api.closeFill(first); f.dialogs.owners = []; const next = f.open(); f.api.closeFill(first); expect(f.fillRef.current).toBe(next); expect(f.api.stageFill(first, fields)).toBe(false); expect(f.api.stageFill(next, fields)).toBe(true); expect(f.editor.fillRows).toHaveBeenCalledOnce(); f.dispose();
});
it.each(['inputRef', 'previewRef', 'pasteRef', 'rangeRef', 'importRef', 'fullExportRef'] as const)('%s占用时不打开填充输入', field => {
  const f = fixture(); f.choose(); f.context[field].current = {}; f.api.openFill(); expect(f.fillRef.current).toBeNull(); expect(f.editor.dirty).toBe(false); f.dispose();
});

/** 批量表单父入口沿用准确勾选能力；不同模式不能互相借票据。 */
it('records父入口一次发布不同字段、清选择且只形成一步撤销，取消不发SQL', () => {
 const f=fixture(),ticket=f.open('records');f.captureLive.value=false;
 const patches=[{rowId:f.rows[0].id,fields:[{column:1,value:{kind:'text',value:'第一独立'}}]},{rowId:f.rows[1].id,fields:[{column:2,value:{kind:'integer',value:'9007199254740993'}}]}];
 expect(f.api.stageFill(ticket,fields)).toBe(false);expect(f.api.stageRecordBatch(ticket,patches)).toBe(true);expect(f.editor.changes).toHaveLength(2);expect(f.editor.view.rows[0].values[1]).toEqual(patches[0].fields[0].value);expect(f.editor.view.rows[1].values[2]).toEqual(patches[1].fields[0].value);expect(f.editor.view.rows[2]).toBe(f.rows[2]);expect(f.checkedRef.current).toBeUndefined();expect(f.fillRef.current).toBeNull();expect(f.workspace.notify).toHaveBeenCalledWith(batchText.changed(2));
 const after=f.editor.view.rows;f.dialogs.owners=[];f.editor.undo();expect(f.editor.view.rows).toBe(f.rows);expect(f.editor.view.undo).toBe(false);f.editor.redo();expect(f.editor.view.rows).toBe(after);expect(f.preview).not.toHaveBeenCalled();expect(f.apply).not.toHaveBeenCalled();f.dispose();
});
it('records取消／noop均不制造历史；fill模式票据不能提交records',()=>{
 const f=fixture(),fill=f.open();expect(f.api.stageRecordBatch(fill,[])).toBe(false);f.api.closeFill(fill);f.dialogs.owners=[];const canceled=f.open('records');f.api.closeFill(canceled);expect(f.editor.view.rows).toBe(f.rows);expect(f.editor.view.undo).toBe(false);f.dialogs.owners=[];const noop=f.open('records');expect(f.api.stageRecordBatch(noop,[])).toBe(true);expect(f.editor.view.rows).toBe(f.rows);expect(f.editor.view.undo).toBe(false);expect(f.preview).not.toHaveBeenCalled();expect(f.apply).not.toHaveBeenCalled();f.dispose();
});
it('records后组非法拒绝整批且原票据可修正重试',()=>{
 const f=fixture(),ticket=f.open('records'),good={rowId:f.rows[0].id,fields:[{column:1,value:{kind:'text',value:'第一'}}]};
 expect(()=>f.api.stageRecordBatch(ticket,[good,{rowId:f.rows[1].id,fields:[{column:3,value:{kind:'text',value:'生成列'}}]}])).toThrow();expect(f.editor.view.rows).toBe(f.rows);expect(f.fillRef.current).toBe(ticket);expect(f.editor.view.undo).toBe(false);expect(f.api.stageRecordBatch(ticket,[good])).toBe(true);f.dispose();
});
it.each(['inactive','busy','metadata','foreign-modal','two-modals','duplicate-marker','detached']as const)('records %s观察失效后不可ABA复活，保留原草稿',change=>{
 const f=fixture(),ticket=f.open('records'),name=f.page.columns[0].name;
 if(change==='inactive')f.workspace.settings.activeTabId='other';if(change==='busy')f.workspace.activeJobs.t=true;if(change==='metadata')f.page.columns[0].name='变更';if(change==='foreign-modal')f.dialogs.owners=['other'];if(change==='two-modals')f.dialogs.owners.push('other');if(change==='duplicate-marker')f.dialogs.count=2;if(change==='detached')f.dialogs.owners=[];
 expect(f.api.fillCurrent(ticket)).toBe(false);f.workspace.settings.activeTabId='t';delete f.workspace.activeJobs.t;f.page.columns[0].name=name;f.dialogs.owners=[ticket.id];f.dialogs.count=1;expect(f.api.stageRecordBatch(ticket,[{rowId:f.rows[0].id,fields:[{column:1,value:{kind:'text',value:'旧'}}]}])).toBe(false);expect(f.editor.view.rows).toBe(f.rows);expect(f.preview).not.toHaveBeenCalled();expect(f.apply).not.toHaveBeenCalled();f.api.closeFill(ticket);f.dispose();
});
it('records旧关闭和保存不接管后来窗口，原选择不是当前全页',()=>{
 const f=fixture(),old=f.open('records');f.api.closeFill(old);f.dialogs.owners=[];f.choose([2]);f.api.openFill('records');const next=f.fillRef.current;f.dialogs.owners=[next.id];f.api.closeFill(old);expect(f.fillRef.current).toBe(next);expect(f.api.stageRecordBatch(old,[])).toBe(false);expect(()=>f.api.stageRecordBatch(next,[{rowId:f.rows[0].id,fields:[]}])).toThrow();expect(f.editor.view.rows).toBe(f.rows);expect(f.api.stageRecordBatch(next,[{rowId:f.rows[2].id,fields:[{column:1,value:{kind:'text',value:'仅第三'}}]}])).toBe(true);expect(f.editor.view.rows[0]).toBe(f.rows[0]);f.dispose();
});
