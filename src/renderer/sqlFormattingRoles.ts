import { MySQL } from 'dt-sql-parser/dist/parser/mysql/index';
import { MySqlParserListener } from 'dt-sql-parser/dist/lib/mysql/MySqlParserListener';
import { sqlFormattingZh as text } from './locales/sqlFormatting.zh-CN';

// 大写模式需要额外语法角色证明，预算小于原仅排版模式；不扩大原安全范围。
export const sqlKeywordRoleLimits = { sourceUnits: 32768, tokens: 2048 } as const;
/** 默认错误监听可能打印输入；复用项目现有静默MySQL解析方式。 */
class QuietFormattingMySQL extends MySQL {
  override createLexer(...args: Parameters<MySQL['createLexer']>) { return super.createLexer(args[0], args[1] ?? (() => {})); }
  override createParser(...args: Parameters<MySQL['createParser']>) { return super.createParser(args[0], args[1] ?? (() => {})); }
}

/** 词法keyword不代表语法角色：正式uid/函数名上下文覆盖列、表及显式/隐式别名。 */
export function sqlFormattingNameRanges(source: string): { start: number; end: number }[] {
  // 仅为角色解析构造等UTF16长度的ASCII投影；实际格式化和四模式token验证仍用原文。
  // 非ASCII名称仍是名称；引号/转义/注释分隔符不变，避免ANTLR码点索引与JS偏移混用。
  const projected = source.replace(/[^\x00-\x7f]/g, 'x'), parser = new QuietFormattingMySQL(); let invalid = false;
  const tree = parser.parse(projected, () => { invalid = true; });
  if (invalid || tree.EOF()?.symbol.start !== projected.length) throw Error(text.unsafe);
  const ranges: { start: number; end: number }[] = [];
  type NameContext = Parameters<NonNullable<MySqlParserListener['enterUid']>>[0];
  /** 只保留真实解析上下文的原跨度；缺失/越界一律拒绝，不从名称文本猜测位置。 */
  const add = (context: Pick<NameContext, 'start' | 'stop'>) => {
    const start = context.start?.start, stop = context.stop?.stop;
    if (start === undefined || stop === undefined || !Number.isSafeInteger(start) || !Number.isSafeInteger(stop) || start < 0 || stop < start || stop >= source.length) throw Error(text.unsafe);
    ranges.push({ start, end: stop + 1 });
  };
  const listener = Object.assign(new MySqlParserListener(), { visitErrorNode() { throw Error(text.unsafe); }, enterUid: add, enterDottedId: add, enterFunctionName: add, enterFunctionNameCreate: add, enterScalarFunctionName: add, enterFunctionNameBase: add });
  parser.listen(listener, tree);
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}
