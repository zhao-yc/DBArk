import type { MenuItemConstructorOptions } from 'electron';
import { uiMenuStateSchema, type UiCommandId, type UiCommandInvocation, type UiMenuState } from '../shared/uiCommands';
import { uiCommandLabels as labels, uiMenuLabels as text } from '../shared/uiCommands.zh-CN';

export interface ApplicationMenuPort {
  replace(template: MenuItemConstructorOptions[]): void;
  send(invocation: UiCommandInvocation): void;
  available(): boolean;
}

/** 开发入口可能省略根路径斜杠；只统一URL规范形式，不放宽来源、路径或查询参数。 */
export function isApplicationMenuDocument(observed: string, configured: string): boolean {
  try { return new URL(observed).href === new URL(configured).href; } catch { return false; }
}

/** 原生菜单只消费当前文档的状态快照；旧菜单闭包不能在上下文或文档变化后复活。 */
export class ApplicationMenu {
  private state: UiMenuState | undefined;
  private epoch: object = {};

  constructor(private readonly platform: string, private readonly port: ApplicationMenuPort) { this.render(); }

  /** 同一文档修订必须单调推进；重复或乱序状态不能把旧可用条件重新发布。 */
  update(input: UiMenuState): void {
    const next = uiMenuStateSchema.parse(input);
    if (this.state && next.revision <= this.state.revision) throw Error('菜单状态已过期');
    this.state = next;
    this.render();
  }

  /** 重导航、页面崩溃及退出立即撤销所有用户命令，不依赖旧页面继续发送状态。 */
  invalidate(): void { this.state = undefined; this.epoch = {}; this.render(); }

  /** 模板使用固定分类和白名单，动态状态仅影响可用及选中标志。 */
  private render(): void {
    const state = this.state, epoch = this.epoch;
    const statuses = new Map(state?.commands.map(command => [command.id, command]));
    const mac = this.platform === 'darwin';
    const separator: MenuItemConstructorOptions = { type: 'separator' };
    const item = (id: UiCommandId, accelerator?: string): MenuItemConstructorOptions => {
      const status = statuses.get(id), checkbox = id === 'focus-mode' || id === 'editor-word-wrap';
      return {
        id, label: id === 'favorite-toggle' ? status?.checked ? text.removeFavorite : text.addFavorite : labels[id], enabled: status?.enabled === true,
        ...(accelerator ? { accelerator } : {}), ...(checkbox ? { type: 'checkbox' as const, checked: status?.checked === true } : {}),
        click: () => {
          if (!state || this.state !== state || this.epoch !== epoch || !this.port.available() || !statuses.get(id)?.enabled) return;
          this.port.send({ id, revision: state.revision });
        }
      };
    };
    const menu: MenuItemConstructorOptions[] = [
      ...(mac ? [{ label: 'DBArk', submenu: [item('about'), separator, { label: text.hide, role: 'hide' }, { label: text.hideOthers, role: 'hideOthers' }, { label: text.showAll, role: 'unhide' }, separator, { label: text.quit, role: 'quit' }] } as MenuItemConstructorOptions] : []),
      { label: text.file, submenu: [
        item('new-connection', 'CmdOrCtrl+Shift+N'), item('new-query', 'CmdOrCtrl+N'), separator,
        item('open-sql-file', 'CmdOrCtrl+O'), item('recent-sql-file'), item('save-query', 'CmdOrCtrl+S'), item('save-sql-file', 'CmdOrCtrl+Shift+S'), separator,
        item('connections-transfer'), item('connections-organize'), ...(!mac ? [separator, { label: text.quit, role: 'quit' } as MenuItemConstructorOptions] : [])
      ] },
      { label: text.edit, submenu: [
        { label: text.undo, role: 'undo' }, { label: text.redo, role: 'redo' }, separator,
        { label: text.cut, role: 'cut' }, { label: text.copy, role: 'copy' }, { label: text.paste, role: 'paste' }, { label: text.selectAll, role: 'selectAll' }, separator,
        item('find', 'CmdOrCtrl+F'), item('replace', mac ? 'Alt+Cmd+F' : 'Ctrl+H')
      ] },
      { label: text.view, submenu: [
        item('toggle-theme'), item('focus-mode', 'CmdOrCtrl+Shift+L'), separator,
        { label: text.zoomIn, role: 'zoomIn' }, { label: text.zoomOut, role: 'zoomOut' }, { label: text.resetZoom, role: 'resetZoom' }, { label: text.fullscreen, role: 'togglefullscreen' }, separator,
        { label: text.editor, submenu: [item('editor-font'), item('editor-word-wrap'), item('editor-indent')] }
      ] },
      { label: text.favorites, submenu: [item('favorite-toggle'), item('favorites-manage', 'CmdOrCtrl+Shift+B'), separator, item('object-link', 'CmdOrCtrl+Shift+O')] },
      { label: text.tools, submenu: [
        { label: text.query, submenu: [item('execute', 'CmdOrCtrl+Enter'), item('execute-current'), item('execute-all'), item('stop'), separator, item('format'), item('parameters'), item('explain'), item('analyze'), item('transaction-settings')] },
        { label: text.transfer, submenu: [item('import'), item('export')] }, separator,
        item('schema-compare'), item('structure-search', 'CmdOrCtrl+Shift+F'), item('server-monitor'),
        { label: text.snapshots, submenu: [item('explain-snapshot'), item('result-snapshot')] }, separator, item('task-center')
      ] },
      { label: text.window, submenu: [
        item('tab-search', 'CmdOrCtrl+Shift+A'), item('close-tab', 'CmdOrCtrl+W'), item('close-other-queries'), item('close-left-queries'), item('close-right-queries'), separator,
        item('previous-tab'), item('next-tab')
      ] },
      { label: text.help, submenu: [item('help'), item('shortcuts'), ...(!mac ? [separator, item('about')] : [])] }
    ];
    this.port.replace(menu);
  }
}
