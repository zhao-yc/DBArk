export const queryResultTitlePrefixLimit = 4096;
const titleLimit = 80;

/** 结果标题只允许有限的单行纯文本，可用于验证内部回执。 */
export function validQueryResultTitle(title: unknown): title is string {
  return typeof title === 'string' && title.length > 0 && title.length <= titleLimit && !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\p{Bidi_Control}]/u.test(title);
}

/** 只检查语句头的普通注释。返回纯文本标题，不改动执行语句或按编辑器草稿猜测。 */
export function queryResultTitle(statement: string, sqlite = false): string | undefined {
  const prefix = statement.slice(0, queryResultTitlePrefixLimit);
  let offset = 0;
  while (offset < prefix.length) {
    if (/[\t\n\f\r \uFEFF]/.test(prefix[offset])) { offset++; continue; }
    const block = prefix.startsWith('/*', offset);
    const dash = prefix.startsWith('--', offset) && (sqlite || /[\x00-\x20\x7f]/.test(prefix[offset + 2] ?? ' '));
    const hash = !sqlite && prefix[offset] === '#';
    if (!block && !dash && !hash) return undefined;
    // MySQL／MariaDB 执行注释与优化器提示不是普通注释，不能用来跳过语句正文。
    if (block && !sqlite && /^(?:!|[mM]!|\+)/.test(prefix.slice(offset + 2, offset + 4))) return undefined;
    const start = offset + (hash ? 1 : 2);
    const end = prefix.indexOf(block ? '*/' : '\n', start);
    if (end < 0 && (block || statement.length > prefix.length)) return undefined;
    const comment = prefix.slice(start, end < 0 ? prefix.length : end);
    const marker = hash ? null : /^[ \t]*name:[ \t]*/i.exec(comment);
    if (marker) {
      const title = comment.slice(marker[0].length).replace(/[ \t\r]+$/, '');
      return validQueryResultTitle(title) ? title : undefined;
    }
    offset = end < 0 ? prefix.length : end + (block ? 2 : 1);
  }
  return undefined;
}
