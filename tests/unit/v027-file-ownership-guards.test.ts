import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runInContext, createContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { v027Lifetime } from '../helpers/v027Acceptance';

// 只提取实际record和整个ctx对象，禁止导入live/驱动/桌面fixture。
const source = readFileSync(new URL('../e2e/v027-acceptance-fixture.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
let recordSource = '', ctxSource = '';
function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'record') recordSource = node.getText(tree); if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'ctx' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) ctxSource = node.initializer.getText(tree); ts.forEachChild(node, visit); }
visit(tree);
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

/** 原TestInfo、原check/step/finish运行；所有文件/DB/窗口端口仅为RAM，不建立reader或连接。 */
function fixture(options: { lateOpen?: boolean; writeFailure?: boolean; closeFailure?: boolean; drift?: string } = {}) {
  const info = { _startWallTime: 0, timeout: 120000 }, events: string[] = []; let now = 1;
  const life = v027Lifetime(info, { assertCurrent() {} }, () => info, () => {}, () => now);
  const writeError = Error('原写入失败'), closeError = Error('原关闭失败'), bytes = Buffer.from('仅RAM样本'), file = resolve('C:/RAM/precise.csv');
  let exists = true, changed = false, pathReads = 0;
  const stat = () => ({ dev: changed && options.drift === 'device' ? 2 : 1, ino: changed && ['inode', 'after-realpath'].includes(options.drift ?? '') ? 99 : 11, nlink: changed && options.drift === 'hardlink' ? 2 : 1, size: changed && options.drift === 'size' ? bytes.length + 1 : bytes.length, isFile: () => !(changed && options.drift === 'not-file'), isSymbolicLink: () => changed && options.drift === 'symlink' });
  const plan = { nonce: 'a'.repeat(32), caseHash: 'b'.repeat(64), schema: 'RAM_schema', tables: ['__v027_owner', 'csv_target', 'neighbor'] };
  const owner = { application: {}, page: { evaluate: async () => [{ status: 'completed' }] }, closed: false }, stream = { closed: false }, native = { stream };
  const observer = { connection: native, query: async (sql: string) => {
    if (sql.startsWith('SELECT nonce')) return [[{ nonce: plan.nonce, case_hash: plan.caseHash }]];
    if (sql.includes('information_schema.TABLES')) return [plan.tables.map(name => ({ name }))];
    if (sql.startsWith('DROP')) { events.push('drop'); return [{}]; }
    if (sql.includes('information_schema.SCHEMATA')) return [[]]; throw Error('禁止额外RAM查询');
  } };
  const recordEvents: string[] = [], records: unknown[] = [];
  const sandbox: any = { info, life, owner, Buffer, expect, createHash, resolve, plan, files: [file], records, journalPath: 'RAM-journal', binding: { target: { nonce: 'c'.repeat(32) } }, native, originalStream: stream, observer, schemaAck: true, appClosed: false, pageErrors: [], plannedDirectory: '', directoryRemoved: false, journalSize: 0, journalIdentity: '',
    identities: new Map([[file, { dev: '1', ino: '11', hash: createHash('sha256').update(bytes).digest('hex') }]]),
    ownedDesktopResources: () => owner, confirmOwnedDesktopExit: async () => { events.push('exit'); owner.closed = true; }, closeMysqlConnection: async () => { events.push('stream-close'); stream.closed = true; },
    record: async (stage: string) => { recordEvents.push(stage); },
    open: async () => { events.push('open'); if (options.lateOpen) now = 120000; return { stat: async () => ({ ...stat(), size: 0 }), writeFile: async () => { events.push('write'); if (options.writeFailure) throw writeError; }, sync: async () => { events.push('sync'); }, close: async () => { events.push('close'); if (options.closeFailure) throw closeError; } }; },
    lstat: async () => { events.push('stat'); if (!exists) throw Object.assign(Error('无残留'), { code: 'ENOENT' }); return stat(); },
    realpath: async () => { events.push('realpath'); pathReads++; if (pathReads === 2 && options.drift === 'after-realpath') changed = true; return changed && options.drift === 'path' ? resolve('C:/RAM/other.csv') : file; },
    readFile: async () => { events.push('read'); if (options.drift !== 'after-realpath') changed = true; return bytes; },
    unlink: async () => { events.push('unlink'); exists = false; },
  };
  createContext(sandbox); runInContext(compile('const ctx=' + ctxSource + '; globalThis.ctx=ctx;'), sandbox); sandbox.ctx.facts = async () => {};
  return { sandbox, life, events, records, recordEvents, writeError, closeError, async record() { sandbox.owner = undefined; runInContext(compile(recordSource + '; globalThis.originalRecord=record;'), sandbox); await sandbox.originalRecord('planned'); } };
}

