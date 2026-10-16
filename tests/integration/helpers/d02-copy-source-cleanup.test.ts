import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createContext, runInContext } from 'node:vm';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type Mode = 'normal' | 'create-unknown' | 'grant-write-unknown' | 'grant-extra' | 'grant-read-once' | 'grant-read-at-drop' | 'owner-read-at-drop' | 'table-read-at-drop' | 'role-read-at-drop' | 'schema-read-at-drop' | 'action-recovered' | 'close-failed' | 'user-post-drop-read' | 'database-post-drop-read' | 'no-mdl-plain' | 'no-mdl-required' | 'mdl-enabled';
/** 转译并执行正式完整withD02CopyCase及原D02/C02策略；只替换IO端口，不重写清理状态机。 */
async function scenario(mode: Mode | 'observe' | 'observe-error-once') {
  const trace: string[] = [], modules = new Map<string, { exports: Record<string, unknown> }>();
  let database = '', owner = '', random = 0, grantsCalls = 0, closing = false, injected = false, actionActive = false, userRemoved = false, databaseRemoved = false, instrumentQueries = 0;
  const uuid = '00000000-0000-0000-0000-000000000001';
  const forbidden = () => { throw new Error('纯测试禁止真实外部IO'); };
  const mysql = { createConnection() { const driver = new EventEmitter(); Object.assign(driver, { threadId: 1, destroy: () => undefined }); return driver; } }, factory = mysql.createConnection;
  /** 目录一次异常后恢复正常，真实夹具必须自己保留失败，不能靠合成端口持续抛错维持安全。 */
  const fail = (label: string): never => { injected = true; trace.push(label); throw Object.assign(new Error('合成底层内容不得进入错误输出'), { code: 'SYNTH_VERIFICATION', errno: 9911 }); };
  const execute = async (_managed: unknown, text: string) => {
    let rows: Record<string, unknown>[] = [];
    // 独立语法反例只检查官方8.4保留字BLOB；不声称合成端口能验证完整MySQL语法。
    if (text.includes('HEX(hidden_blob)')) {
      trace.push('观察行');
      if (/\bAS\s+BLOB\b/i.test(text) || mode === 'observe-error-once' && !injected) { injected = true; trace.push('观察解析失败'); throw Object.assign(new Error('合成语法原文及行内容不得输出'), { code: 'ER_PARSE_ERROR', sqlState: '42000', errno: 1064 }); }
      rows = [{ id: '9007199254740993', blob: '00FF8000', blobBytes: 4 }];
    }
    else if (text.startsWith('CREATE DATABASE')) { database = /`([^`]+)`/.exec(text)![1]; trace.push('CREATE DATABASE'); if (mode === 'create-unknown') fail('CREATE响应未知'); }
    else if (text.startsWith('CREATE USER')) trace.push('CREATE USER');
    else if (text.startsWith('GRANT SELECT') && mode === 'grant-write-unknown') fail('GRANT响应未知');
    else if (text.startsWith('DROP USER')) { trace.push('DROP USER'); userRemoved = true; }
    else if (text.startsWith('DROP DATABASE')) { trace.push('DROP DATABASE'); databaseRemoved = true; }
    else if (text.includes('@@server_uuid')) rows = [{ uuid, version: '8.4.5', names: 0, os: 'Linux', roles: '' }];
    else if (text.includes('Process_priv')) rows = [{ allowed: 'Y' }];
    else if (text.includes('setup_instruments')) { instrumentQueries++; rows = mode.startsWith('no-mdl') ? [] : [{ enabled: 'YES' }]; }
    else if (text.includes('PROCESSLIST WHERE ID=?')) rows = [{ ID: 1 }];
    else if (text.includes('TABLE_PRIVILEGES')) {
      grantsCalls++;
      if (!injected && (mode === 'grant-read-once' && grantsCalls === 1 || mode === 'grant-read-at-drop' && closing || mode === 'action-recovered' && actionActive)) fail('权限查询一次抛错');
      rows = [{ db: database, name: 'subject', privilege: mode === 'grant-extra' ? 'INSERT' : 'SELECT', grantable: 'NO' }];
    } else if (text.includes('SCHEMA_PRIVILEGES') && mode === 'schema-read-at-drop' && closing && !injected) fail('范围查询一次抛错');
    else if (text.includes('mysql.role_edges') && mode === 'role-read-at-drop' && closing && !injected) fail('角色查询一次抛错');
    else if (text.includes('USER_ATTRIBUTES')) { if (mode === 'owner-read-at-drop' && !injected) fail('账号归属一次抛错'); rows = [{ owner }]; }
    else if (text.includes('information_schema.TABLES ')) { if (mode === 'table-read-at-drop' && !injected) fail('表归属一次抛错'); rows = [{ name: 'subject', comment: `dbark-d02-owner:${owner}` }]; }
    else if (text.startsWith('SELECT User FROM mysql.user') && userRemoved && mode === 'user-post-drop-read' && !injected) fail('删用户后确认一次抛错');
    else if (text.includes('information_schema.SCHEMATA') && databaseRemoved && mode === 'database-post-drop-read' && !injected) fail('删库后确认一次抛错');
    return { rows };
  };
  const deps: Record<string, unknown> = {
    'node:crypto': { randomUUID: () => { const value = `${(++random).toString(16).padStart(8, '0')}-1111-2222-3333-444444444444`; if (random === 2) owner = value.replaceAll('-', ''); return value; }, randomBytes: (size: number) => Buffer.alloc(size, 1), createHash: forbidden },
    'node:fs/promises': { lstat: forbidden, readFile: forbidden }, 'node:util': { isDeepStrictEqual }, 'node:tls': { checkServerIdentity: forbidden }, 'node:timers/promises': { setTimeout: forbidden }, 'node:path': { isAbsolute }, mysql2: mysql,
    '../../../src/engine': { Engine: class { async handle() { return {}; } async closeAll() { closing = true; trace.push('关闭Engine'); if (mode === 'close-failed') fail('关闭验证失败'); } } },
    '../../../src/engine/connection': { connect: async () => { const driver = mysql.createConnection(); driver.emit('connect'); return { connection: driver, close: async () => { trace.push('关闭观察连接'); } }; }, execute },
    '../../../src/engine/sql': { identifier: (name: string) => '`' + name + '`', qualified: (db: string, table: string) => '`' + db + '`.`' + table + '`' },
    '../../../src/shared/validation': { validateCommand: (_command: unknown, input: unknown) => input },
  };
  /** 真实源模块只允许固定本地依赖；未知网络、文件或进程能力直接报错。 */
  function load(file: string): Record<string, unknown> {
    if (modules.has(file)) return modules.get(file)!.exports;
    const module = { exports: {} as Record<string, unknown> }; modules.set(file, module);
    const source = readFileSync(new URL('./' + file + '.ts', import.meta.url), 'utf8'), js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const context = createContext({ module, exports: module.exports, require: (name: string) => { if (name === './d02-copy-source-policy' || name === './c02-mtls-policy') return load(name.slice(2)); if (Object.hasOwn(deps, name)) return deps[name]; throw new Error('未授权的纯测试依赖'); }, Error, AggregateError, TypeError, RangeError, Buffer, setTimeout, clearTimeout, console: { info: () => undefined } });
    runInContext(js, context, { filename: file + '.ts' }); return module.exports;
  }
  let failure: unknown;
  /** 运行真实observe正文；一次解析失败后读取恢复也不能撤销永久保留标记。 */
  const observeAction = async (context: { observe(): Promise<Record<string, unknown>[]>; write(text: string): Promise<void> }) => {
    if (mode !== 'observe' && mode !== 'observe-error-once') return;
    if (mode === 'observe-error-once') { try { await context.observe(); } catch { trace.push('捕获观察失败'); } }
    const rows = await context.observe();
    expect(rows).toEqual([{ id: '9007199254740993', blob: '00FF8000', blobBytes: 4 }]);
    trace.push('观察成功且原blob键保留');
    if (mode === 'observe-error-once') { try { await context.write('DROP DATABASE `不应发送`'); } catch { trace.push('观察恢复仍禁止写入'); } }
  };
  const run = load('d02-copy-source-fixture').withD02CopyCase as (config: unknown, action: (context: { assertGrants(): Promise<void>; observe(): Promise<Record<string, unknown>[]>; write(text: string): Promise<void>; sql(text: string): Promise<unknown> }) => Promise<void>, limited: boolean, requirements?: { mdl?: boolean }) => Promise<void>;
  try { await run({ host: '192.168.31.200', port: 13384, serverUuid: uuid, user: '合成观察账号', password: '合成口令', tls: false }, async context => { trace.push('执行用例'); await observeAction(context); if (mode === 'action-recovered') { actionActive = true; try { await context.assertGrants(); } catch { trace.push('调用方捕获验证失败'); } await context.assertGrants(); trace.push('后续验证成功'); try { await context.write('DROP DATABASE `不应发送`'); } catch { trace.push('后续写入被禁止'); } try { await context.sql('DROP DATABASE `同样不应发送`'); } catch { trace.push('观察端口DROP也被禁止'); } } }, true, { mdl: mode === 'no-mdl-required' || mode === 'mdl-enabled' }); }
  catch (error) { failure = error; }
  expect(mysql.createConnection).toBe(factory);
  return { trace, failure, grantsCalls, instrumentQueries, drops: trace.filter(item => item.startsWith('DROP ')) };
}

describe('D02正式完整夹具的永久清理失效门（仅合成IO）', () => {
  it('独立保留字反例拒绝未引用BLOB，实际observe保留原blob结果键且正常清理', async () => { const result = await scenario('observe'); expect(result.failure).toBeUndefined(); expect(result.trace).toContain('观察成功且原blob键保留'); expect(result.trace).not.toContain('观察解析失败'); expect(result.drops).toEqual(['DROP USER', 'DROP DATABASE']); });
  it('observe一次1064后即使下一次成功也永久禁止DROP', async () => { const result = await scenario('observe-error-once'); expect(result.trace).toContain('捕获观察失败'); expect(result.trace).toContain('观察成功且原blob键保留'); expect(result.trace).toContain('观察恢复仍禁止写入'); expect(result.failure).toBeTruthy(); expect(result.drops).toEqual([]); expect(result.trace).toContain('关闭观察连接'); });
  it('正常对照仍按确认归属和线程清零顺序删除，不把全部清理永久禁用', async () => { const result = await scenario('normal'); expect(result.failure).toBeUndefined(); expect(result.drops).toEqual(['DROP USER', 'DROP DATABASE']); expect(result.trace.indexOf('关闭Engine')).toBeLessThan(result.trace.indexOf('DROP USER')); });
  it.each(['create-unknown', 'grant-write-unknown', 'grant-extra', 'grant-read-once', 'grant-read-at-drop', 'owner-read-at-drop', 'table-read-at-drop', 'role-read-at-drop', 'schema-read-at-drop', 'close-failed'] as const)('%s：验证无法判定后禁止全部后续DROP，并保留第一失败', async mode => { const result = await scenario(mode); expect(result.failure).toBeTruthy(); expect(result.drops).toEqual([]); expect(result.trace).toContain('关闭观察连接'); if (mode !== 'grant-extra') { const serialized: string[] = []; const visit = (error: unknown, depth = 0) => { if (!error || typeof error !== 'object' || depth > 12) return; const value = error as { code?: string; cause?: unknown; errors?: unknown[] }; if (value.code) serialized.push(value.code); visit(value.cause, depth + 1); value.errors?.forEach(item => visit(item, depth + 1)); }; visit(result.failure); expect(serialized).toContain('SYNTH_VERIFICATION'); } });
  it('调用方捕获一次失败且验证恢复成功也不能复活DROP授权', async () => { const result = await scenario('action-recovered'); expect(result.trace).toContain('调用方捕获验证失败'); expect(result.trace).toContain('后续验证成功'); expect(result.trace).toContain('后续写入被禁止'); expect(result.trace).toContain('观察端口DROP也被禁止'); expect(result.failure).toBeTruthy(); expect(result.drops).toEqual([]); });
  it('未知CREATE保留unknown而非伪装absent；权限读取失败保留真实confirmed', async () => { const unknown = await scenario('create-unknown'), confirmed = await scenario('grant-read-once'); expect((unknown.failure as Error).message).toContain('用户absent、库unknown'); expect((confirmed.failure as Error).message).toContain('用户confirmed、库confirmed'); });
  it('用户DROP后确认读取失败不能继续DROP库，既有删除不伪装成未发生', async () => { const result = await scenario('user-post-drop-read'); expect(result.failure).toBeTruthy(); expect(result.drops).toEqual(['DROP USER']); expect((result.failure as Error).message).toContain('用户confirmed、库confirmed'); expect((result.failure as Error).message).toContain('DROP成功响应：用户true、库false'); });
  it('库DROP后的确认失败保留错误而不重放删除', async () => { const result = await scenario('database-post-drop-read'); expect(result.failure).toBeTruthy(); expect(result.drops).toEqual(['DROP USER', 'DROP DATABASE']); expect(result.trace).toContain('删库后确认一次抛错'); });
  it('普通场景无MDL仪表仍执行及正常清理，不查询不相关的仪表', async () => { const result = await scenario('no-mdl-plain'); expect(result.failure).toBeUndefined(); expect(result.instrumentQueries).toBe(0); expect(result.trace).toContain('执行用例'); expect(result.drops).toEqual(['DROP USER', 'DROP DATABASE']); });
  it('显式MDL场景缺少仪表时在所有CREATE前拒绝并显示固定分类', async () => { const result = await scenario('no-mdl-required'); expect(result.instrumentQueries).toBe(1); expect(result.trace.some(item => item.startsWith('CREATE'))).toBe(false); expect(result.trace).not.toContain('执行用例'); expect(result.drops).toEqual([]); expect((result.failure as Error).message).toContain('D02_PREFLIGHT_MDL'); expect((result.failure as Error).message).toContain('服务器未提供真实MDL观察条件'); expect((result.failure as Error).message).toContain('用户absent、库absent'); });
  it('显式MDL场景必须实际收到仪表YES才允许进入用例', async () => { const result = await scenario('mdl-enabled'); expect(result.failure).toBeUndefined(); expect(result.instrumentQueries).toBe(1); expect(result.trace).toContain('执行用例'); expect(result.drops).toEqual(['DROP USER', 'DROP DATABASE']); });
});
