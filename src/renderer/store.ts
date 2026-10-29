import { readSqlKeywordCase } from '../shared/sqlKeywordCase';
import { assertObjectBrowserTabs } from '../shared/objectBrowser';
import { editorIndentationLimits, readEditorInsertSpaces, readEditorTabSize } from '../shared/editorIndentation';
import { defaultEditorWordWrap, readEditorWordWrap } from '../shared/editorWordWrap';
import { editorFontLimits, readEditorFontSize } from '../shared/editorFont';
import { zh } from './locales/zh-CN';
import { create } from 'zustand';
import type { AppSettings, ConnectionProfile, TaskEvent, TaskRecord } from '../shared/contracts';
import { errorMessage, invoke, uid } from './lib';
import type { ConnectionSelection } from './connectionChanges';
import { completionServerFacts } from './completionServerFacts';
import { assertQueryFileSourceSettings, assertQueryFileSourceSql, sameQueryFileSource, type QueryFileSourceView } from '../shared/queryFileSources';
import type { QueryFileTaskState } from './queryFileTasks';
import { queryFilesZh } from './locales/queryFiles.zh-CN';
import { TabOrderRegistry, type TabOrderRef, type TabOrderMove } from './tabOrder';

export type WorkspaceTab = AppSettings['tabs'][number];
const defaults: AppSettings = { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, dataTypeColors: false, editorFontSize: editorFontLimits.defaultSize, editorWordWrap: defaultEditorWordWrap, editorTabSize: editorIndentationLimits.defaultTabSize, editorInsertSpaces: editorIndentationLimits.defaultInsertSpaces, tabs: [] };
let busySequence = 0;
const busyOwners = new Map<string, number>();
const queryFileOpenTargets = new WeakSet<WorkspaceTab>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const tabOrder = new TabOrderRegistry();

interface WorkspaceState {
  ready: boolean; settings: AppSettings; connections: ConnectionProfile[]; tasks: TaskRecord[];
  notice?: { text: string; error: boolean }; selection?: ConnectionSelection; activeJobs: Record<string, boolean>; dirtyTabs: Record<string, boolean>; connectionVersions: Record<string, number>;
  tableLayoutDrafts: Record<string, boolean>; setTableLayoutDraft(id: string, dirty: boolean): void;
  queryFileDirty: Record<string, boolean>; setQueryFileDirty(id: string, dirty: boolean, snapshot: WorkspaceTab): void;
  queryFileTasks: Record<string, QueryFileTaskState>; setQueryFileTask(task: QueryFileTaskState): void;
  queryFileOpenings: Record<string, QueryFileOpening>;
  initialize: () => Promise<void>; setConnections: (connections: ConnectionProfile[]) => void;
  invalidateConnection: (connectionId: string) => void;
  updateSettings: (update: Partial<AppSettings>) => void; openTab: (tab: Omit<WorkspaceTab, 'id'> & { id?: string }) => void;
  updateTab: (id: string, update: Partial<WorkspaceTab>) => void; closeTab: (id: string) => void;
  tabOrderSnapshot(): readonly TabOrderRef[]; resolveTabOrder(ref: TabOrderRef): WorkspaceTab | undefined; moveTab(ref: TabOrderRef, move: TabOrderMove): boolean;
  select: (selection: WorkspaceState['selection']) => void; notify: (text: string, error?: boolean) => void;
  setBusy: (id: string, busy: boolean) => void; setDirty: (id: string, dirty: boolean) => void;
  onTask: (event: TaskEvent) => void;
}

/** 仅本次打开持有的内存身份；不会进入settings、SQLite或文件来源合同。 */
interface QueryFileOpening { readonly target: WorkspaceTab; readonly origin: WorkspaceTab; readonly connection: ConnectionProfile; readonly version: number; }
export interface QueryFileOpenLease { current(): boolean; apply(sql: string, binding: QueryFileSourceView): boolean; dispose(removeUnchanged?: boolean): void; }

/** 精确识别曾由文件操作登记的原占位对象；弱引用不持有文档，也不凭标题或空正文推断。 */
export function wasQueryFileOpenTarget(tab: WorkspaceTab): boolean { return queryFileOpenTargets.has(tab); }

