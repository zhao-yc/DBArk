import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';

export const sqlSyntaxCheckZh = {
  entry: uiCommandLabels['syntax-check'], title: '本地语法检查', running: '正在检查当前脚本…',
  hint: '仅使用本地 MySQL 语法解析器，不执行 SQL。提示可能涉及解析器未覆盖的 MySQL／MariaDB 语法；没有提示也不代表对象、权限或服务器执行已通过。',
  clean: '本地解析器未发现语法问题。', empty: '没有可检查的 SQL 语句。', issues: '处本地语法提示', statements: '条语句',
  cancel: '取消检查', close: '关闭语法检查', recheck: '重新检查', position: (line: number, column: number) => `第 ${line} 行，第 ${column} 列`,
  issue: '请检查此处的关键字、标点或表达式。',
  issueMessages: { syntax: '请检查此处的关键字、标点或表达式。', incomplete: '语句尚未完整，请检查缺失的表达式、名称或括号。', 'unclosed-string': '字符串尚未闭合。', 'unclosed-identifier': '引用的标识符尚未闭合。', 'unclosed-comment': '块注释尚未闭合。' } as Record<string, string>,
  reasons: {
    stale: '原查询、会话或连接已变化，请重新检查。', cancelled: '本次检查已取消。', disposed: '本次检查已关闭。', replaced: '已由新的检查替换。',
    context: '原会话状态尚未确认，请核对连接后重新检查。', mode: 'SQL 模式不确定，无法给出一致的本地语法提示。',
    budget: '脚本或问题数量超过本地检查预算，请分段检查。', worker: '本地解析器没有完成检查，请重新检查。',
    timeout: '本地语法分析超时，未保留不完整提示。', 'startup-timeout': '本地解析器启动超时，未发送或保留不完整提示。',
    unsupported: '当前脚本包含尚不能可靠检查的语法或客户端指令。',
    input: '当前脚本包含无法无损解析的字符。', parser: '本地解析器未能完成这份脚本的检查。', position: '本地解析器无法确认问题在原文中的准确位置。',
    'dynamic-mode': '脚本包含 SQL 模式切换，无法按同一模式检查整份脚本。', 'executable-comment': '脚本包含执行或提示注释，请交由实际服务器核对。',
    'client-command': '脚本包含客户端命令，本地语法解析器不能代替客户端执行。', delimiter: 'DELIMITER 指令格式无法可靠识别，请先核对分隔符。',
  } as Record<string, string>,
  unavailable: '当前脚本无法由本地解析器可靠检查。',
} as const;
