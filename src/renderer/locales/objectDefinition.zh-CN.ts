import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';

export const objectDefinitionZh = {
  entry: uiCommandLabels['object-definition'], title: '对象结构',
  hint: '仅查看当前查询所引用对象的完整定义，不执行查询或修改事务。',
  loading: '正在解析并读取对象结构…', stopping: '正在等待读取和取消完成…',
  stop: '取消读取', close: '关闭', temporary: '当前会话临时对象', permanent: '数据库对象', schema: '数据库', table: '对象',
  stale: '原查询、会话或连接已变化，请关闭后重新打开。',
  busy: '当前查询已有操作，请等待原操作完成后重新打开。',
  cancelled: '已取消对象结构读取。',
  context: '当前会话模式或数据库未确认，无法准确读取对象结构。',
  blocked: '当前位置无法确定唯一的物理表或视图，请将光标移到对象名称后重新打开。',
  worker: '对象名称分析未完成，请关闭后重新打开。',
  failed: '对象完整定义读取失败，请核对连接及读取权限后重新打开。',
  invalid: '对象完整定义回包无效，请关闭后重新打开。',
} as const;