/** 统一配置提交与原持久化顺序，允许文件打开阶段与标签在同一store通知中切换。 */
function commitWorkspaceSettings(update: Partial<AppSettings>, openings = useWorkspace.getState().queryFileOpenings): void {
  const state = useWorkspace.getState(), previous = state.settings, settings = { ...previous, ...update }, queryFileDirty = { ...state.queryFileDirty };
  try { tabOrder.observe(previous.tabs); } catch { /* 旧坏状态只撤销重排权限，仍允许原设置入口修复。 */ }
  assertObjectBrowserTabs(settings);
  assertQueryFileSourceSettings(settings);
  // SQL或修订变化先同步标dirty，再等待摘要确认；关闭/退出不能借用上一次正文的clean缓存。
  for (const tab of settings.tabs) {
    const before = previous.tabs.find(item => item.id === tab.id);
    if (tab.fileSourceBinding && (!before || (before.sql ?? '') !== (tab.sql ?? '') || !sameQueryFileSource(before.fileSourceBinding, tab.fileSourceBinding))) queryFileDirty[tab.id] = true;
    if (!tab.fileSourceBinding) delete queryFileDirty[tab.id];
  }
  for (const id of Object.keys(queryFileDirty)) if (!settings.tabs.some(tab => tab.id === id)) delete queryFileDirty[id];
  const fileDirtyUnchanged = Object.keys(queryFileDirty).length === Object.keys(state.queryFileDirty).length && Object.keys(queryFileDirty).every(id => queryFileDirty[id] === state.queryFileDirty[id]);
  useWorkspace.setState({ settings, queryFileDirty: fileDirtyUnchanged ? state.queryFileDirty : queryFileDirty, queryFileOpenings: openings });
  try { tabOrder.observe(settings.tabs); } catch { /* settings自身的校验保持原入口，重排不发布部分列表。 */ }
  // 标签身份立即投递；正文仍防抖，保持原settings.save通道及400毫秒合并规则。
  const identities = (value: AppSettings) => JSON.stringify(value.tabs.map(tab => [tab.id, tab.connectionId, tab.kind]));
  if (identities(previous) !== identities(settings)) { clearTimeout(saveTimer); saveTimer = undefined; void invoke('settings.save', settings).catch(error => useWorkspace.getState().notify(errorMessage(error), true)); }
  else persist(settings);
}

