import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Clock3, FileCode2, Search, Trash2 } from 'lucide-react';
import type { SavedQueryPage, SavedQueryPageEntry } from '../../shared/savedQueryPages';
import type { SavedQueryGroupScope, SavedQueryOrganizationSnapshot } from '../../shared/savedQueryOrganization';
import type { SavedQueryOpenResult } from '../../shared/savedQuerySearch';
import { zh, formatText } from '../locales/zh-CN';
import { queryContextZh } from '../locales/queryContext.zh-CN';
import { savedQueryPagesZh as t } from '../locales/savedQueryPages.zh-CN';
import { savedQueryOrganizationZh as text } from '../locales/savedQueryOrganization.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { useWorkspace } from '../store';
import { readSavedQueryOrganization, savedQueryOrganizationTree, type SelectedSavedQuery, type SavedQueryOrganizationPreview } from '../savedQueryOrganizationUi';
import { SavedQueryOrganizationEditor, type SavedQueryOrganizationEdit } from './SavedQueryOrganizationEditor';
import { SavedQueryRenameEditor, type SavedQueryRenameOrigin } from './SavedQueryRenameEditor';
import { savedQueryRenameSchema, savedQueryRenameZh as renameText } from '../../shared/savedQueryRename';
import { SavedQueryDeleteSelectedPreview } from './SavedQueryDeleteSelectedPreview';
import { savedQueryDeleteSelectedSchema, readSavedQueryDeleteSelectedResult, savedQueryDeleteSelectedZh as deleteText } from '../../shared/savedQueryDeleteSelected';
import { Empty, ErrorBox, Modal, Spinner, UsageHelp } from './ui';
import type { HistoryInsertionTarget } from '../historyInsertion';
import { savedQueryInsertionZh as insertionText } from '../locales/savedQueryInsertion.zh-CN';
import '../savedQueryPages.css';

interface Services { request: typeof invoke; id(): string; }
const services: Services = { request: invoke, id: uid };
interface Criteria { search: string; policy: 'stop' | 'continue'; group: SavedQueryGroupScope; }
interface RenameEdit { source: SavedQueryRenameOrigin; page: SavedQueryPage; criteria: string; epoch: number; }
interface DeleteEdit { items: readonly SelectedSavedQuery[]; selection: ReadonlyMap<string, SelectedSavedQuery>; epoch: number; }
const criteriaKey = (value: Criteria) => JSON.stringify([value.search, value.policy, value.group]);
interface Edit { value: SavedQueryOrganizationEdit; snapshot: SavedQueryOrganizationSnapshot; selected: readonly SelectedSavedQuery[]; epoch: number; }

