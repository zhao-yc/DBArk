import type { MenuItemConstructorOptions } from 'electron';
import { ApplicationMenu } from '../../src/main/applicationMenu';

/** 真实菜单状态机只把模板写入RAM；未登记接收页面，不提供用户命令执行能力。 */
export function applicationMenuRamPort() {
  const templates: MenuItemConstructorOptions[][] = [];
  const menu = new ApplicationMenu('win32', {
    replace: template => { templates.push(template); },
    available: () => false,
    send: () => { throw Error('本RAM夹具没有可接收用户命令的渲染页面'); }
  });
  return { menu, templates };
}
