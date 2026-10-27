/** 系统输入和底层端口异常均使用固定文案，不回显原始链接、命令行或凭据。 */
export const externalObjectUrisZh = {
  invalid: '系统对象链接格式无效或超过长度限制',
  multiple: '一次系统请求包含多个对象链接，未打开任何对象',
  changed: '页面、连接配置或对象打开意图已变化，请重新打开链接',
  closed: '客户端正在退出，不能接收对象链接',
  notReady: '对象链接接收页面尚未就绪',
  notResolved: '对象链接尚未完成核验，不能打开对象',
  alreadyResolved: '该对象链接已开始核验，不能重复执行',
  resolveFailed: '无法打开原连接中的对象，请检查连接配置、对象及访问权限',
} as const;
