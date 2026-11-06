import { databaseBackupKinds, type DatabaseBackupKind, type DatabaseBackupManifest } from '../shared/databaseBackup';
import type { DatabaseBackupSqlInventory as Report } from '../shared/databaseBackupArchiveFiles';
import { SqlScriptScanner } from '../shared/sqlScriptScanner';
import type { TableDefinitionContext } from '../shared/tableColumnPatches';
import type { DatabaseBackupArchiveSink } from './databaseBackupArchive';
import { tableDefinitionPrefix, tableDefinitionTokens, type TableDefinitionToken as Token } from './tableColumnDefinition';

type Mode = TableDefinitionContext['mode'] | null;
type Item = Report['extra']['items'][number];
const prefixLimit = 32;
const limits = { bufferedUnits: 4 * 1024 * 1024, statements: 500_000, objects: 10_000, names: 256, examples: 50 };
const word = (token?: Token) => token?.kind === 'word' ? token.value.toUpperCase() : '';
const symbol = (token: Token | undefined, value: string) => token?.kind === 'symbol' && token.value === value;
const name = (token?: Token) => token && (token.kind === 'identifier' || token.kind === 'word') &&
  token.value && [...token.value].length <= 64 && !token.value.includes('\0') ? token.value : undefined;
const key = ({ kind, name: value }: Item) => JSON.stringify([kind, value]);
const objectKinds = new Map<string, DatabaseBackupKind>(databaseBackupKinds.map(kind => [kind.toUpperCase(), kind]));
objectKinds.set('SCHEMA', 'database');
const sessionVariables = new Set(['CHARACTER_SET_CLIENT', 'CHARACTER_SET_RESULTS', 'COLLATION_CONNECTION', 'TIME_ZONE',
  'UNIQUE_CHECKS', 'FOREIGN_KEY_CHECKS', 'SQL_MODE', 'SQL_NOTES', 'NOTE_VERBOSITY']);

