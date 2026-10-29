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

/** 纯JSX接线夹具不连接原生命令桥；此端口不证明命令可用性或菜单交互。 */
export const navigationMenuVmPort = { useUiCommandScope() {} };

/** 仅遍历生产工具栏声明的原节点，断言继续执行节点中的原disabled和业务回调。 */
export function navigationToolbarVmChildren(node: { type: unknown; props: Record<string, any> }): unknown[] {
  return node.type === 'AdaptiveToolbar' ? [...(node.props.items ?? []).map((item: { content: unknown }) => item.content), node.props.more] : [];
}

type NavigationPort = { getByRole(role: 'button', options: unknown): { click(options?: unknown): Promise<unknown> } };

/** 仅供正式套件的纯VM注册/owner接线；真实更多与子菜单由Electron专项验证。 */
async function navigationMenuItem(scope: NavigationPort, options: unknown, assertCurrent?: () => void) {
  assertCurrent?.(); await Promise.resolve(); assertCurrent?.();
  const item = scope.getByRole('button', options); assertCurrent?.(); return item;
}

/** 原夹具的点击与资源门保持，不复制表单、SQL、认证或清理处理器。 */
async function clickNavigationAction(scope: NavigationPort, options: unknown, clickOptions?: unknown, assertCurrent?: () => void) {
  const item = await navigationMenuItem(scope, options, assertCurrent); assertCurrent?.();
  await item.click(clickOptions); assertCurrent?.();
}

export const navigationMenuRamPort = { navigationMenuItem, clickNavigationAction };
export const navigationMenuRegistrationPort = { navigationMenuItem: rejectRegistrationAction, clickNavigationAction: rejectRegistrationAction };
