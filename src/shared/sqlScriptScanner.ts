/** 范围采用原文 UTF-16 半开区间；客户端分隔符不属于真正发送的 SQL。 */
export interface SqlStatementRange { sql: string; start: number; end: number; delimiterStart: number; delimiterEnd: number; delimiter: string | null; }
export interface SqlLocatedStatement { sql: string; sourceRange?: { start: number; end: number }; }

/** 支持跨块、跨行字符串与 DELIMITER 指令，导入脚本时只保留当前语句。 */
export class SqlScriptScanner {
  private pending = '';
  private statement = '';
  private delimiter = ';';
  private state: 'normal' | 'single' | 'double' | 'identifier' | 'block' = 'normal';
  private hasCode = false;
  private atLineStart = true;
  private alternates: SqlScriptScanner[] = [];
  private pendingOffset = 0;
  private statementOffset = 0;
  /** 使用当前会话的反斜线模式初始化扫描器，避免字符串边界判断错误。 */
  constructor(private noBackslashEscapes = false, private ansiQuotes = false, ansiQuotesKnown = true, noBackslashEscapesKnown = true) {
    if (!ansiQuotesKnown || !noBackslashEscapesKnown) this.setMode(noBackslashEscapes, ansiQuotes, ansiQuotesKnown, noBackslashEscapesKnown);
  }

  /** 未来定位范围不早于仍保留语句的起点；仅供流式文件释放源块，不改变扫描或返回合同。 */
  get retainedSourceOffset(): number { return Math.min(this.statementOffset, ...this.alternates.map(scanner => scanner.statementOffset)); }

  /** 仅在语句边界更新模式；尚未消费的尾部保留到读取下一条语句时再解释。 */
  setMode(noBackslashEscapes: boolean, ansiQuotes = false, ansiQuotesKnown = true, noBackslashEscapesKnown = true): void {
    if (this.hasCode || this.state !== 'normal') throw new Error('不能在 SQL 语句中途改变词法模式');
    this.noBackslashEscapes = noBackslashEscapesKnown ? noBackslashEscapes : false; this.ansiQuotes = ansiQuotesKnown ? ansiQuotes : false;
    this.alternates = [];
    for (const escapes of noBackslashEscapesKnown ? [noBackslashEscapes] : [false, true]) {
      for (const quotes of ansiQuotesKnown ? [ansiQuotes] : [false, true]) {
        if (escapes === this.noBackslashEscapes && quotes === this.ansiQuotes) continue;
        const alternate = new SqlScriptScanner(escapes, quotes);
        alternate.pending = this.pending; alternate.statement = this.statement; alternate.delimiter = this.delimiter;
        alternate.state = this.state; alternate.hasCode = this.hasCode; alternate.atLineStart = this.atLineStart;
        alternate.pendingOffset = this.pendingOffset; alternate.statementOffset = this.statementOffset;
        this.alternates.push(alternate);
      }
    }
  }

  /** 消费一个文本块；仅在 final 时接收末尾无分隔符语句并检查未闭合状态。 */
  push(chunk: string, final = false, maxStatements = Infinity): string[] {
    return this.scan(chunk, final, maxStatements, false).map(statement => statement.sql);
  }

  /** 与原脚本扫描共用词法状态；未知模式时连原文偏移也必须完全一致。 */
  pushRanges(chunk: string, final = false, maxStatements = Infinity): SqlStatementRange[] {
    return this.scan(chunk, final, maxStatements, true);
  }

  /** 执行仍只要求原push的SQL文字一致；原文位置有歧义时省略范围，绝不强化成新的执行拒绝。 */
  pushLocated(chunk: string, final = false, maxStatements = Infinity): SqlLocatedStatement[] {
    const located = (range: SqlStatementRange): SqlLocatedStatement => ({ sql: range.sql, sourceRange: { start: range.start, end: range.end } });
    if (!this.alternates.length) return this.consume(chunk, final, maxStatements).map(located);
    try {
      const result = this.consume(chunk, final, maxStatements), output = result.map(located);
      const text = JSON.stringify(result.map(range => range.sql));
      for (const alternate of this.alternates) {
        const candidate = alternate.consume(chunk, final, maxStatements);
        if (text !== JSON.stringify(candidate.map(range => range.sql))) throw new Error('语句边界不同');
        for (let index = 0; index < result.length; index++) if (candidate[index].start !== result[index].start || candidate[index].end !== result[index].end) delete output[index].sourceRange;
      }
      return output;
    } catch { throw new Error('无法确定会话 SQL 引号模式，当前 SQL 的语句边界存在歧义；请关闭此标签并新建查询重新连接'); }
  }

  /** 原 push 仍比较实际 SQL；范围入口额外拒绝“文字相同但所在位置不同”的歧义。 */
  private scan(chunk: string, final: boolean, maxStatements: number, compareRanges: boolean): SqlStatementRange[] {
    if (!this.alternates.length) return this.consume(chunk, final, maxStatements);
    try {
      const result = this.consume(chunk, final, maxStatements);
      const comparable = (ranges: SqlStatementRange[]) => JSON.stringify(compareRanges ? ranges : ranges.map(range => range.sql));
      for (const alternate of this.alternates) if (comparable(result) !== comparable(alternate.consume(chunk, final, maxStatements))) throw new Error('语句边界不同');
      return result;
    } catch { throw new Error('无法确定会话 SQL 引号模式，当前 SQL 的语句边界存在歧义；请关闭此标签并新建查询重新连接'); }
  }

