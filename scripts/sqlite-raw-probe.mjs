import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync, constants } from 'node:sqlite';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdk = join(root, '.cache/sqlite-raw-sdk-node24.17.0');
const headers = {
  'sqlite3.h': '8e43a79982422f4720685f62839718f0e41410c1b71355aa32af3615ccd9e31d',
  'sqlite3ext.h': 'ac9645e5c9ff0cf176efdd6e75cb5e98f46295d38e02db5c4d208826a39ab4be',
};

/** 仅实验命令获取固定公共头文件；每次使用前核摘要，不下载或加载预编译扩展。 */
async function prepareHeaders() {
  mkdirSync(sdk, { recursive: true });
  for (const [name, digest] of Object.entries(headers)) {
    const path = join(sdk, name);
    if (!existsSync(path)) {
      const response = await fetch('https://raw.githubusercontent.com/nodejs/node/v24.17.0/deps/sqlite/' + name, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error('固定SQLite头文件下载失败');
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, 'SQLite头文件摘要不符');
      writeFileSync(path, bytes, { flag: 'wx' });
    }
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), digest, '缓存SQLite头文件摘要不符');
  }
}

/** 编译器只属于显式实验，不改变pnpm build、产品启动或扩展加载策略。 */
async function main() {
  assert.equal(process.argv.length, 2, '探针不接受环境、数据库或扩展路径参数');
  assert.ok(['win32', 'darwin', 'linux'].includes(process.platform), '尚未支持此实验平台');
  await prepareHeaders();
  const cache = join(root, '.cache'); mkdirSync(cache, { recursive: true });
  const run = mkdtempSync(join(cache, 'sqlite-raw-probe-'));
  console.log('原始实验记录目录：' + run);
  const binary = join(run, 'rawProbe' + (process.platform === 'win32' ? '.dll' : process.platform === 'darwin' ? '.dylib' : '.so'));
  const zig = join(root, '.tools/zig/zig-x86_64-windows-0.15.2/zig.exe');
  const compiler = process.platform === 'win32' ? zig : 'cc';
  if (process.platform === 'win32') assert.ok(existsSync(compiler), 'Windows实验需先准备经官方SHA256核对的Zig 0.15.2；不会自动安装');
  const args = [...(process.platform === 'win32' ? ['cc'] : []), process.platform === 'darwin' ? '-dynamiclib' : '-shared', ...(process.platform === 'win32' ? [] : ['-fPIC']), '-O2', '-Wall', '-Wextra', '-Werror', '-I', sdk, join(root, 'research/sqlite-raw-bridge/rawProbe.c'), '-o', binary];
  const compiled = spawnSync(compiler, args, { cwd: run, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: join(cache, 'zig-global'), ZIG_LOCAL_CACHE_DIR: join(cache, 'zig-local') } });
  writeFileSync(join(run, 'compile.json'), JSON.stringify({ status: compiled.status, signal: compiled.signal, error: compiled.error?.message, stdout: compiled.stdout, stderr: compiled.stderr }, null, 2));
  assert.equal(compiled.error, undefined, '编译器启动失败'); assert.equal(compiled.signal, null); assert.equal(compiled.status, 0, '原生编译失败，保留原始记录');
  const bundle = join(run, 'rawValue.cjs');
  await build({ entryPoints: [join(root, 'src/engine/sqlite/rawValue.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node24' });
  const { decodeSqliteRawValue } = createRequire(import.meta.url)(bundle);
  const reports = [];
  for (const encoding of ['UTF-8', 'UTF-16le', 'UTF-16be']) reports.push(experiment(run, binary, encoding, decodeSqliteRawValue));
  writeFileSync(join(run, 'report.json'), JSON.stringify({ node: process.versions.node, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch, sourceHash: createHash('sha256').update(readFileSync(join(root, 'research/sqlite-raw-bridge/rawProbe.c'))).digest('hex'), headers, reports, productIntegrated: false }, null, 2));
  console.log('三编码原字节、五类值、原生权限、一次求值、事务、RETURNING与DONE不重放通过；未接入产品。');
}

/** 一轮只持有自己的合成文件；失败保留文件与报告，成功后关闭再精确核零。 */
function experiment(run, binary, encoding, decode) {
  const directory = mkdtempSync(join(run, 'fixture-')), path = join(directory, 'sample.sqlite');
  const invalid = encoding === 'UTF-8' ? '80' : encoding === 'UTF-16le' ? '00d8' : 'd800';
  const original = '\uFEFF真实\0🚢\uFFFD', db = new DatabaseSync(path, { allowExtension: true });
  let internalPrepare = false, invoke, successful = false, failure;
  try {
    db.exec("PRAGMA encoding='" + encoding + "'; CREATE TABLE subject(id INTEGER PRIMARY KEY,n INTEGER,v)");
    db.prepare('INSERT INTO subject VALUES(1,0,?)').run(original);
    db.exec("INSERT INTO subject VALUES(2,0,CAST(X'" + invalid + "' AS TEXT))");
    const sourceBefore = db.prepare('SELECT id,typeof(v) AS kind,hex(v) AS bytes FROM subject ORDER BY id').all();
    const lossy = db.prepare('SELECT v FROM subject WHERE id=2').get().v;
    assert.equal(lossy, '\uFFFD'.repeat(encoding === 'UTF-8' ? 1 : 3), '应先复现实有Node文本转换缺陷');
    db.loadExtension(binary, 'sqlite3_dbarkrawprobe_init'); db.enableLoadExtension(false);
    const denied = [];
    db.setAuthorizer((action, first, second) => {
      if (action === constants.SQLITE_ATTACH || action === constants.SQLITE_DETACH || action === constants.SQLITE_FUNCTION && second === 'dbark_raw_probe_v1' && !internalPrepare) { denied.push({ action, second }); return constants.SQLITE_DENY; }
      return constants.SQLITE_OK;
    });
    invoke = (op, argument = null) => {
      let control;
      try { internalPrepare = true; control = db.prepare('SELECT dbark_raw_probe_v1(?,?)'); control.setReturnArrays(true); }
      finally { internalPrepare = false; }
      // node:sqlite将JS number绑定为REAL；原生控制整数必须明确使用BigInt。
      return control.get(BigInt(op), typeof argument === 'number' ? BigInt(argument) : argument)[0];
    };
    const raw = column => { const descriptor = invoke(3, column); return { type: descriptor & 255, encoding: descriptor >> 8, bytes: invoke(4, column) }; };
    const rows = sql => {
      const consumed = invoke(0, sql); assert.equal(consumed, Buffer.byteLength(sql)); const output = [];
      try {
        let count; while ((count = invoke(1)) !== null) { const row = []; for (let column = 0; column < count; column++) row.push(decode(raw(column))); output.push(row); }
        assert.equal(invoke(1), null, 'DONE后不得自动重跑'); assert.equal(invoke(1), null);
        return output;
      } finally { invoke(2); }
    };
    assert.deepEqual(rows('SELECT v FROM subject WHERE id=1'), [[original]]);
    invoke(0, 'SELECT v FROM subject WHERE id=2'); assert.equal(invoke(1), 1);
    const bad = raw(0); assert.equal(Buffer.from(bad.bytes).toString('hex'), invalid);
    assert.throws(() => decode(bad), error => error.code === 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE');
    assert.equal(invoke(1), null); invoke(2);
    assert.deepEqual(rows("SELECT NULL,9223372036854775807,-9223372036854775808,1.25,-0.0,1e999,x'80ff',x'',CAST(x'' AS TEXT)"), [[null, { type: 'integer', value: '9223372036854775807' }, { type: 'integer', value: '-9223372036854775808' }, { type: 'real', value: '1.25' }, { type: 'real', value: '-0' }, { type: 'real', value: 'Infinity' }, { type: 'binary', base64: 'gP8=' }, { type: 'binary', base64: '' }, '']]);
    let evaluations = 0; db.function('probe_once', () => { evaluations++; return '调用' + evaluations; });
    assert.deepEqual(rows('SELECT probe_once(),probe_once()'), [['调用1', '调用2']]); assert.equal(evaluations, 2);
    for (const sql of ['BEGIN', 'UPDATE subject SET n=n+1', 'COMMIT']) assert.deepEqual(rows(sql), []);
    assert.equal(db.isTransaction, false);
    invoke(0, 'UPDATE subject SET n=n+1 WHERE id=2 RETURNING v'); assert.equal(invoke(1), 1);
    assert.throws(() => decode(raw(0)), error => error.code === 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE');
    assert.equal(invoke(1), null); assert.equal(invoke(1), null); invoke(2);
    // 函数拒绝的原生prepare错误码是1；ATTACH拒绝是23。与不经桥的同一原生入口逐项对照。
    assert.throws(() => db.prepare('SELECT dbark_raw_probe_v1(2,NULL)'), { code: 'ERR_SQLITE_ERROR', errcode: 1 });
    assert.throws(() => rows('SELECT dbark_raw_probe_v1(2,NULL)'), { code: 'ERR_SQLITE_ERROR', errcode: 1 });
    assert.throws(() => db.prepare("ATTACH ':memory:' AS other"), { code: 'ERR_SQLITE_ERROR', errcode: 23 });
    assert.throws(() => rows("ATTACH ':memory:' AS other"), { code: 'ERR_SQLITE_ERROR', errcode: 23 });
    assert.deepEqual(denied, [{ action: constants.SQLITE_FUNCTION, second: 'dbark_raw_probe_v1' }, { action: constants.SQLITE_FUNCTION, second: 'dbark_raw_probe_v1' }, { action: constants.SQLITE_ATTACH, second: null }, { action: constants.SQLITE_ATTACH, second: null }]);
    assert.throws(() => db.prepare("SELECT load_extension('missing')").get(), /authorized|authorization/i);
    assert.throws(() => invoke(4294967296), /DBARK_RAW_PROBE_INVALID/);
    let constraint;
    try { db.prepare("INSERT INTO subject VALUES(1,0,'重复主键')").run(); } catch (error) { constraint = error.errcode; }
    assert.equal(typeof constraint, 'number');
    invoke(0, "INSERT INTO subject VALUES(1,0,'重复主键')");
    assert.throws(() => invoke(1), { code: 'ERR_SQLITE_ERROR', errcode: constraint });
    assert.throws(() => invoke(1), { code: 'ERR_SQLITE_ERROR', errcode: constraint }, '失败终态不能被后续step当成成功DONE');
    assert.throws(() => invoke(2), { code: 'ERR_SQLITE_ERROR', errcode: constraint });
    assert.deepEqual(rows('SELECT n FROM subject ORDER BY id'), [[{ type: 'integer', value: '1' }], [{ type: 'integer', value: '2' }]]);
    assert.equal(db.isTransaction, false);
    assert.deepEqual(db.prepare('SELECT id,typeof(v) AS kind,hex(v) AS bytes FROM subject ORDER BY id').all(), sourceBefore);
    successful = true;
    return { encoding, rawEncoding: bad.encoding, badHex: invalid, originalDefectReproduced: true, oldReplacementCount: lossy.length, validTextKept: true, fiveTypesKept: true, invalidRejected: true, evaluations, writes: [1, 2], nativePermissionsKept: true, repeatedDoneNoReplay: true, nativeFailureCode: constraint, repeatedFailureKept: true, transaction: false, normalClose: true, fixtureRemoved: true };
  } catch (error) { failure = error; throw error; }
  finally {
    try { if (invoke) invoke(2); }
    catch (error) { if (!failure) throw error; console.error('原失败后的游标收尾另有失败，保留原失败：', error); }
    finally { db.close(); }
    if (successful) {
      const independent = new DatabaseSync(path, { readOnly: true });
      try { assert.deepEqual(independent.prepare('SELECT n FROM subject ORDER BY id').all().map(row => row.n), [1, 2]); assert.equal(independent.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); } finally { independent.close(); }
      assert.equal(dirname(path), directory); assert.equal(dirname(directory), run); unlinkSync(path); rmdirSync(directory); assert.equal(existsSync(directory), false);
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