describe.each(['record', 'writeInputs'] as const)('%s原句柄晚回和失败收尾', method => {
  const run = (f: ReturnType<typeof fixture>) => method === 'record' ? f.record() : f.sandbox.ctx.writeInputs(['RAM']);
  it.each([false, true])('open回包已达原120秒：close失败=%s，仅关闭原句柄且零写入', async closeFailure => {
    const f = fixture({ lateOpen: true, closeFailure }); let error: any;
    try { await run(f); } catch (reason) { error = reason; }
    expect(f.events).toEqual(['open', 'close']); expect(f.life.snapshot.retained).toBe(true); expect(f.recordEvents).toEqual([]); expect(f.records).toEqual([]);
    if (closeFailure) { expect(error.errors).toHaveLength(2); expect(error.errors[0].message).toContain('原TestInfo/期限已失效'); expect(error.errors[1]).toBe(f.closeError); expect(error.cause).toBe(error.errors[0]); }
    else expect(error.message).toContain('原TestInfo/期限已失效');
  });
  it('原写入和关闭同时失败保留两份原错误，关闭失败不盖首因', async () => {
    const f = fixture({ writeFailure: true, closeFailure: true }); let error: any; try { await run(f); } catch (reason) { error = reason; }
    expect(error.errors).toEqual([f.writeError, f.closeError]); expect(error.cause).toBe(f.writeError); expect(f.events.filter(value => value === 'close')).toHaveLength(1); expect(f.events).not.toContain('sync'); expect(f.life.snapshot.retained).toBe(true); expect(f.recordEvents).toEqual([]);
  });
  it('仅关闭失败也传播原错误，不发布成功记录', async () => {
    const f = fixture({ closeFailure: true }); let error: unknown; try { await run(f); } catch (reason) { error = reason; }
    expect(error).toBe(f.closeError); expect(f.events.filter(value => value === 'close')).toHaveLength(1); expect(f.life.snapshot.retained).toBe(true); expect(f.recordEvents).toEqual([]); expect(f.records).toEqual([]);
  });
});

describe('读取之后原文件身份复核', () => {
  it.each(['inode', 'device', 'symlink', 'hardlink', 'not-file', 'path', 'size', 'after-realpath'])('%s漂移时即使字节相同也零unlink、零DROP、零完成', async drift => {
    const f = fixture({ drift }); await expect(f.sandbox.ctx.finish(async () => {}, 1)).rejects.toThrow('原样本文件');
    expect(f.events).toContain('read'); expect(f.events).not.toContain('unlink'); expect(f.events).not.toContain('drop'); expect(f.events).not.toContain('stream-close'); expect(f.life.snapshot.retained).toBe(true); expect(f.life.snapshot.complete).toBe(false);
  });
  it('同一原文件正常对照在read后先核规范路径和dev/ino，再沿原收尾完成', async () => {
    const f = fixture(); await f.sandbox.ctx.finish(async () => {}, 1);
    const read = f.events.indexOf('read'), unlink = f.events.indexOf('unlink'); expect(f.events.slice(read, unlink)).toEqual(['read', 'realpath', 'stat']); expect(f.events).toContain('drop'); expect(f.life.snapshot.complete).toBe(true);
  });
});
