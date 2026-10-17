import { editorIndentationLimits, readEditorInsertSpaces, readEditorTabSize } from '../shared/editorIndentation';
import { defaultEditorWordWrap, readEditorWordWrap } from '../shared/editorWordWrap';
import { editorFontLimits, readEditorFontSize } from '../shared/editorFont';
import { zh } from './locales/zh-CN';
import { create } from 'zustand';
import type { AppSettings, ConnectionProfile, TaskEvent, TaskRecord } from '../shared/contracts';
import { errorMessage, invoke, uid } from './lib';
import type { ConnectionSelection } from './connectionChanges';
import { completionServerFacts } from './completionServerFacts';

export type WorkspaceTab = AppSettings['tabs'][number];
const defaults: AppSettings = { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, dataTypeColors: false, editorFontSize: editorFontLimits.defaultSize, editorWordWrap: defaultEditorWordWrap, editorTabSize: editorIndentationLimits.defaultTabSize, editorInsertSpaces: editorIndentationLimits.defaultInsertSpaces, tabs: [] };
let busySequence = 0;
const busyOwners = new Map<string, number>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

interface WorkspaceState {
  ready: boolean; settings: AppSettings; connections: ConnectionProfile[]; tasks: TaskRecord[];
  notice?: { text: string; error: boolean }; selection?: ConnectionSelection; activeJobs: Record<string, boolean>; dirtyTabs: Record<string, boolean>; connectionVersions: Record<string, number>;
  tableLayoutDrafts: Record<string, boolean>; setTableLayoutDraft(id: string, dirty: boolean): void;
  initialize: () => Promise<void>; setConnections: (connections: ConnectionProfile[]) => void;
  invalidateConnection: (connectionId: string) => void;
  updateSettings: (update: Partial<AppSettings>) => void; openTab: (tab: Omit<WorkspaceTab, 'id'> & { id?: string }) => void;
  updateTab: (id: string, update: Partial<WorkspaceTab>) => void; closeTab: (id: string) => void;
  select: (selection: WorkspaceState['selection']) => void; notify: (text: string, error?: boolean) => void;
  setBusy: (id: string, busy: boolean) => void; setDirty: (id: string, dirty: boolean) => void;
  onTask: (event: TaskEvent) => void;
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
  ready: false, settings: defaults, connections: [], tasks: [], activeJobs: {}, dirtyTabs: {}, connectionVersions: {}, tableLayoutDrafts: {},
  /** 并行恢复本地配置、连接概要和任务记录；加载失败仍保留可显示错误的工作台。 */
  initialize: async () => {
    try {
      const [settings, connections, tasks] = await Promise.all([invoke('settings.get', {}), invoke('connections.list', {}), invoke('tasks.list', {})]);
      set({ settings: { ...defaults, ...settings, editorFontSize: readEditorFontSize(settings.editorFontSize), editorWordWrap: readEditorWordWrap(settings.editorWordWrap), editorTabSize: readEditorTabSize(settings.editorTabSize), editorInsertSpaces: readEditorInsertSpaces(settings.editorInsertSpaces) }, connections, tasks, ready: true });
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
  updateSettings: update => {
    const previous = get().settings, settings = { ...previous, ...update }; set({ settings });
    // 标签身份立即投递到主进程；正文仍防抖。相同IPC通道中该事实先于随后发起的导入确认，不能留下400ms空闲窗口。
    const identities = (value: AppSettings) => JSON.stringify(value.tabs.map(tab => [tab.id, tab.connectionId, tab.kind]));
    if (identities(previous) !== identities(settings)) { clearTimeout(saveTimer); saveTimer = undefined; void invoke('settings.save', settings).catch(error => get().notify(errorMessage(error), true)); }
    else persist(settings);
  },
  /** 相同数据表复用已有标签，SQL 查询始终新建独立标签和会话。 */
  openTab: candidate => {
    const current = get().settings;
    const existing = candidate.kind === 'table' ? current.tabs.find(tab => tab.kind === 'table' && tab.connectionId === candidate.connectionId && tab.database === candidate.database && tab.table === candidate.table) : undefined;
    if (existing) { get().updateSettings({ activeTabId: existing.id }); return; }
    const tab = { ...candidate, id: candidate.id ?? uid() };
    get().updateSettings({ tabs: [...current.tabs, tab], activeTabId: tab.id });
  },
  /** 按标签标识更新查询正文或标题，并把草稿纳入布局恢复状态。 */
  updateTab: (id, update) => get().updateSettings({ tabs: get().settings.tabs.map(tab => tab.id === id ? { ...tab, ...update } : tab) }),
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
    const previous = state.tasks.find(task => task.id === event.taskId);
    const task: TaskRecord = { id: event.taskId, kind: previous?.kind ?? zh.workspace.text001, startedAt: previous?.startedAt ?? new Date().toISOString(), ...previous, status: event.status, progress: event.progress, message: event.message };
    return { tasks: [task, ...state.tasks.filter(item => item.id !== event.taskId)].slice(0, 200) };
  })
}));

/** 主进程的退出握手负责保存；卸载时只清理定时器，禁止向已关闭的配置库再次写入。 */
window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); saveTimer = undefined; });
