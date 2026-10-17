import { queryLayoutLimits, readQueryEditorHeight } from '../shared/queryLayout';
import { useWorkspace, type WorkspaceTab } from './store';
import { beginQueryLayoutLease } from './queryLayoutLease';

/** 与App的活动标签回退规则相同；缺旧activeTabId时仍允许实际显示的首个标签。 */
export function queryLayoutActiveTab(settings: { activeTabId?: string; tabs: { id: string }[] }): string | undefined {
  return settings.tabs.find(tab => tab.id === settings.activeTabId)?.id ?? settings.tabs[0]?.id;
}
/** 只绑定目标和连接代次；SQL、标题、来源的正常编辑不使布局写入携带旧快照。 */
export function queryLayoutTarget(tab: WorkspaceTab, connectionVersion: number): string {
  return JSON.stringify([tab.id, tab.kind, tab.connectionId, tab.database ?? null, tab.databaseContext ?? null, tab.table ?? null, connectionVersion]);
}
/** 每次实际提交从最新store合并本查询字段；监听同步关闭/切页/目标或偏好ABA。 */
export function beginWorkspaceQueryLayout(tab: WorkspaceTab, connectionVersion: number, alive: () => boolean, cancel: () => void) {
  const expected = queryLayoutTarget(tab, connectionVersion);
  return beginQueryLayoutLease({
    /** 每次重新核实际活动标签、目标、连接代次及存续；读取坏偏好只回退默认。 */
    read() {
      const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === tab.id);
      const key = current ? queryLayoutTarget(current, state.connectionVersions[current.connectionId] ?? 0) : '';
      return { state, key, value: readQueryEditorHeight(current?.queryEditorHeight), available: alive() && !!current && current.kind === 'query' && key === expected && queryLayoutActiveTab(state.settings) === current.id && state.connections.some(profile => profile.id === current.connectionId) && !document.querySelector('[role="dialog"]') };
    },
    subscribe: changed => useWorkspace.subscribe(changed),
    write(current, value) {
      // read/current与写入之间无await；只变高度，绝不拿pointerdown时的tabs还原新SQL或来源。
      current.updateSettings({ tabs: current.settings.tabs.map(item => item.id === tab.id ? { ...item, queryEditorHeight: value } : item) });
      return true;
    },
  }, { min: queryLayoutLimits.minEditorHeight, max: queryLayoutLimits.maxEditorHeight }, cancel);
}
