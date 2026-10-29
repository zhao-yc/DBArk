/** 仅供纯VM注册及RAM接线测试；无Playwright导入，不启动窗口，也不证明真实Portal交互。 */
type RowPort = { getByRole(role: 'menuitem', options: unknown): { click(options?: unknown): Promise<unknown> } };

/** 用展示端口捕获原行及菜单项名称；各异步边界仍执行调用方原owner检查。 */
async function sidebarMenuItem(row: RowPort, options: unknown, assertCurrent?: () => void) {
  assertCurrent?.();
  // 内存端口只交付menuitem，不调用数据库动作；真实右键及Portal由Electron专项验证。
  await Promise.resolve();
  assertCurrent?.();
  const item = row.getByRole('menuitem', options);
  assertCurrent?.();
  return item;
}

/** 只委派原夹具的菜单点击回调，不另写业务、确认、请求门或资源清理逻辑。 */
async function clickSidebarAction(row: RowPort, options: unknown, clickOptions?: unknown, assertCurrent?: () => void) {
  const item = await sidebarMenuItem(row, options, assertCurrent);
  assertCurrent?.();
  await item.click(clickOptions);
  assertCurrent?.();
}

export const sidebarMenuRamPort = { sidebarMenuItem, clickSidebarAction };

/** 注册阶段一旦执行动作立即失败，确保列表/默认关闭用例不会被展示替身放行。 */
function rejectRegistrationAction(): never { throw Error('纯注册测试禁止执行对象树菜单动作'); }
export const sidebarMenuRegistrationPort = { sidebarMenuItem: rejectRegistrationAction, clickSidebarAction: rejectRegistrationAction };
