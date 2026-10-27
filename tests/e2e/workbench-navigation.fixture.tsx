import { useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DesktopApi } from '../../src/shared/contracts';
import type { WorkbenchTarget } from '../../src/shared/workbench';
import { WorkbenchDialog, WorkbenchShelf, ObjectLinkDialog } from '../../src/renderer/components/Workbench';
import { createWorkbenchNavigation } from '../../src/renderer/workbenchNavigation';
import { useWorkspace } from '../../src/renderer/store';
import { useWorkbench } from '../../src/renderer/workbench';
import '../../src/renderer/styles.css';
import '../../src/renderer/workbench.css';

interface Pending { target: WorkbenchTarget; resolve(target: WorkbenchTarget): void; }
const pending = new Map<number, Pending>(); let next = 0;
const connections = [
  { id: 'production', name: '生产环境', group: '正式', color: '#e14b4b' },
  { id: 'testing', name: '测试环境', group: '开发', color: '#3c9d65' }
].map(profile => ({ ...profile, dialect: 'mysql' as const, host: '127.0.0.1', port: 1, user: 'offline' }));

// 只控制核验回包顺序；真实组件、导航代码及 Zustand 选择和标签更新均未替换。
window.dbark = {
  invoke: ((command: string, input: WorkbenchTarget) => {
    if (command === 'workbench.resolve') return new Promise<WorkbenchTarget>(resolve => { pending.set(++next, { target: input, resolve }); });
    if (command === 'settings.save') return Promise.resolve();
    return Promise.reject(Error('界面协议夹具遇到未预期的命令：' + command));
  }) as DesktopApi['invoke'], onTask: () => () => {}, onMenu: () => () => {},
  // 本夹具只挂载应用内导航组件，不接收系统通知；新的完整DesktopApi仍保留原拒绝未知命令门。
  onObjectUri: () => () => {}
};
useWorkspace.setState({ ready: true, connections });
useWorkbench.setState({ ready: true, snapshot: { revision: 0, document: { version: 1, focusMode: false, groups: [], favorites: connections.map(profile => ({ id: profile.id, label: 'users', groupId: null, target: { connectionId: profile.id, database: 'app', kind: 'table', name: 'users' } })) } } });

declare global {
  interface Window {
    workbenchNavigationFixture: {
      pending(): number[]; finish(id: number): void; unmount(): void; removeDialogs(): void;
      state(): { connection?: string; tabs: string[] };
    };
  }
}

/** 使用实际收藏与链接组件验证请求代次、关闭、组件卸载和应用卸载。 */
function Fixture() {
  const [dialog, setDialog] = useState<'favorites' | 'link' | null>(null), [definition, setDefinition] = useState('');
  const navigation = useMemo(() => createWorkbenchNavigation(value => setDefinition(value.connectionId)), []);
  useLayoutEffect(() => { navigation.activate(); return () => navigation.dispose(); }, [navigation]);
  const connection = useWorkspace(state => state.selection?.connectionId ?? '未选择');
  window.workbenchNavigationFixture.removeDialogs = () => setDialog(null);
  /** 与 App 一致，打开或关闭显式表单立即撤销原导航意图。 */
  function open(next: 'favorites' | 'link' | null) { navigation.invalidate(); setDialog(next); }
  return <div className="app"><div className="app-commandbar"><button onClick={() => open('favorites')}>收藏与虚拟分组</button><button onClick={() => open('link')}>粘贴对象链接</button></div><WorkbenchShelf onOpen={navigation.open}/><output aria-label="当前连接">{connection}</output><output aria-label="当前定义">{definition}</output>{dialog === 'favorites' && <WorkbenchDialog onOpen={navigation.open} onClose={() => open(null)}/>} {dialog === 'link' && <ObjectLinkDialog onOpen={navigation.open} onClose={() => open(null)}/>}</div>;
}
const root = createRoot(document.getElementById('root')!);
window.workbenchNavigationFixture = {
  pending: () => [...pending.keys()],
  finish(id) { const item = pending.get(id); if (!item) throw Error('请求不存在'); pending.delete(id); item.resolve(item.target); },
  unmount: () => root.unmount(), removeDialogs: () => {},
  state: () => ({ connection: useWorkspace.getState().selection?.connectionId, tabs: useWorkspace.getState().settings.tabs.map(tab => tab.connectionId) })
};
root.render(<Fixture/>);