function versionNumber(value: string) {
  const parts = /^(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/.exec(value);
  return parts ? Number(parts[1]) * 10_000 + Number(parts[2]) * 100 + Number(parts[3]) : undefined;
}

/** 只在清单所声明的版本语境展开可执行注释。MariaDB 不执行部分 MySQL 版本区间。 */
function statementTokens(sql: string, context: TableDefinitionContext, version: number, full = false): Token[] {
  const scan = (value: string) => full ? tableDefinitionTokens(value, context) : tableDefinitionPrefix(value, context, prefixLimit);
  const result: Token[] = [];
  for (const token of scan(sql)) {
    if (token.kind !== 'executable') { result.push(token); continue; }
    const header = /^\/\*(M?!)/.exec(token.value);
    if (!header) throw Error('无法解析可执行注释');
    const mariadb = context.dialect === 'mariadb', body = token.value.slice(header[0].length, -2);
    if (header[1] === 'M!' && (!mariadb || /^999999\\- enable the sandbox mode\s*$/.test(body))) continue;
    const tagged = /^(\d{5,6})(?=\s|$)/.exec(body);
    // 非标准紧连数字可能由客户端和服务端解释成不同版本，不把整个注释当作已证明无效。
    if (/^\d/.test(body) && (!tagged || !mariadb && version < 80400 && tagged[1].length === 6)) throw Error('条件注释版本边界不明确');
    const gate = Number(tagged?.[1] ?? 0);
    if (gate > version || mariadb && header[1] === '!' && gate >= 50700 && gate <= 99999) continue;
    const nested = scan(body.slice(tagged?.[0].length ?? 0));
    if (nested.some(value => value.kind === 'executable')) throw Error('可执行注释嵌套');
    result.push(...nested);
  }
  return result;
}

function account(tokens: Token[], cursor: number) {
  const user = tokens[cursor], host = tokens[cursor + 2];
  const valid = (token?: Token) => token && ['word', 'identifier', 'string'].includes(token.kind) &&
    token.value.length <= 255 && !/[\x00-\x1f\x7f]/.test(token.value);
  return valid(user) && valid(host) && symbol(tokens[cursor + 1], '@') ? `${user.value}@${host.value}` : undefined;
}

function creation(tokens: Token[]) {
  let cursor = word(tokens[1]) === 'OR' && word(tokens[2]) === 'REPLACE' ? 3 : 1;
  let definer: string | undefined;
  if (word(tokens[cursor]) === 'ALGORITHM' && symbol(tokens[cursor + 1], '=') && word(tokens[cursor + 2])) cursor += 3;
  if (word(tokens[cursor]) === 'DEFINER' && symbol(tokens[cursor + 1], '=')) {
    definer = account(tokens, cursor + 2);
    if (definer === undefined) return;
    cursor += 5;
  }
  if (word(tokens[cursor]) === 'SQL' && word(tokens[cursor + 1]) === 'SECURITY' &&
    ['DEFINER', 'INVOKER'].includes(word(tokens[cursor + 2]))) cursor += 3;
  const kind = objectKinds.get(word(tokens[cursor++]));
  if (word(tokens[cursor]) === 'IF' && word(tokens[cursor + 1]) === 'NOT' && word(tokens[cursor + 2]) === 'EXISTS') cursor += 3;
  return kind ? { kind, cursor, definer } : undefined;
}

function assignmentTarget(tokens: Token[]) {
  const normalized = tokens.map(token => word(token) || (token.kind === 'symbol' ? token.value : '?'));
  const joined = normalized.join(' ');
  if (normalized.length === 2 && normalized[0] === '@' && word(tokens[1])) return '@' + normalized[1];
  const session = /^(?:(?:@ @ (?:SESSION|LOCAL) \.|@ @|SESSION|LOCAL) )?([A-Z_]+)$/.exec(joined);
  return session?.[1];
}

/** 归档清单不是语义证据。独立流式读取 SQL，只对显式对象名做清点，不解释程序体或执行 SQL。 */
export class DatabaseBackupSqlInventoryReader implements DatabaseBackupArchiveSink {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private readonly scanner = new SqlScriptScanner(false, false, false, false);
  private readonly version: number;
  private readonly definitions = new Map<string, Item>();
  private readonly databases = new Set<string>();
  private readonly definers = new Set<string>();
  private readonly savedModes = new Map<string, Mode>();
  private mode: Mode = null;
  private database: string | undefined;
  private units = 0;
  private statements = 0;
  private inserts = 0;
  private other = 0;
  private reason: Report['reason'] = null;

  constructor(private readonly manifest: Pick<DatabaseBackupManifest, 'family' | 'serverVersion' | 'database' | 'objects'>) {
    const version = versionNumber(manifest.serverVersion);
    this.version = version ?? 0;
    if (version === undefined) this.reason = 'version';
  }

  async writeBytes(bytes: Uint8Array) {
    if (!this.reason) this.decode(bytes);
  }

  private decode(bytes?: Uint8Array) {
    let decoded: string;
    try { decoded = this.decoder.decode(bytes, { stream: !!bytes }); }
    catch { this.reason = 'encoding'; return; }
    this.units += decoded.length;
    try {
      if (this.units - this.scanner.retainedSourceOffset > limits.bufferedUnits) { this.reason = 'budget'; return; }
      // 同一块中 SET SQL_MODE 可能先改变后续语句的引号规则，因此一次只取一条。
      for (let ranges = this.scanner.pushRanges(decoded, !bytes, 1); ranges.length && !this.reason;
        ranges = this.reason ? [] : this.scanner.pushRanges('', !bytes, 1)) {
        if (ranges[0].delimiter === null) { this.reason = 'lexical'; break; }
        this.inspect(ranges[0].sql);
      }
    } catch { this.reason = 'lexical'; }
  }

  private remember(set: Set<string>, value: string) {
    if (set.size >= limits.names && !set.has(value)) this.reason = 'budget';
    else set.add(value);
  }

  private setMode(mode: Mode) {
    this.mode = mode;
    this.scanner.setMode(mode?.noBackslashEscapes ?? false, mode?.ansiQuotes ?? false, !!mode, !!mode);
  }

  private set(tokens: Token[]): boolean {
    if (word(tokens[1]) === 'NAMES') return ['UTF8', 'UTF8MB3', 'UTF8MB4'].includes(word(tokens[2]));
    const parts: Token[][] = [[]];
    for (const token of tokens.slice(1)) {
      if (symbol(token, ',')) parts.push([]);
      else parts.at(-1)!.push(token);
    }
    let recognized = true;
    const previous = this.mode;
    for (const part of parts) {
      const equal = part.findIndex(token => symbol(token, '='));
      const target = equal > 0 ? assignmentTarget(part.slice(0, equal)) : undefined;
      const rhs = part.slice(equal + 1);
      if (!target || !target.startsWith('@') && !sessionVariables.has(target) || !rhs.length) {
        // 无法确定 SET 是否改变词法条件时，后续继续使用多模式边界比对。
        recognized = false; this.setMode(null); continue;
      }
      const reference = assignmentTarget(rhs);
      const value = rhs[0].kind === 'string' && rhs.length === 1 && /^[A-Z0-9_,]*$/i.test(rhs[0].value) ? rhs[0].value : undefined;
      const modes = value?.toUpperCase().split(',');
      const mode = reference === 'SQL_MODE' ? previous : reference?.startsWith('@') ? this.savedModes.get(reference) ?? null
        : modes && !modes.some(item => ['DB2', 'MAXDB', 'MSSQL', 'ORACLE', 'POSTGRESQL'].includes(item)) ?
          { ansiQuotes: modes.includes('ANSI_QUOTES') || modes.includes('ANSI'), noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES') } : null;
      if (target === 'SQL_MODE') {
        if (!mode && !(reference && this.savedModes.has(reference))) recognized = false;
        this.setMode(mode);
      }
      if (target.startsWith('@')) {
        if (this.savedModes.size >= limits.names && !this.savedModes.has(target)) this.reason = 'budget';
        else this.savedModes.set(target, mode);
      }
    }
    return recognized;
  }

  private readTarget(tokens: Token[], cursor: number, kind?: DatabaseBackupKind) {
    const first = name(tokens[cursor]);
    if (!first) return;
    if (symbol(tokens[cursor + 1], '.')) {
      const object = name(tokens[cursor + 2]);
      if (!object || kind === 'database') return;
      this.remember(this.databases, first);
      return { database: first, object, next: cursor + 3 };
    }
    const database = kind === 'database' ? first : this.database;
    if (!database) return;
    this.remember(this.databases, database);
    return { database, object: first, next: cursor + 1 };
  }

  private inspect(sql: string) {
    if (++this.statements > limits.statements) { this.reason = 'budget'; return; }
    const context: TableDefinitionContext = { dialect: this.manifest.family, mode: this.mode ?? { ansiQuotes: false, noBackslashEscapes: false } };
    const tokens = statementTokens(sql, context, this.version);
    if (!tokens.length) { this.statements--; return; }
    if (!this.classify(sql, context, tokens)) this.other++;
  }

  private classify(sql: string, context: TableDefinitionContext, tokens: Token[]): boolean {
    const verb = word(tokens[0]);
    if (verb === 'SET') return this.set(statementTokens(sql, context, this.version, true));
    if (verb === 'USE') {
      this.database = tokens.length === 2 ? name(tokens[1]) : undefined;
      if (this.database) this.remember(this.databases, this.database);
      return !!this.database;
    }
    if (verb === 'UNLOCK') return word(tokens[1]) === 'TABLES' && tokens.length === 2;
    if (verb === 'CREATE' || verb === 'DROP') return this.definition(tokens, verb);
    if (verb === 'INSERT' || verb === 'REPLACE') {
      const target = word(tokens[1]) === 'INTO' && this.readTarget(tokens, 2);
      if (!target || word(tokens[target.next]) !== 'VALUES') return false;
      this.inserts++;
      return true;
    }
    if (verb === 'LOCK' || verb === 'ALTER') {
      const expected = verb === 'LOCK' ? 'TABLES' : 'TABLE';
      const target = word(tokens[1]) === expected && this.readTarget(tokens, 2);
      if (!target) return false;
      const option = word(tokens[target.next]);
      return verb === 'LOCK' ? ['WRITE', 'READ'].includes(option) && tokens.length === target.next + 1
        : ['DISABLE', 'ENABLE'].includes(option) && word(tokens[target.next + 1]) === 'KEYS' && tokens.length === target.next + 2;
    }
    return false;
  }

  private definition(tokens: Token[], verb: 'CREATE' | 'DROP'): boolean {
    const created = verb === 'CREATE' ? creation(tokens) : undefined;
    const kind = verb === 'CREATE' ? created?.kind : objectKinds.get(word(tokens[1]));
    if (!kind) return false;
    const cursor = created?.cursor ?? (word(tokens[2]) === 'IF' && word(tokens[3]) === 'EXISTS' ? 4 : 2);
    const target = this.readTarget(tokens, cursor, kind);
    if (!target) return false;
    const { database, object, next } = target;
    const id = key({ kind, name: object });
    if (verb === 'DROP') {
      if (tokens.length !== next) return false;
      if (database === this.manifest.database) {
        if (kind === 'database') this.definitions.clear();
        else this.definitions.delete(id);
      }
      if (kind === 'database' && database === this.database) this.database = undefined;
      return true;
    }
    const expected = kind === 'view' ? ['AS'] : kind === 'event' ? ['ON'] : kind === 'trigger' ? ['BEFORE', 'AFTER'] : [];
    if (expected.length && !expected.includes(word(tokens[next])) || ['table', 'procedure', 'function'].includes(kind) &&
      !symbol(tokens[next], '(')) return false;
    if (kind === 'trigger' && (!['INSERT', 'UPDATE', 'DELETE'].includes(word(tokens[next + 1])) ||
      word(tokens[next + 2]) !== 'ON' || !this.readTarget(tokens, next + 3))) return false;
    if (created?.definer !== undefined) this.remember(this.definers, created.definer);
    if (database !== this.manifest.database) return true;
    if (this.definitions.size >= limits.objects && !this.definitions.has(id)) this.reason = 'budget';
    else this.definitions.set(id, { kind, name: object });
    return true;
  }

  finish(): Report {
    if (!this.reason) this.decode();
    const expected = new Map(this.manifest.objects.map(item => [key(item), { kind: item.kind, name: item.name }]));
    const missing = [...expected].filter(([id]) => !this.definitions.has(id)).map(([, item]) => item);
    const extra = [...this.definitions].filter(([id]) => !expected.has(id)).map(([, item]) => item);
    const state = this.reason || this.other || expected.size !== this.manifest.objects.length ? 'partial'
      : missing.length || extra.length || [...this.databases].some(database => database !== this.manifest.database) ? 'differs' : 'matches';
    const summarize = (items: Item[]) => ({ total: items.length, items: items.slice(0, limits.examples) });
    return { state, statements: this.statements, dataStatements: this.inserts, definitions: this.definitions.size,
      otherStatements: this.other, databases: [...this.databases], definers: [...this.definers],
      missing: summarize(missing), extra: summarize(extra), reason: this.reason };
  }
}