/** 新文件占位尚未创建编辑器；完整原文与来源就位后才一次解除，旧回包不能接管新文档。 */
export function beginQueryFileOpen(origin: WorkspaceTab, target: WorkspaceTab, ownsView: () => boolean): QueryFileOpenLease {
  const initial = useWorkspace.getState(), connection = initial.connections.find(item => item.id === origin.connectionId);
  if (!ownsView() || !connection || initial.settings.tabs.find(item => item.id === origin.id) !== origin || initial.settings.tabs.some(item => item.id === target.id) || initial.queryFileOpenings[target.id] || target.kind !== 'query' || target.sql !== '' || target.connectionId !== origin.connectionId || target.sourceBinding || target.fileSourceBinding) throw Error(queryFilesZh.changed);
  const opening: QueryFileOpening = Object.freeze({ target, origin, connection, version: initial.connectionVersions[origin.connectionId] ?? 0 });
  // 完成后仍可识别迟到的原占位props；完整新标签是另一个对象，不继承此标记。
  queryFileOpenTargets.add(target);
  let valid = true, pristine = true, settled = false;
  const context = (tab: WorkspaceTab) => JSON.stringify([tab.database ?? null, tab.databaseContext ?? null]);
  /** 观察每次实际通知，正文/标题可继续变化；来源、连接或目标离开后永久失效，防止ABA。 */
  const inspect = (state: WorkspaceState): boolean => {
    const current = state.settings.tabs.find(item => item.id === origin.id);
    if (state.queryFileOpenings[target.id] !== opening || state.settings.tabs.find(item => item.id === target.id) !== target || state.dirtyTabs[target.id]) pristine = false;
    if (!pristine || !ownsView() || !current || current.kind !== 'query' || current.connectionId !== origin.connectionId || current.sourceBinding !== origin.sourceBinding || !sameQueryFileSource(current.fileSourceBinding, origin.fileSourceBinding) || context(current) !== context(origin) || state.connections.find(item => item.id === connection.id) !== connection || (state.connectionVersions[connection.id] ?? 0) !== opening.version) valid = false;
    return valid && !settled;
  };
  const off = useWorkspace.subscribe(state => { inspect(state); });
  try { commitWorkspaceSettings({ tabs: [...initial.settings.tabs, target] }, { ...initial.queryFileOpenings, [target.id]: opening }); }
  catch (reason) { settled = true; off(); const state = useWorkspace.getState(); if (state.queryFileOpenings[target.id] === opening) { const next = { ...state.queryFileOpenings }; delete next[target.id]; useWorkspace.setState({ queryFileOpenings: next }); } throw reason; }
  return {
    /** 每次读取复核并保留失效墓碑；恢复同值不能重新领取原权限。 */
    current: () => inspect(useWorkspace.getState()),
    /** 消费一次原文回包；正文、来源和首次模型阶段必须同一次提交。 */
    apply(sql, binding) {
      if (!inspect(useWorkspace.getState())) return false;
      assertQueryFileSourceSql(sql);
      const state = useWorkspace.getState(), openings = { ...state.queryFileOpenings }; delete openings[target.id];
      const loaded = { ...target, sql, title: binding.name, fileSourceBinding: binding.ref };
      assertQueryFileSourceSettings({ tabs: [loaded] });
      settled = true; off();
      commitWorkspaceSettings({ tabs: state.settings.tabs.map(item => item === target ? loaded : item), activeTabId: target.id }, openings);
      return true;
    },
    /** 仅解除本owner阶段，且只有从未改变的目标才保留删除资格。 */
    dispose(removeUnchanged = false) {
      inspect(useWorkspace.getState());
      // 来源失效仍可移除本操作从未改变的空占位；目标曾离开/改动则永久失去删除权。
      const remove = removeUnchanged && pristine && !settled; settled = true; off();
      const state = useWorkspace.getState(); if (state.queryFileOpenings[target.id] !== opening) return;
      const openings = { ...state.queryFileOpenings }; delete openings[target.id];
      if (remove) {
        const index = state.settings.tabs.indexOf(target), tabs = state.settings.tabs.filter(item => item !== target);
        commitWorkspaceSettings({ tabs, activeTabId: state.settings.activeTabId === target.id ? tabs[Math.max(0, index - 1)]?.id : state.settings.activeTabId }, openings);
      } else useWorkspace.setState({ queryFileOpenings: openings });
    }
  };
}

/** 合并连续编辑再保存，避免 SQL 输入每个字符都触发磁盘写入。 */
function persist(settings: AppSettings) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void invoke('settings.save', settings).catch(error => useWorkspace.getState().notify(errorMessage(error), true)), 400);
}

export interface WorkspaceBusyLease { owns(): boolean; release(): boolean; }
/** 标签作业采用内存世代；新占用使旧释放失效，布尔持久布局不增加字段。 */
export function acquireWorkspaceBusy(id: string): WorkspaceBusyLease {
  if (useWorkspace.getState().activeJobs[id]) throw Error('标签已有活动作业，未取得作业占用');
  useWorkspace.getState().setBusy(id, true);
  const owner = busyOwners.get(id); let active = true;
  const owns = () => active && busyOwners.get(id) === owner && useWorkspace.getState().activeJobs[id] === true;
  return { owns, release() { const current = owns(); active = false; if (current) useWorkspace.getState().setBusy(id, false); return current; } };
}

/** 退出握手先取消防抖写入，再保存当前快照；错误必须传回调用方，不重试也不吞掉。 */
export async function flushSettings(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  await invoke('settings.save', useWorkspace.getState().settings);
}

