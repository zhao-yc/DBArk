import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { ApplicationMenu } from '../../src/main/applicationMenu';
import { uiCommandIds, uiMenuStateSchema, type UiCommandInvocation } from '../../src/shared/uiCommands';
import { validateCommand } from '../../src/shared/validation';

/** 仅使用原生模板端口，无窗口、操作系统输入、数据库或剪贴板。 */
function fixture(platform = 'win32') {
  let template: MenuItemConstructorOptions[] = [], available = true;
  const sent: UiCommandInvocation[] = [];
  const menu = new ApplicationMenu(platform, { replace: value => { template = value; }, send: value => sent.push(value), available: () => available });
  const find = (id: string, entries = template): MenuItemConstructorOptions | undefined => {
    for (const entry of entries) {
      if (entry.id === id) return entry;
      if (Array.isArray(entry.submenu)) { const found = find(id, entry.submenu); if (found) return found; }
    }
  };
  return { menu, sent, find, current: () => template, setAvailable: (value: boolean) => { available = value; } };
}

describe('原生菜单状态与原文档命令归属', () => {
  it('Windows固定七类，Mac保留应用菜单和编辑/窗口系统角色，没有未完成功能占位', () => {
    const windows = fixture();
    expect(windows.current().map(item => item.label)).toEqual(['文件', '编辑', '查看', '收藏夹', '工具', '窗口', '帮助']);
    expect(fixture('darwin').current().map(item => item.label)).toEqual(['DBArk', '文件', '编辑', '查看', '收藏夹', '工具', '窗口', '帮助']);
    expect(windows.find('execute')?.enabled).toBe(false);
    expect(JSON.stringify(windows.current())).not.toMatch(/BI|自动运行|用户管理|模型|备份/);
    const edit = windows.current().find(item => item.label === '编辑')!.submenu as MenuItemConstructorOptions[];
    expect(edit.filter(item => item.role).map(item => item.role)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  });

  it('状态仅控制白名单项，缺项禁用并在发出时携带准确修订', () => {
    const { menu, find, sent } = fixture();
    menu.update({ revision: 4, commands: [{ id: 'execute', enabled: true }, { id: 'focus-mode', enabled: true, checked: true }] });
    expect(find('execute')?.enabled).toBe(true);
    expect(find('stop')?.enabled).toBe(false);
    expect(find('focus-mode')).toMatchObject({ enabled: true, checked: true, type: 'checkbox' });
    Reflect.apply(find('execute')!.click!, undefined, []);
    Reflect.apply(find('stop')!.click!, undefined, []);
    expect(sent).toEqual([{ id: 'execute', revision: 4 }]);
  });

  it('旧上下文、重导航后同值修订及退出均不能复活旧菜单动作', () => {
    const { menu, find, sent, setAvailable } = fixture();
    menu.update({ revision: 1, commands: [{ id: 'execute', enabled: true }] });
    const original = find('execute')!.click!;
    menu.update({ revision: 2, commands: [{ id: 'execute', enabled: true }] });
    Reflect.apply(original, undefined, []);
    expect(sent).toEqual([]);
    expect(() => menu.update({ revision: 1, commands: [] })).toThrow('过期');
    const beforeNavigation = find('execute')!.click!;
    menu.invalidate();
    expect(find('execute')!.enabled).toBe(false);
    menu.update({ revision: 2, commands: [{ id: 'execute', enabled: true }] });
    Reflect.apply(beforeNavigation, undefined, []);
    expect(sent).toEqual([]);
    setAvailable(false);
    Reflect.apply(find('execute')!.click!, undefined, []);
    expect(sent).toEqual([]);
    setAvailable(true);
    Reflect.apply(find('execute')!.click!, undefined, []);
    expect(sent).toEqual([{ id: 'execute', revision: 2 }]);
  });

  it('IPC拒绝未知命令、额外正文、重复项及非法修订，不携带数据库参数', () => {
    expect(new Set(uiCommandIds).size).toBe(uiCommandIds.length);
    expect(validateCommand('app.menuState', { revision: 0, commands: [] })).toEqual({ revision: 0, commands: [] });
    for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) expect(uiMenuStateSchema.safeParse({ revision, commands: [] }).success).toBe(false);
    for (const input of [
      { revision: 0, commands: [{ id: 'execute-unknown', enabled: true }] },
      { revision: 0, commands: [{ id: 'execute', enabled: true, sql: '不应交付' }] },
      { revision: 0, commands: [{ id: 'execute', enabled: true }, { id: 'execute', enabled: false }] },
      { revision: 0, commands: [], connectionId: '不可扩展' }
    ]) expect(() => validateCommand('app.menuState', input)).toThrow();
  });
});
