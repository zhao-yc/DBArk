import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { emptyWorkbench, type WorkbenchDocument } from '../../src/shared/workbench';
const state = vi.hoisted(() => ({ connections: [] as ConnectionProfile[], document: {} as WorkbenchDocument }));
vi.mock('../../src/renderer/workbench', () => ({ useWorkbench: () => ({ ready: true, snapshot: { document: state.document } }) }));
vi.mock('../../src/renderer/store', () => ({ useWorkspace: (selector: (state: { connections: ConnectionProfile[] }) => unknown) => selector({ connections: state.connections }) }));
import { WorkbenchShelf } from '../../src/renderer/components/Workbench';

/** 实际组件渲染不含驱动或连接秘密，只注入两个同库同名目标的状态。 */
function profile(id: string, name: string, group: string, color: string): ConnectionProfile {
  return { id, name, group, color, dialect: 'mysql', host: '不会展示的主机', port: 1, user: '不会展示的账号' };
}
const render = () => renderToStaticMarkup(<WorkbenchShelf onOpen={async () => false}/>);
beforeEach(() => {
  state.connections = [profile('prod', '生产环境', '正式', '#ff0000'), profile('test', '测试环境', '测试', '#00ff00')];
  state.document = { ...emptyWorkbench(), favorites: state.connections.map(item => ({ id: item.id, label: 'users', groupId: null, target: { connectionId: item.id, database: 'app', kind: 'table', name: 'users' } })) };
});
describe('收藏侧栏持续展示完整来源', () => {
  it('同库同名收藏同时显示各连接环境、颜色及完整可访问身份', () => {
    const html = render(), buttons = html.match(/<button\b[^>]*>.*?<\/button>/g)!;
    expect(buttons).toHaveLength(2);
    for (const [index, name] of ['生产环境', '测试环境'].entries()) {
      expect(buttons[index]).toContain(name); expect(buttons[index]).toContain(`data-connection-id="${index ? 'test' : 'prod'}"`);
      expect(buttons[index]).toMatch(/aria-label="打开对象：users · .*\[(prod|test)\].*&quot;app&quot;\.&quot;users&quot;"/);
      expect(buttons[index]).toMatch(/title="打开对象：users · /);
    }
    expect(html).toContain('background-color:#ff0000'); expect(html).toContain('background-color:#00ff00');
    expect(html).not.toContain('不会展示'); expect(html).not.toContain('class="truncate"');
  });
  it('两个连接的名称与分组相同也用持久连接标识区分', () => {
    state.connections[1] = { ...state.connections[0], id: 'test' };
    const html = render(); expect(html).toContain('正式 / 生产环境 [prod]</span>'); expect(html).toContain('正式 / 生产环境 [test]</span>');
  });
  it('失效连接始终显示失效文字和原标识，并保留完整对象身份', () => {
    state.connections = []; const html = render();
    expect(html).toContain('原连接已失效 [prod]'); expect(html).toContain('原连接已失效 [test]');
    expect(html).toContain('&quot;app&quot;.&quot;users&quot;');
  });
});
