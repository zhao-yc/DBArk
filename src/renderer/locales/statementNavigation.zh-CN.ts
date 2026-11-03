import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';

export const statementNavigationZh = {
  entry: uiCommandLabels['statement-navigation'], title: '语句导航', group: '脚本导航', loading: '正在读取原脚本语句…',
  hint: '跳转或选中正文不会执行 SQL。分段按当前会话模式；执行当前语句仍使用原脚本。',
  noCurrent: '光标所在位置没有可选中的语句。',
  noPrevious: '光标前没有可跳转的语句。', noNext: '光标后没有可跳转的语句。',
  search: '搜索语句正文', empty: '没有匹配的语句。', total: (count: number) => `共 ${count} 条语句`,
  position: (index: number, line: number) => `第 ${index + 1} 条 · 第 ${line} 行`,
  select: '选中正文', refresh: '刷新语句导航', cancel: '取消读取', close: '关闭语句导航', previous: '上一页', next: '下一页', page: (page: number, pages: number) => `${page} / ${pages}`,
  reasons: {
    input: '脚本包含无效字符或导航输入无效。', budget: '脚本或语句数量超过导航预算，请缩小脚本。', mode: '当前模式不确定，无法确认一致的语句边界。',
    script: '无法确认完整脚本的语句边界，请检查引号、注释、分隔符或触发器正文。', context: '原会话状态尚未确认，请核对后刷新。',
    stale: '原查询、会话或连接已变化，请刷新语句导航。', worker: '语句扫描线程未完成，请刷新。', cancelled: '本次导航读取已取消。', disposed: '语句导航已关闭。',
    replaced: '已由新的导航读取替换。', timeout: '扫描超时，未保留不完整目录。', 'startup-timeout': '扫描线程启动超时，请刷新。',
  } as Record<string, string>, unavailable: '当前无法读取语句导航。',
} as const;
