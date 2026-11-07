import { signatureLexicalContext } from '../shared/completionLexical';
import { postgresSqlContentStart, splitPostgresSql } from '../shared/postgresSql';
import type { ConnectionProfile, SqlSnippet } from '../shared/contracts';
import { SNIPPET_LIMITS } from '../shared/snippets';
import { invoke } from './lib';
import { zh } from './locales/zh-CN';

/** 内置片段与片段库共用同一份正文。 */
export const snippetTemplates: SqlSnippet[] = [
  { id: 'builtin-select', name: zh.snippets.selectColumns, group: zh.snippets.builtin, description: zh.snippets.selectDescription, sql: 'SELECT `id`, `name`\nFROM `your_table`\nWHERE `id` > 0\nORDER BY `id`\nLIMIT 100;', updatedAt: '' },
  { id: 'builtin-count', name: zh.snippets.countName, group: zh.snippets.builtin, description: zh.snippets.countDescription, sql: 'SELECT `category`, COUNT(*) AS `record_count`\nFROM `your_table`\nGROUP BY `category`\nORDER BY `record_count` DESC;', updatedAt: '' },
  { id: 'builtin-explain', name: zh.snippets.explainName, group: zh.snippets.builtin, description: zh.snippets.explainDescription, sql: 'EXPLAIN\nSELECT *\nFROM `your_table`\nWHERE `id` = 1;', updatedAt: '' },
];

// 仅转换受控内置模板的标识符占位符；用户片段跨方言共享，正文绝不重写。
const postgresTemplates = snippetTemplates.map(item => ({ ...item, sql: item.sql.replaceAll('`', '"') }));
/** 方言模板使用稳定对象，模态重渲染后仍能识别只读的内置记录。 */
export function snippetTemplatesForDialect(dialect?: ConnectionProfile['dialect']): SqlSnippet[] {
  return dialect === 'postgresql' ? postgresTemplates : snippetTemplates;
}

/** 共享本窗口的单次本地读取；写入后的旧回包不能再次发布。 */
export function createSnippetCatalog(read: () => Promise<SqlSnippet[]>) {
  let pending: Promise<SqlSnippet[] | undefined> | undefined;
  return {
    list() {
      if (pending) return pending;
      const request: Promise<SqlSnippet[] | undefined> = read().then(rows => pending === request ? rows : undefined, () => {
        if (pending === request) pending = undefined;
        return undefined;
      });
      return pending = request;
    },
    invalidate() { pending = undefined; },
  };
}
export const snippetCatalog = createSnippetCatalog(() => invoke('snippets.list', {}));

/** 先用当前行提取名称前缀，避免每次按键都扫描完整文档。 */
export function snippetPrefix(beforeCursor: string): string | undefined {
  const value = /(?:^|;)[ \t]*([\p{L}_][\p{L}\p{N}_]*)$/u.exec(beforeCursor)?.[1];
  return value && value.length >= 2 && value.length <= SNIPPET_LIMITS.name ? value : undefined;
}

/** 只替换独立语句中的完整前缀，避免在注释、字符串或现有语句内部插入。 */
export function snippetAtStatementStart(source: string, offset: number, prefix: string, dialect: ConnectionProfile['dialect'], standardStrings?: boolean): boolean {
  if (dialect === 'postgresql') {
    if (source.length > 65_536 || !Number.isInteger(offset) || offset < prefix.length || offset > source.length ||
        /[A-Za-z_0-9$\u0080-\uFFFF]/.test(source[offset] ?? '')) return false;
    // 复用执行扫描器，不把 dollar 正文、嵌套注释或转义字符串中的分号误认成边界。
    // 离线没有会话模式时，两种字符串模式都必须确认原前缀是独立语句。
    return (standardStrings === undefined ? [true, false] : [standardStrings]).every(mode => {
      try {
        const before = source.slice(0, offset), statement = splitPostgresSql(before, mode).at(-1);
        if (!statement) return false;
        const start = statement.start + postgresSqlContentStart(statement.sql);
        return start === offset - prefix.length && source.slice(start, offset) === prefix && statement.end === offset;
      } catch { return false; }
    });
  }
  const context = signatureLexicalContext(source, offset, dialect);
  if (context.status !== 'ready' || context.tokens.length !== 1) return false;
  const [token] = context.tokens;
  return token.kind === 'word' && token.start === offset - prefix.length && token.end === offset && token.value === prefix;
}

/** 同名片段保留各自分组；最多返回 20 条，避免宽前缀展开整个片段库。 */
export function matchSnippetPrefix(rows: readonly SqlSnippet[], prefix: string, dialect: ConnectionProfile['dialect']): SqlSnippet[] {
  const needle = prefix.toLowerCase();
  const matches = [...rows, ...(dialect === 'sqlite' ? [] : snippetTemplatesForDialect(dialect))].filter(item => item.name.toLowerCase().startsWith(needle));
  return matches.sort((left, right) => Number(right.name.toLowerCase() === needle) - Number(left.name.toLowerCase() === needle)).slice(0, 20);
}
