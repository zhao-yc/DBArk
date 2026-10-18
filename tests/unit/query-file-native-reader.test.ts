import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import initSqlJs from 'sql.js';
import { beforeAll, expect, it } from 'vitest';
import { privateQueryFileSourceSchema } from '../../src/main/queryFileSourceRecords';
import { bindEditorIndentNativeCase } from '../e2e/editor-indentation-native-gate';
import { EditorIndentNativeRun } from '../e2e/editor-indentation-native-owner';
import * as gate from '../e2e/query-file-native-gate';

let SQL: Awaited<ReturnType<typeof initSqlJs>>, bytes: Buffer;
const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => wasm }); const db = new SQL.Database();
  try {
    db.run('CREATE TABLE query_file_sources(tab_id TEXT,id TEXT,revision INTEGER,data TEXT); CREATE TABLE settings(id INTEGER,data TEXT); PRAGMA user_version=9;');
    db.run('INSERT INTO settings VALUES(1,?)', [JSON.stringify({ theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 't', tabs: [{ id: 't', kind: 'query', connectionId: 'c', title: '原run内合成标识', sql: '-- 仅内存合成' }] })]); bytes = Buffer.from(db.export());
  } finally { db.close(); }
});

/** 逐字编译完整实际fixture模块；文件/链接/句柄均为RAM，真实SQL.js只解析内存合成字节。 */
function fixture(mode = '正常') {
  const root = resolve('RAM-native-reader', 'dbark-indent-reader'), database = join(root, 'dbark.sqlite'), outside = resolve('RAM-outside', 'synthetic.sqlite');
  let clock = 100, fileVersion = 1n, parentVersion = 1n, parsed = 0, initialized = 0, firstRead = true;
  const log: Array<{ action: string; path?: string; length?: number }> = [];
  const info = { _startWallTime: 0, timeout: 120000, status: 'passed' }, environment = gate.bindQueryFileNativeEnvironment(() => ({ env: { DBARK_QUERY_FILE_NATIVE_TEST: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_QUERY_FILE_MANIFEST: 'C:/RAM/approved.json', DBARK_QUERY_FILE_MANIFEST_SHA256: 'a'.repeat(64), DBARK_QUERY_FILE_FIXTURE_SHA256: gate.queryFileNativeRecipeHash() }, args: [], platform: 'win32' }));
  const scope = bindEditorIndentNativeCase(info, environment, () => info, () => clock);
  const forbidden = async () => { throw Error('禁止启动、退出、PID、删除或写入端口'); };
  const run = new EditorIndentNativeRun({ assertCurrent: () => scope.assertCurrent(), preflight: forbidden, directory: forbidden, assertDirectory: forbidden, launch: forbidden, prepare: forbidden, record: forbidden, quit: forbidden, absent: forbidden, remove: forbidden } as any);
  const owner: any = { application: {}, page: {}, ids: new Set([111]), closed: false, confirmed: false, ready: false, errors: [], quitReady: Promise.resolve() }; run.acquiredDirectory(root); run.acquiredOwner(owner);
  function stat(file: boolean) { return { dev: 1n, ino: file ? 2n : parentVersion, size: file ? mode === '超预算' ? 17n * 1024n * 1024n : BigInt(bytes.length) : 0n, mtimeNs: file ? fileVersion : parentVersion, ctimeNs: file ? fileVersion : parentVersion, nlink: file && mode === '硬链接' ? 2n : 1n, isFile: () => file, isDirectory: () => !file, isSymbolicLink: () => file ? mode === '文件链接' : mode === '父目录链接' }; }
  const io = {
    lstat: async (name: string) => { log.push({ action: 'lstat', path: name }); if (![root, database].includes(name)) throw Error('拒绝原目录之外的路径'); return stat(name === database); },
    realpath: async (name: string) => { log.push({ action: 'realpath', path: name }); return name === database && mode === '真实路径外跳' ? outside : name; },
    open: async (name: string, flags: string) => {
      log.push({ action: 'open', path: name }); expect(name).toBe(database); expect(flags).toBe('r'); if (mode === 'open迟到') clock = 120000;
      return {
        stat: async () => { log.push({ action: 'fstat' }); return stat(true); },
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          log.push({ action: 'read', path: mode === '文件链接' ? outside : name, length });
          const count = Math.min(length, 2048, Math.max(0, bytes.length - position)); bytes.copy(buffer, offset, position, position + count);
          if (firstRead) { firstRead = false; if (mode === 'read迟到') clock = 120000; if (mode === '文件版本变化') fileVersion++; if (mode === '父目录替换') parentVersion++; }
          return { bytesRead: count, buffer };
        },
        close: async () => { log.push({ action: 'close' }); if (mode === 'close迟到') clock = 120000; },
        readFile: forbidden, write: forbidden, writeFile: forbidden,
      };
    },
    readFile: forbidden, mkdir: forbidden, readdir: forbidden, rmdir: forbidden, unlink: forbidden,
  };
  const source = readFileSync(new URL('../e2e/query-file-native-fixture.ts', import.meta.url), 'utf8');
  const load = Object.assign((name: string) => {
    if (name === 'node:fs/promises') return io; if (name === 'node:path') return path; if (name === 'node:crypto') return { createHash };
    if (name === 'sql.js') return { default: async () => { log.push({ action: 'initialize' }); initialized++; if (mode === 'init迟到') clock = 120000; return { Database: class { constructor(data: Uint8Array) { log.push({ action: 'parse' }); parsed++; return new SQL.Database(data); } } }; } };
    if (name === '../../src/main/queryFileSourceRecords') return { privateQueryFileSourceSchema }; if (name === './query-file-native-gate') return gate; throw Error('禁止模块：' + name);
  }, { resolve: () => wasm });
  const context: any = { exports: {}, require: load, Buffer }; runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { root, database, outside, run, owner, log, parsed: () => parsed, initialized: () => initialized, read: (input = root) => run.step(owner, () => context.exports.readQueryFileNativeDatabase(input, () => run.assert(owner), run)) as Promise<any> };
}