/** 界面状态仅保存连接概要和工作区配置，数据库密码不进入全局界面存储。 */
export const useWorkspace = create<WorkspaceState>((set, get) => ({
  ready: false, settings: defaults, connections: [], tasks: [], activeJobs: {}, dirtyTabs: {}, connectionVersions: {}, tableLayoutDrafts: {}, queryFileDirty: {}, queryFileTasks: {}, queryFileOpenings: {},
  /** 文件任务保留进度合同与取消状态，不保存SQL或路径；终态由真实文件结果推进。 */
  setQueryFileTask: task => set(state => {
    const previous = state.tasks.find(item => item.id === task.taskId), record: TaskRecord = { id: task.taskId, kind: queryFilesZh.taskTitle, status: task.status, progress: task.progress, message: task.message, startedAt: previous?.startedAt ?? task.startedAt };
    const tasks = [record, ...state.tasks.filter(item => item.id !== task.taskId)].slice(0, 200), queryFileTasks = { ...state.queryFileTasks, [task.taskId]: task };
    for (const id of Object.keys(queryFileTasks)) if (!tasks.some(item => item.id === id) && !queryFileTasks[id].running) delete queryFileTasks[id];
    return { tasks, queryFileTasks };
  }),
  /** 文件正文dirty与事务dirty独立，未知摘要也保持dirty；该缓存不持久化。 */
  setQueryFileDirty: (id, dirty, snapshot) => {
    const current = get().settings.tabs.find(tab => tab.id === id);
    if (!current || (current.sql ?? '') !== (snapshot.sql ?? '') || !sameQueryFileSource(current.fileSourceBinding, snapshot.fileSourceBinding)) return;
    set(state => ({ queryFileDirty: { ...state.queryFileDirty, [id]: dirty } }));
  },
  /** 并行恢复本地配置、连接概要和任务记录；加载失败仍保留可显示错误的工作台。 */
  initialize: async () => {
    try {
      const [settings, connections, tasks] = await Promise.all([invoke('settings.get', {}), invoke('connections.list', {}), invoke('tasks.list', {})]);
      tabOrder.reset();
      set({ settings: { ...defaults, ...settings, editorFontSize: readEditorFontSize(settings.editorFontSize), editorWordWrap: readEditorWordWrap(settings.editorWordWrap), editorTabSize: readEditorTabSize(settings.editorTabSize), editorInsertSpaces: readEditorInsertSpaces(settings.editorInsertSpaces), ...(Object.hasOwn(settings, 'sqlKeywordCase') ? { sqlKeywordCase: readSqlKeywordCase(settings.sqlKeywordCase) } : {}) }, connections, tasks, ready: true });
    } catch (error) { set({ ready: true }); get().notify(errorMessage(error), true); }
  },
  /** 连接编辑成功后整体替换概要列表，不缓存表单中的明文秘密。 */
  setConnections: connections => {const ids=new Set(connections.map(connection=>connection.id));for(const previous of get().connections)if(!ids.has(previous.id))completionServerFacts.clear(previous.id);set({ connections });},
  /** 连接目标保存变更后只清理其对象树和数据库选择，不动其它连接、查询标签、任务或事务标记。 */
  invalidateConnection: connectionId => {completionServerFacts.clear(connectionId);set(state => ({
    connectionVersions: { ...state.connectionVersions, [connectionId]: (state.connectionVersions[connectionId] ?? 0) + 1 },
    selection: state.selection?.connectionId === connectionId ? { connectionId } : state.selection
  }));},
  /** 合并并立即展示配置修改，由持久化层合并连续写盘请求。 */
  updateSettings: update => commitWorkspaceSettings(update),
  /** 表页与每库对象目录各自复用；SQL查询始终保持独立标签和会话。 */
  openTab: candidate => {
    const current = get().settings;
    const existing = candidate.kind === 'table' ? current.tabs.find(tab => tab.kind === 'table' && tab.connectionId === candidate.connectionId && tab.database === candidate.database && tab.table === candidate.table)
      : candidate.kind === 'objects' ? current.tabs.find(tab => tab.kind === 'objects' && tab.connectionId === candidate.connectionId && tab.database === candidate.database) : undefined;
    if (existing && candidate.kind === 'objects') { get().updateTab(existing.id, { objectCategory: candidate.objectCategory }); get().updateSettings({ activeTabId: existing.id }); return; }
    if (existing) { get().updateSettings({ activeTabId: existing.id }); return; }
    const tab = { ...candidate, id: candidate.id ?? uid() };
    get().updateSettings({ tabs: [...current.tabs, tab], activeTabId: tab.id });
  },
  /** 按标签标识更新查询正文或标题，并把草稿纳入布局恢复状态。 */
  updateTab: (id, update) => {
    const current = get().settings.tabs; try { tabOrder.observe(current); } catch { /* 泛设置仍能修复坏状态，但不能继承旧重排权限。 */ }
    const releases: Array<() => void> = [];
    const tabs = current.map(tab => { if (tab.id !== id) return tab; const next = { ...tab, ...update }; try { releases.push(tabOrder.continueUpdate(tab, next)); } catch { /* 换绑或无效目标不继承文档令牌。 */ } return next; });
    try { commitWorkspaceSettings({ tabs }); } finally { for (const release of releases) release(); }
  },
  /** 只投影内存身份，旧事件提交时仍须重新解析同一个live标签对象。 */
  tabOrderSnapshot: () => tabOrder.snapshot(get().settings.tabs),
  resolveTabOrder: ref => tabOrder.resolve(ref, get().settings.tabs),
  /** 顺序变化沿原400毫秒/标签身份持久化通道，绝不携带旧settings或改变活动标签。 */
  moveTab: (ref, move) => { const tabs = tabOrder.move(ref, move, get().settings.tabs); if (!tabs) return false; commitWorkspaceSettings({ tabs }); return true; },
  /** 调用方完成任务和草稿确认后删除标签，当前标签关闭时激活邻近标签。 */
  closeTab: id => {
    const settings = get().settings; const index = settings.tabs.findIndex(tab => tab.id === id); const tabs = settings.tabs.filter(tab => tab.id !== id);
    get().updateSettings({ tabs, activeTabId: settings.activeTabId === id ? tabs[Math.max(0, index - 1)]?.id : settings.activeTabId });
    get().setDirty(id, false);
  },
  /** 记录对象树当前上下文，供新建查询等操作使用。 */
  select: selection => set({ selection }),
  /** 成功与错误共用通知入口，错误通知由用户手动关闭。 */
  notify: (text, error = false) => set({ notice: { text, error } }),
  /** 标记标签是否有活动操作，防止运行期间关闭其会话。 */
  setBusy: (id, busy) => { if (busy) busyOwners.set(id, ++busySequence); else busyOwners.delete(id); set(state => ({ activeJobs: { ...state.activeJobs, [id]: busy } })); },
  /** 标记未提交数据或事务，供标签关闭及应用退出确认使用。 */
  setDirty: (id, dirty) => set(state => ({ dirtyTabs: { ...state.dirtyTabs, [id]: dirty } })),
  /** 列布局草稿独立于数据写入状态；重命名关闭旧标签前也必须检查隐藏页。 */
  setTableLayoutDraft: (id, dirty) => set(state => ({ tableLayoutDrafts: { ...state.tableLayoutDrafts, [id]: dirty } })),
  /** 仅保留任务概要，不把查询数据批次复制进全局任务历史。 */
  onTask: event => set(state => {
    // 已终态的文件任务不被迟到事件复活或改写；原RPC仍可通过专用收尾发布真实事实。
    if (state.queryFileTasks[event.taskId]?.running === false) return {};
    const previous = state.tasks.find(task => task.id === event.taskId);
    const task: TaskRecord = { id: event.taskId, kind: previous?.kind ?? (event.queryFileSource ? queryFilesZh.taskTitle : zh.workspace.text001), startedAt: previous?.startedAt ?? new Date().toISOString(), ...previous, status: event.status, progress: event.progress, message: event.queryFileSource ? queryFilesZh.taskPhases[event.queryFileSource.phase] : event.message };
    const value = event.queryFileSource, queryFileTasks = { ...state.queryFileTasks };
    // 未持有本窗口操作租约的文件事件也明确分类，但不能借普通SQL取消命令获取取消权。
    if (value) queryFileTasks[event.taskId] = { taskId: event.taskId, tabId: value.tabId, operation: value.operation, phase: value.phase, bytesProcessed: value.bytesProcessed, ...(value.totalBytes === undefined ? {} : { totalBytes: value.totalBytes }), wrote: value.wrote, cancellable: false, running: event.status === 'running', committed: value.wrote !== 'no' || ['replacing', 'verifying', 'recording'].includes(value.phase), cancelState: 'denied', status: event.status, progress: event.progress, message: task.message, startedAt: task.startedAt };
    return { tasks: [task, ...state.tasks.filter(item => item.id !== event.taskId)].slice(0, 200), queryFileTasks };
  })
}));

// 包括直接setState在内的每次真实通知都记录删除/换绑ABA；异常仅撤销重排权限，不影响其它store订阅。
useWorkspace.subscribe(state => { try { tabOrder.observe(state.settings.tabs); } catch { /* registry已清空旧令牌，下一次snapshot会报告整组错误。 */ } });

/** 主进程的退出握手负责保存；卸载时只清理定时器，禁止向已关闭的配置库再次写入。 */
window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); saveTimer = undefined; });