  /** 不确定模式时两个扫描状态分别保留跨块上下文，只有边界一致的完整语句才能交给服务器。 */
  private consume(chunk: string, final: boolean, maxStatements: number): SqlStatementRange[] {
    if (maxStatements < 1) throw new Error('每次至少允许取出一条 SQL');
    this.pending += chunk;
    const statements: SqlStatementRange[] = [];
    let lineEnd: number;
    while ((lineEnd = this.pending.indexOf('\n')) >= 0 || (final && this.pending.length)) {
      const length = lineEnd >= 0 ? lineEnd + 1 : this.pending.length;
      const consumed = this.line(this.pending.slice(0, length), statements, maxStatements);
      this.atLineStart = consumed === length && this.pending[consumed - 1] === '\n';
      this.pending = this.pending.slice(consumed);
      this.pendingOffset += consumed;
      if (statements.length >= maxStatements) return statements;
    }
    if (final) {
      if (this.state !== 'normal') throw new Error('SQL 脚本中存在未闭合的引号或注释');
      if (this.statement.length > 64 * 1024 * 1024) throw new Error('单条 SQL 不能超过 64 MiB');
      this.emitStatement(statements, this.pendingOffset, this.pendingOffset, null);
      this.statement = '';
      this.hasCode = false;
      this.statementOffset = this.pendingOffset;
    }
    if (this.statement.length + this.pending.length > 64 * 1024 * 1024) throw new Error('单条 SQL 不能超过 64 MiB');
    return statements;
  }

  /** 语句只做首尾 trim，正文始终是源文本的连续切片，不用 indexOf 猜重复 SQL 的位置。 */
  private emitStatement(output: SqlStatementRange[], delimiterStart: number, delimiterEnd: number, delimiter: string | null): void {
    if (!this.hasCode) return;
    const sql = this.statement.trim(), start = this.statementOffset + this.statement.length - this.statement.trimStart().length;
    output.push({ sql, start, end: start + sql.length, delimiterStart, delimiterEnd, delimiter });
  }

  /** 按行识别客户端 DELIMITER 指令，字符串和注释内的分隔符不结束语句。 */
  private line(line: string, output: SqlStatementRange[], maxStatements: number): number {
    const directive = this.atLineStart && this.state === 'normal' && !this.hasCode ? /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line) : null;
    if (directive) {
      if (directive[1].length > 16 || /["'`\\]/.test(directive[1])) throw new Error('DELIMITER 必须是至多 16 个字符的非引号分隔符');
      this.delimiter = directive[1];
      this.statement = '';
      this.statementOffset = this.pendingOffset + line.length;
      return line.length;
    }
    for (let i = 0; i < line.length; i++) {
      const char = line[i], next = line[i + 1];
      if (this.state === 'block') {
        this.statement += char;
        if (char === '*' && next === '/') { this.statement += next; i++; this.state = 'normal'; }
        continue;
      }
      if (this.state !== 'normal') {
        this.statement += char;
        const quote = this.state === 'single' ? "'" : this.state === 'double' ? '"' : '`';
        if (char === '\\' && !this.noBackslashEscapes && this.state !== 'identifier' && !(this.state === 'double' && this.ansiQuotes)) { if (next !== undefined) { this.statement += next; i++; } }
        else if (char === quote) {
          if (next === quote) { this.statement += next; i++; }
          else this.state = 'normal';
        }
        continue;
      }
      if (line.startsWith(this.delimiter, i)) {
        if (this.statement.length > 64 * 1024 * 1024) throw new Error('单条 SQL 不能超过 64 MiB');
        this.emitStatement(output, this.pendingOffset + i, this.pendingOffset + i + this.delimiter.length, this.delimiter);
        this.statement = ''; this.hasCode = false; i += this.delimiter.length - 1;
        this.statementOffset = this.pendingOffset + i + 1;
        if (output.length >= maxStatements) return i + 1;
        continue;
      }
      if (char === '#' || (char === '-' && next === '-' && /[\x00-\x20\x7f]/.test(line[i + 2] ?? ' '))) { this.statement += line.slice(i); return line.length; }
      if (char === '/' && next === '*') {
        if (line[i + 2] === '!' || line.slice(i + 2, i + 4) === 'M!') this.hasCode = true;
        this.statement += '/*'; i++; this.state = 'block'; continue;
      }
      if (char === "'") this.state = 'single';
      else if (char === '"') this.state = 'double';
      else if (char === '`') this.state = 'identifier';
      if (!/\s/.test(char)) this.hasCode = true;
      this.statement += char;
      if (this.statement.length > 64 * 1024 * 1024) throw new Error('单条 SQL 不能超过 64 MiB');
    }
    return line.length;
  }
}
/** 对编辑器已有的完整文本执行同一套扫描规则，不另建简化版分号切分逻辑。 */
export function splitSql(sql: string, noBackslashEscapes = false, ansiQuotes = false, ansiQuotesKnown = true, noBackslashEscapesKnown = true): string[] { return new SqlScriptScanner(noBackslashEscapes, ansiQuotes, ansiQuotesKnown, noBackslashEscapesKnown).push(sql, true); }