it('正常reader只读同一有界句柄并由真实SQL.js解析，不生成正常退出/PID证明', async () => {
  const value = fixture(), result = await value.read(); expect(result.schema).toBe(9); expect(result.settings.tabs[0].title).toBe('原run内合成标识'); expect(result.sources).toEqual([]); expect(value.parsed()).toBe(1);
  expect(value.log.filter(item => item.action === 'read').every(item => item.path === value.database && item.length! <= 64 * 1024)).toBe(true); expect(value.log.filter(item => item.action === 'close')).toHaveLength(1); expect(value.owner.confirmed).toBe(false); expect(value.owner.closed).toBe(false); expect(value.run.retained).toBe(false);
});
it.each(['文件链接', '硬链接', '父目录链接', '真实路径外跳'])('%s必须在任何正文读取和SQLite解析前拒绝，原目录保留', async mode => {
  const value = fixture(mode); await expect(value.read()).rejects.toThrow(/身份|链接|真实路径/); expect(value.log.some(item => item.action === 'open' || item.action === 'read')).toBe(false); expect(value.initialized()).toBe(0); expect(value.parsed()).toBe(0); expect(value.run.retained).toBe(true);
});
it.each(['open迟到', 'read迟到', 'init迟到', 'close迟到'])('%s到原120秒界限时拒绝证据，之后最多关闭已经取得的句柄', async mode => {
  const value = fixture(mode); await expect(value.read()).rejects.toThrow(/TestInfo|失效/); expect(value.run.retained).toBe(true); expect(value.log.filter(item => item.action === 'close')).toHaveLength(1);
  if (mode !== 'close迟到') expect(value.parsed()).toBe(0); else expect(value.parsed()).toBe(1);
  const action = mode === 'open迟到' ? 'open' : mode === 'read迟到' ? 'read' : mode === 'init迟到' ? 'initialize' : 'close', at = value.log.findIndex(item => item.action === action);
  expect(value.log.slice(at + 1).map(item => item.action)).toEqual(mode === 'close迟到' ? [] : ['close']);
});
it('读取期间文件版本或父目录变化不接受旧字节，不重签版本或解析', async () => {
  for (const mode of ['文件版本变化', '父目录替换']) { const value = fixture(mode); await expect(value.read()).rejects.toThrow(/版本|身份/); expect(value.parsed()).toBe(0); expect(value.initialized()).toBe(0); expect(value.run.retained).toBe(true); }
});
it('非原run目录及超预算文件均在打开正文句柄之前拒绝', async () => {
  const wrong = fixture(); await expect(wrong.read(resolve('RAM-other', 'dbark-indent-other'))).rejects.toThrow('归属'); expect(wrong.log).toEqual([]);
  const large = fixture('超预算'); await expect(large.read()).rejects.toThrow('有界'); expect(large.log.some(item => item.action === 'open' || item.action === 'read')).toBe(false); expect(large.parsed()).toBe(0);
});