/** 原Promise锁覆盖分组和列表；跨页选择只存编号、摘要和名称，不累计SQL正文。 */
export function SavedQueriesDialog({ onClose, onHistory, insertion, services: io = services }: { onClose(): void; onHistory(): void; insertion?: HistoryInsertionTarget | null; services?: Services }) {
  const connections = useWorkspace(state => state.connections);
  const [search, setSearch] = useState(''), [policy, setPolicy] = useState<'stop' | 'continue'>('continue'), [group, setGroup] = useState<SavedQueryGroupScope>({ kind: 'all' }), [includeDescendants, setIncludeDescendants] = useState(true);
  const [reply, setReply] = useState<SavedQueryPage>(), [batch, setBatch] = useState(0), [applied, setApplied] = useState(''), [busy, setBusy] = useState(true), [closing, setClosing] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [organization, setOrganization] = useState<SavedQueryOrganizationSnapshot>(), organizationRef = useRef(organization);
  const [selected, setSelected] = useState<ReadonlyMap<string, SelectedSavedQuery>>(new Map()), selectedRef = useRef(selected), [editing, setEditing] = useState<Edit>(), editRef = useRef(editing), [needsRefresh, setNeedsRefresh] = useState(false), [targets, setTargets] = useState(new Map<string, string>());
  const [renaming, setRenaming] = useState<RenameEdit>(), renameRef = useRef<RenameEdit | undefined>(undefined);
  const [deleting, setDeleting] = useState<DeleteEdit>(), deleteRef = useRef<DeleteEdit | undefined>(undefined);
  const cursor = useRef<string | undefined>(undefined), active = useRef<string | undefined>(undefined), pending = useRef<Promise<void> | undefined>(undefined), locked = useRef(false), closed = useRef(false), alive = useRef(true), epoch = useRef(0);
  const criteria: Criteria = { search, policy, group }, criteriaRef = useRef(criteria); criteriaRef.current = criteria; const renderEpoch = epoch.current;
  const insertionRef = useRef(insertion), previousInsertion = useRef(insertion), insertionClosing = useRef(false), cancelledInsertion = useRef(false);
  insertionRef.current = insertion;
  const [insertAvailable, setInsertAvailable] = useState(() => insertion?.current() ?? false);
  const pageView = useRef({ reply, applied, needsRefresh }); pageView.current = { reply, applied, needsRefresh };
  /** 每个资料页只持父面板借出的子租约；换目标后旧目标不可因相同prop恢复而复活。 */
  useLayoutEffect(() => {
    if (previousInsertion.current !== insertion) { previousInsertion.current?.dispose(); previousInsertion.current = insertion; }
    const sync = () => setInsertAvailable(insertion?.current() ?? false);
    const off = insertion?.subscribe(sync); sync(); return () => { off?.(); };
  }, [insertion]);
  const owns = (ticket: number) => alive.current && !closed.current && epoch.current === ticket;
  const editable = () => owns(renderEpoch) && !locked.current && !editRef.current && !renameRef.current && !deleteRef.current;
  /** 原句柄仅在成功释放后遗忘；迟到新页也精确回收。 */
  async function release() { const value = cursor.current; if (value) { await io.request('queries.pageRelease', { cursor: value }); if (cursor.current === value) cursor.current = undefined; } }
  /** 取消失败仍等原Promise终态并释放，不能让观察超时或按钮点击提前放行。 */
  async function cleanup() { let failure: unknown; if (active.current) try { await io.request('query.cancel', { taskId: active.current }); } catch (reason) { failure = reason; } await pending.current?.catch(() => {}); await release(); if (failure) throw failure; }
  async function close(after = onClose, keepInsertion = false) {
    // Escape在读取或释放期间仍撤销插入，不能因原close正在等待而忽略关闭意图。
    if (!keepInsertion) { insertionRef.current?.dispose(); if (insertionClosing.current) cancelledInsertion.current = true; }
    if (closed.current) return;
    closed.current = true; insertionClosing.current = keepInsertion; cancelledInsertion.current = false;
    if (!keepInsertion) epoch.current++;
    editRef.current = undefined; setEditing(undefined); renameRef.current = undefined; setRenaming(undefined); deleteRef.current = undefined; setDeleting(undefined); setClosing(true);
    try { await cleanup(); if (!alive.current) return; if (keepInsertion && cancelledInsertion.current) onClose(); else after(); }
    catch (reason) { if (alive.current) { closed.current = false; setClosing(false); setError(errorMessage(reason)); } }
    finally { insertionClosing.current = false; }
  }
  /** 同步占锁并跟踪整项操作；每个旧渲染回调仅能使用原代次。 */
  function run(action: (ticket: number) => Promise<void>, expected = renderEpoch): Promise<void> | undefined {
    if (!owns(expected) || locked.current) return;
    locked.current = true; const ticket = ++epoch.current; setBusy(true); setError(''); setNotice('');
    // action延后到原Promise微任务，保证同步抛错也只在operation完成赋值后执行收尾。
    const operation: Promise<void> = Promise.resolve().then(() => action(ticket)).catch(reason => { if (owns(ticket)) setError(errorMessage(reason)); }).finally(() => { if (pending.current === operation) pending.current = undefined; locked.current = false; if (alive.current && !closed.current) setBusy(false); });
    pending.current = operation; return operation;
  }
  /** 外来树与计数先完整校验，不存在的范围明确退回未分组。 */
  function publish(raw: unknown, requested: SavedQueryGroupScope): SavedQueryGroupScope { const value = readSavedQueryOrganization(raw); organizationRef.current = value; setOrganization(value); const next = requested.kind === 'group' && !value.groups.some(item => item.id === requested.id) ? { kind: 'unfiled' } as const : requested; if (next !== requested) setNotice(text.scopeRemoved); setGroup(next); criteriaRef.current = { ...criteriaRef.current, group: next }; return next; }
  /** 续页只有cursor和taskId；旧页不累积，迟到句柄在原操作内释放。 */
  async function readPage(ticket: number, value: Criteria, next = false) {
    const previous = cursor.current;
    if (!next) { await release(); if (!owns(ticket)) return; setReply(undefined); setBatch(0); setTargets(new Map()); } else if (!previous) return;
    cursor.current = undefined; const taskId = io.id(); active.current = taskId;
    try {
      const page = await (next ? io.request('queries.pageContinue', { taskId, cursor: previous! }) : io.request('queries.page', { taskId, search: value.search, onError: value.policy, ...(value.group.kind === 'all' ? {} : { group: value.group }) }));
      cursor.current = page.cursor; if (!owns(ticket)) { await release(); return; }
      setReply(page); setBatch(count => next ? count + 1 : 1); setApplied(criteriaKey(value)); setTargets(new Map());
    } catch (reason) { if (owns(ticket) && next) { setReply(previous => previous ? { ...previous, cursor: undefined } : previous); setNeedsRefresh(true); } throw reason; }
    finally { if (active.current === taskId) active.current = undefined; }
  }
  /** 显式第一页重新读取组织版本；全文、组范围和原错误策略共同生效。 */
  function load(next = false, requested = criteriaRef.current, expected = renderEpoch) { if (editRef.current || renameRef.current || deleteRef.current) return; return run(async ticket => { let value = requested; if (!next) { const raw = await io.request('queries.organizationGet', {}); if (!owns(ticket)) return; value = { ...requested, group: publish(raw, requested.group) }; setNeedsRefresh(false); } await readPage(ticket, value, next); }, expected); }
  useEffect(() => {
    alive.current = true; closed.current = false; const ticket = epoch.current;
    // StrictMode的旧setup尚未投递时只留本轮启动权；cleanup不消费父传入的子权限。
    void Promise.resolve(pending.current).then(() => { if (owns(ticket)) void load(false, criteriaRef.current, ticket); });
    return () => { alive.current = false; closed.current = true; epoch.current++; editRef.current = undefined; renameRef.current = undefined; deleteRef.current = undefined; void cleanup().catch(reason => useWorkspace.getState().notify(t.cleanupFailed + errorMessage(reason), true)); };
  }, []);
  /** 草稿改变只撤销旧事件，不自动查询或释放旧页。 */
  function draft(action: () => void) { if (!editable()) return; epoch.current++; action(); }
  function selectScope(value: SavedQueryGroupScope) { if (!editable()) return; setGroup(value); criteriaRef.current = { ...criteriaRef.current, group: value }; void load(false, criteriaRef.current); }
  function choose(item: SavedQueryPageEntry, checked: boolean) { if (!editable()) return; const next = new Map(selectedRef.current); if (checked) { if (!next.has(item.query.id) && next.size >= 100) { setError(text.selectionLimit); return; } next.set(item.query.id, { id: item.query.id, digest: item.digest, name: item.query.name }); } else next.delete(item.query.id); epoch.current++; selectedRef.current = next; setSelected(next); }
  /** 当前页选择先计算完整并集再发布，超100条整批拒绝；取消本页保留隐藏选择。 */
  function choosePage(checked: boolean) { if (!editable() || !reply?.items.length) return; const next = new Map(selectedRef.current); if (checked) { const ids = new Set([...next.keys(), ...reply.items.map(item => item.query.id)]); if (ids.size > 100) { setError(text.selectionLimit); return; } for (const item of reply.items) next.set(item.query.id, { id: item.query.id, digest: item.digest, name: item.query.name }); } else for (const item of reply.items) next.delete(item.query.id); epoch.current++; selectedRef.current = next; setSelected(next); }
  function clearSelection() { if (!editable()) return; epoch.current++; selectedRef.current = new Map(); setSelected(selectedRef.current); }
  /** 原树对象、原选择和代次一起捕获，外来快照或旧回调不能换目标。 */
  function edit(value: SavedQueryOrganizationEdit) { if (!editable() || !organizationRef.current || needsRefresh) return; const next = { value, snapshot: organizationRef.current, selected: Object.freeze([...selectedRef.current.values()].map(item => Object.freeze({ ...item }))), epoch: ++epoch.current }; editRef.current = next; setEditing(next); setError(''); }
  function cancelEdit() { if (locked.current || !editRef.current) return; epoch.current++; editRef.current = undefined; setEditing(undefined); }
  /** 仅提交已展示的冻结CAS补丁；失败要求手动刷新，不重放、不逐条降级写入。 */
  function apply(preview: SavedQueryOrganizationPreview, origin: Edit) {
    if (closed.current || locked.current || editRef.current !== origin || epoch.current !== origin.epoch || organizationRef.current !== origin.snapshot || preview.input.expectedRevision !== origin.snapshot.revision) return;
    void run(async ticket => { try { const raw = await io.request('queries.organizationApply', preview.input); if (!owns(ticket)) return; const nextGroup = publish(raw, criteriaRef.current.group); editRef.current = undefined; setEditing(undefined); selectedRef.current = new Map(); setSelected(selectedRef.current); setNeedsRefresh(false); await readPage(ticket, { ...criteriaRef.current, group: nextGroup }); if (owns(ticket)) setNotice(text.saved); } catch (reason) { if (owns(ticket)) { editRef.current = undefined; setEditing(undefined); setNeedsRefresh(true); setError(errorMessage(reason)); } } }, origin.epoch);
  }
  /** 只捕获所见记录的名称和摘要，不读取完整SQL或借用当前打开查询。 */
  function beginRename(item: SavedQueryPageEntry): void {
    if (!editable() || needsRefresh || !reply?.items.includes(item) || criteriaKey(criteriaRef.current) !== applied) return;
    const origin: RenameEdit = { source: Object.freeze({ id: item.query.id, digest: item.digest, name: item.query.name }), page: reply, criteria: applied, epoch: ++epoch.current };
    renameRef.current = origin; setRenaming(origin); setError(''); setNotice('');
  }
  /** 取消只撤销当前名称草稿，旧面板回调不能关闭后来打开的编辑器。 */
  function cancelRename(origin: RenameEdit): void {
    if (locked.current || renameRef.current !== origin || !owns(origin.epoch)) return;
    epoch.current++; renameRef.current = undefined; setRenaming(undefined);
  }
  /** 名称变更独立提交；提交成功而刷新失败时如实保留已保存事实，不能重放重命名。 */
  function applyRename(name: string, origin: RenameEdit): void {
    if (locked.current || renameRef.current !== origin || !owns(origin.epoch) || pageView.current.reply !== origin.page || pageView.current.needsRefresh || criteriaKey(criteriaRef.current) !== origin.criteria) return;
    const input = savedQueryRenameSchema.safeParse({ id: origin.source.id, digest: origin.source.digest, name });
    if (!input.success || name === origin.source.name) { setError(input.success ? renameText.noChange : renameText.invalidName); return; }
    void run(async ticket => {
      let committed = false;
      try {
        await io.request('queries.renameChecked', input.data); committed = true;
        if (!owns(ticket)) return;
        renameRef.current = undefined; setRenaming(undefined); setNeedsRefresh(true);
        const next = new Map(selectedRef.current); next.delete(origin.source.id); selectedRef.current = next; setSelected(next);
        const raw = await io.request('queries.organizationGet', {}); if (!owns(ticket)) return;
        const group = publish(raw, criteriaRef.current.group);
        await readPage(ticket, { ...criteriaRef.current, group });
        if (owns(ticket)) { setNeedsRefresh(false); setNotice(renameText.renamed); }
      } catch (reason) {
        if (!owns(ticket)) return;
        renameRef.current = undefined; setRenaming(undefined); setNeedsRefresh(true); setError(errorMessage(reason));
        if (committed) setNotice(renameText.refreshRequired);
      }
    }, origin.epoch);
  }
  /** 跨页选择完整复制为只含名称和引用的预览，不因当前页或搜索隐藏而缩减删除范围。 */
  function beginDeleteSelected(): void {
    if (!editable() || needsRefresh || !selectedRef.current.size) return;
    const items = Object.freeze([...selectedRef.current.values()].map(item => Object.freeze({ ...item })));
    const parsed = savedQueryDeleteSelectedSchema.safeParse({ queries: items.map(({ id, digest }) => ({ id, digest })) });
    if (!parsed.success) { setError(deleteText.invalid); return; }
    const origin: DeleteEdit = { items, selection: selectedRef.current, epoch: ++epoch.current };
    deleteRef.current = origin; setDeleting(origin); setError(''); setNotice('');
  }
  /** 取消只撤销所见批量预览，不能消费新选择或后来打开的面板。 */
  function cancelDeleteSelected(origin: DeleteEdit): void {
    if (locked.current || deleteRef.current !== origin || !owns(origin.epoch)) return;
    epoch.current++; deleteRef.current = undefined; setDeleting(undefined);
  }
  /** 确切计数回执确认后再清所选；成功与后续刷新失败分开，不重试任何删除。 */
  function applyDeleteSelected(origin: DeleteEdit): void {
    if (locked.current || deleteRef.current !== origin || !owns(origin.epoch) || selectedRef.current !== origin.selection) return;
    const input = savedQueryDeleteSelectedSchema.parse({ queries: origin.items.map(({ id, digest }) => ({ id, digest })) });
    void run(async ticket => {
      let committed = false;
      try {
        const raw = await io.request('queries.deleteSelectedChecked', input);
        const result = readSavedQueryDeleteSelectedResult(raw, origin.items.length); committed = true;
        if (!owns(ticket)) return;
        deleteRef.current = undefined; setDeleting(undefined); setNeedsRefresh(true);
        const next = new Map(selectedRef.current); for (const item of origin.items) next.delete(item.id); selectedRef.current = next; setSelected(next);
        const groups = await io.request('queries.organizationGet', {}); if (!owns(ticket)) return;
        const group = publish(groups, criteriaRef.current.group);
        await readPage(ticket, { ...criteriaRef.current, group });
        if (owns(ticket)) { setNeedsRefresh(false); setNotice(deleteText.deleted(result.deleted)); }
      } catch (reason) {
        if (!owns(ticket)) return;
        deleteRef.current = undefined; setDeleting(undefined); setNeedsRefresh(true); setError(errorMessage(reason));
        if (committed) setNotice(deleteText.refreshRequired);
      }
    }, origin.epoch);
  }
  /** 丢失来源不回退其它连接；打开仅重读摘要对应原文，不执行SQL。 */
  function target(item: SavedQueryPageEntry) { return targets.has(item.query.id) ? targets.get(item.query.id)! : connections.some(value => value.id === item.query.connectionId) ? item.query.connectionId! : ''; }
  function open(item: SavedQueryPageEntry) {
    if (!editable()) return; const connectionId = target(item); if (!connectionId) { setError(t.choose); return; }
    let opened: SavedQueryOpenResult | undefined; const work = run(async ticket => { const result = await io.request('queries.read', { id: item.query.id, digest: item.digest, connectionId }); if (owns(ticket)) opened = result; });
    if (work) void work.then(() => { if (opened && !closed.current) { const result = opened; void close(() => { useWorkspace.getState().openTab({ id: io.id(), kind: 'query', title: result.query.name, connectionId: result.connectionId, database: result.database, databaseContext: result.databaseContext, sql: result.query.sql, sourceBinding: result.sourceBinding }); onClose(); }); } });
  }
  /** 全文按摘要重读；先退出run原Promise再关闭释放，避免cleanup等待自己的pending。 */
  function insert(item: SavedQueryPageEntry) {
    if (!editable()) return;
    const captured = insertion, original = pageView.current, source = organizationRef.current;
    const sourceCurrent = () => alive.current && insertionRef.current === captured && !!captured?.current()
      && pageView.current.reply === original.reply && pageView.current.applied === original.applied
      && !pageView.current.needsRefresh && organizationRef.current === source
      && criteriaKey(criteriaRef.current) === original.applied && original.reply?.items.includes(item) === true;
    if (!sourceCurrent()) { setError(captured ? insertionText.changed : insertionText.unavailable); return; }
    let sql: string | undefined, ticket = -1;
    const work = run(async owner => {
      ticket = owner;
      const result = await io.request('queries.readText', { id: item.query.id, digest: item.digest });
      if (owns(owner) && sourceCurrent()) sql = result.query.sql;
      else if (owns(owner)) throw Error(insertionText.changed);
    });
    if (work) void work.then(() => {
      if (sql === undefined || closed.current || !owns(ticket)) return;
      const complete = sql;
      void close(() => {
        if (epoch.current !== ticket || !sourceCurrent()) throw Error(insertionText.changed);
        captured!.insert(complete); onClose();
      }, true);
    });
  }
  function remove(item: SavedQueryPageEntry) { if (!editable()) return; void run(async ticket => { await io.request('queries.deleteChecked', { id: item.query.id, digest: item.digest }); if (!owns(ticket)) return; const next = new Map(selectedRef.current); next.delete(item.query.id); selectedRef.current = next; setSelected(next); const raw = await io.request('queries.organizationGet', {}); if (!owns(ticket)) return; const nextGroup = publish(raw, criteriaRef.current.group); await readPage(ticket, { ...criteriaRef.current, group: nextGroup }); }); }
  function databaseLabel(item: SavedQueryPageEntry) { const value = item.query, context = value.databaseContext; return context ? context.state === 'known' ? context.database || queryContextZh.none : queryContextZh.unknown : value.database ? value.database + ' (' + queryContextZh.legacy + ')' : queryContextZh.legacy; }
  const blocked = busy || closing || !!editing || !!renaming || !!deleting, changed = criteriaKey(criteria) !== applied, tree = organization ? savedQueryOrganizationTree(organization) : [], hidden = [...selected.keys()].filter(id => !reply?.items.some(item => item.query.id === id)).length, selectedGroup = group.kind === 'group' ? group.id : undefined;
  const pageSelected = reply?.items.filter(item => selected.has(item.query.id)).length ?? 0, pageAllSelected = !!reply?.items.length && pageSelected === reply.items.length, pageMixed = pageSelected > 0 && !pageAllSelected;
  return <Modal title={zh.activity.text003} wide onClose={() => { const origin = renameRef.current; if (origin) cancelRename(origin); else if (deleteRef.current) cancelDeleteSelected(deleteRef.current); else void close(); }}>
    <div className="dialog-tabs"><button disabled={closing} onClick={() => void close(onHistory)}><Clock3 size={14}/>{zh.activity.text004}</button><button className="selected"><FileCode2 size={14}/>{zh.activity.text005}</button></div>
    <div className="modal-content saved-query-pages"><UsageHelp><p>{text.metadataOnly}</p><p>{insertionText.hint}</p><p>{t.hint}</p><p>{t.openHint}</p></UsageHelp><p aria-live="polite">{insertion ? insertionText.target(insertion.title) : insertionText.unavailable}{insertion && !insertAvailable && <span> · {insertionText.changed}</span>}</p><div className="saved-query-organization-layout">
      <details className="saved-query-organization-tree" open><summary>{text.title}</summary><nav aria-label={text.tree}>
        <button disabled={blocked} aria-label={text.all} aria-current={group.kind === 'all' ? 'true' : undefined} onClick={() => selectScope({ kind: 'all' })}>{text.all} ({organization?.totalCount ?? 0})</button>
        <button disabled={blocked} aria-label={text.unfiled} aria-current={group.kind === 'unfiled' ? 'true' : undefined} onClick={() => selectScope({ kind: 'unfiled' })}>{text.unfiled} ({organization?.unfiledCount ?? 0})</button>
        {tree.map(item => <button disabled={blocked} style={{ paddingLeft: 12 + (item.depth - 1) * 14 }} key={item.id} aria-label={text.selectGroup(item.path)} title={item.path + ' · ' + text.direct(item.count, item.totalCount)} aria-current={group.kind === 'group' && group.id === item.id ? 'true' : undefined} onClick={() => selectScope({ kind: 'group', id: item.id, includeDescendants })}>{item.name} ({item.totalCount})</button>)}
      </nav><label><input type="checkbox" aria-label={text.includeDescendants} checked={includeDescendants} disabled={blocked || group.kind !== 'group'} onChange={event => { const value = event.target.checked; setIncludeDescendants(value); if (group.kind === 'group') selectScope({ ...group, includeDescendants: value }); }}/>{text.includeDescendants}</label>
        <div className="saved-query-group-actions"><button disabled={blocked || !organization || needsRefresh} onClick={() => edit({ kind: 'create', id: selectedGroup })}>{text.create}</button><button disabled={blocked || !selectedGroup || needsRefresh} onClick={() => edit({ kind: 'rename', id: selectedGroup })}>{text.rename}</button><button disabled={blocked || !selectedGroup || needsRefresh} onClick={() => edit({ kind: 'moveGroup', id: selectedGroup })}>{text.moveGroup}</button><button disabled={blocked || !selectedGroup || needsRefresh} onClick={() => edit({ kind: 'dissolve', id: selectedGroup })}>{text.dissolve}</button></div>
      </details>
      <div className="saved-query-organization-list"><div className="search-box"><Search size={15}/><input aria-label={t.search} value={search} maxLength={512} disabled={blocked} onChange={event => draft(() => setSearch(event.target.value))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void load(); } }}/><button disabled={blocked} onClick={() => void load()}>{t.searchButton}</button></div>
        <label className="inline-field">{t.onError}<select aria-label={t.onError} disabled={blocked} value={policy} onChange={event => draft(() => setPolicy(event.target.value as typeof policy))}><option value="continue">{t.continue}</option><option value="stop">{t.stop}</option></select></label>{changed && reply && <p>{t.pending}</p>}
        <p>{text.selected(selected.size, hidden)}</p><label><input type="checkbox" aria-label={text.selectPage} aria-checked={pageMixed ? 'mixed' : pageAllSelected} checked={pageAllSelected} ref={node => { if (node) node.indeterminate = pageMixed; }} disabled={blocked || !reply?.items.length} onChange={event => choosePage(event.target.checked)}/>{text.selectPage}</label><div className="saved-query-group-actions"><button disabled={blocked || !selected.size || !organization || needsRefresh} onClick={() => edit({ kind: 'moveQueries' })}>{text.moveQueries}</button><button disabled={blocked || !selected.size || needsRefresh} onClick={beginDeleteSelected}>{deleteText.open}</button><button disabled={blocked || !selected.size} onClick={clearSelection}>{text.clear}</button></div>
        <ErrorBox message={error}/>{needsRefresh && <p className="warning-text">{text.refreshRequired}</p>}{notice && <p>{notice}</p>}{busy && <Spinner/>}
        {reply && <p role="status">{formatText(t.summary, batch, reply.scanned, reply.matched, reply.failed)} {reply.stoppedOnError ? t.failedStop : reply.cursor ? t.more : t.done}</p>}
        <div className="history-list">{reply?.items.map(item => <article className="history-card" key={item.query.id}><div><label><input type="checkbox" aria-label={text.select(item.query.name)} disabled={blocked} checked={selected.has(item.query.id)} onChange={event => choose(item, event.target.checked)}/><strong>{item.query.name}</strong></label><span className="grow"/><span className="muted small">{connections.find(profile => profile.id === item.query.connectionId)?.name || t.sourceMissing} / {databaseLabel(item)}</span></div>
          <pre>{item.sqlPreview}{item.previewTruncated ? '…' : ''}</pre>{item.previewTruncated && <p className="muted small">{formatText(t.preview, item.sqlUnits)}</p>}<label className="inline-field">{t.choose}<select aria-label={formatText(t.connection, item.query.name)} value={target(item)} disabled={blocked} onChange={event => draft(() => setTargets(current => new Map(current).set(item.query.id, event.target.value)))}><option value="">{t.choose}</option>{connections.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label>
          <footer><span className="muted small">{new Date(item.query.updatedAt).toLocaleString('zh-CN')}</span><span className="grow"/><button disabled={blocked || changed || needsRefresh} onClick={() => beginRename(item)}>{renameText.rename}</button><button className="icon-button" disabled={blocked} title={zh.activity.text009} aria-label={zh.activity.text009} onClick={() => remove(item)}><Trash2 size={14}/></button><button disabled={blocked || changed || needsRefresh || !insertAvailable} onClick={() => insert(item)}>{insertionText.insert}</button><button disabled={blocked || !target(item)} onClick={() => open(item)}>{zh.activity.text010}<ArrowUpRight size={14}/></button></footer>
        </article>)}{reply && !reply.items.length && <Empty title={t.empty} text={t.emptyHint}/>}</div>
        {reply?.failures.length ? <details><summary>{t.failures} ({reply.failures.length})</summary>{reply.failures.map((failure, index) => <p key={index}>{failure.id}：{failure.message}</p>)}</details> : null}
      </div>
    </div>{deleting && <SavedQueryDeleteSelectedPreview key={deleting.epoch} items={deleting.items} busy={busy || closing} onCancel={() => cancelDeleteSelected(deleting)} onConfirm={() => applyDeleteSelected(deleting)}/>}{renaming && <SavedQueryRenameEditor key={renaming.epoch} origin={renaming.source} busy={busy || closing} onCancel={() => cancelRename(renaming)} onConfirm={name => applyRename(name, renaming)}/ >}{editing && <SavedQueryOrganizationEditor snapshot={editing.snapshot} edit={editing.value} selected={editing.selected} busy={busy || closing} onCancel={cancelEdit} onConfirm={preview => apply(preview, editing)}/>}</div>
    <footer className="modal-footer"><button disabled={blocked} onClick={() => void load()}>{t.refresh}</button><button disabled={blocked || needsRefresh || !reply?.cursor || changed} onClick={() => void load(true)}>{t.next}</button>{busy && <button disabled={closing || !active.current} onClick={() => { if (active.current) void io.request('query.cancel', { taskId: active.current }).catch(reason => setError(errorMessage(reason))); }}>{t.cancel}</button>}<span className="grow"/><button disabled={closing} onClick={() => void close()}>{zh.common.close}</button></footer>
  </Modal>;
}
