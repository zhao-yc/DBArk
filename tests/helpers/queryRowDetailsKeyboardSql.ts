/** 仅为本片已生成的只读fixture准备单行键盘输入，不作为通用SQL格式化器。 */
export function prepareQueryRowDetailsKeyboardSql(source: string): string {
  if (!source.length || source.length > 8192) throw Error('整行详情键盘fixture超出输入预算');
  let quote = '', output = '', pendingSpace = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    // 不猜测NO_BACKSLASH_ESCAPES；当前fixture只用成对引号，真实数据换行由CHAR表达式生成。
    if (char === '\\') throw Error('整行详情键盘fixture不支持反斜线');
    if (quote) {
      if (char === '\r' || char === '\n') throw Error('整行详情键盘fixture不能包含引号内真实换行');
      output += char;
      if (char === quote) { if (next === quote) output += source[++index]; else quote = ''; }
      continue;
    }
    if (char === '#' || char === '-' && next === '-' || char === '/' && next === '*' || char === ';') throw Error('整行详情键盘fixture不支持注释或语句分隔符');
    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') { pendingSpace = output.length > 0; continue; }
    if (pendingSpace) { output += ' '; pendingSpace = false; }
    output += char;
    if (char === "'" || char === '"' || char === '`') quote = char;
  }
  if (quote || !/^SELECT\b/iu.test(output)) throw Error('整行详情键盘fixture必须是引号完整的SELECT');
  return output;
}
