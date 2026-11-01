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
  const statementBundle = join(run, 'rawStatement.cjs');
  await build({ entryPoints: [join(root, 'src/engine/sqlite/rawStatement.ts')], outfile: statementBundle, bundle: true, platform: 'node', format: 'cjs', target: 'node24' });
  const { SqliteRawStatement } = createRequire(import.meta.url)(statementBundle);
  const framesBundle = join(run, 'rawFrames.cjs');
  await build({ entryPoints: [join(root, 'src/engine/sqlite/rawFrames.ts')], outfile: framesBundle, bundle: true, platform: 'node', format: 'cjs', target: 'node24' });
  const { consumeSqliteRawFrames } = createRequire(import.meta.url)(framesBundle);
  const reports = [];
  for (const encoding of ['UTF-8', 'UTF-16le', 'UTF-16be']) reports.push(await experiment(run, binary, encoding, decodeSqliteRawValue, SqliteRawStatement, consumeSqliteRawFrames));
  const sourceHashes = Object.fromEntries(['research/sqlite-raw-bridge/rawProbe.c', 'src/engine/sqlite/rawValue.ts', 'src/engine/sqlite/rawStatement.ts', 'src/engine/sqlite/rawFrames.ts', 'scripts/sqlite-raw-probe.mjs'].map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
  writeFileSync(join(run, 'report.json'), JSON.stringify({ node: process.versions.node, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch, sourceHash: sourceHashes['research/sqlite-raw-bridge/rawProbe.c'], sourceHashes, headers, reports, productIntegrated: false }, null, 2));
  console.log('三编码原字节、五类值、原生权限、一次求值、事务、RETURNING与DONE不重放通过；未接入产品。');
}

/** 一轮只持有自己的合成文件；失败保留文件与报告，成功后关闭再精确核零。 */
async function experiment(run, binary, encoding, decode, RawStatement, consumeFrames) {
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
      return control.get(BigInt(op), typeof argument === 'number' && op !== 7 ? BigInt(argument) : argument)[0];
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
    const adapter = statementExperiment(db, invoke, RawStatement, original);
    const frames = await frameExperiment(db, invoke, RawStatement, consumeFrames, encoding, original, path);
    assert.deepEqual(rows('SELECT n FROM subject ORDER BY id'), [[{ type: 'integer', value: '1' }], [{ type: 'integer', value: '2' }]]);
    assert.equal(db.isTransaction, false);
    assert.deepEqual(db.prepare('SELECT id,typeof(v) AS kind,hex(v) AS bytes FROM subject ORDER BY id').all(), sourceBefore);
    successful = true;
    return { encoding, rawEncoding: bad.encoding, badHex: invalid, originalDefectReproduced: true, oldReplacementCount: lossy.length, validTextKept: true, fiveTypesKept: true, invalidRejected: true, evaluations, writes: [1, 2], nativePermissionsKept: true, repeatedDoneNoReplay: true, nativeFailureCode: constraint, repeatedFailureKept: true, adapter, frames, transaction: false, normalClose: true, fixtureRemoved: true };
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

/** 用当前适配器对照原生绑定/列目录，原5类值与写入断言全部保留。 */
function statementExperiment(db, invoke, RawStatement, original) {
  db.limits.length = 1024 * 1024; db.limits.sqlLength = 20 * 1024 * 1024;
  db.limits.column = 1024; db.limits.variableNumber = 1024;
  let statement = RawStatement.prepare(invoke, 'SELECT ?1,?2,?3,?4,?5,?6');
  assert.deepEqual(statement.parameterNames(), ['?1', '?2', '?3', '?4', '?5', '?6']);
  const privateText = original + "' OR 1=1 --";
  statement.bind([9223372036854775807n, -0, privateText, new Uint8Array([128, 255]), null, new Uint8Array()]);
  assert.deepEqual(statement.next(), [{ type: 'integer', value: '9223372036854775807' }, { type: 'real', value: '-0' }, privateText, { type: 'binary', base64: 'gP8=' }, null, { type: 'binary', base64: '' }]);
  assert.throws(() => statement.bind([])); assert.equal(statement.next(), null); statement.finish();
  const closed = statement;
  statement = RawStatement.prepare(invoke, 'SELECT :text,:text,:min,:real,:missing');
  assert.deepEqual(statement.parameterNames(), [':text', ':min', ':real', ':missing']);
  statement.bind({ ':text': privateText, ':min': -9223372036854775808n, ':real': 1.25, ':unused': '忽略未用具名值' });
  assert.deepEqual(statement.next(), [privateText, privateText, { type: 'integer', value: '-9223372036854775808' }, { type: 'real', value: '1.25' }, null]);
  assert.equal(statement.next(), null); statement.finish();
  for (const [sql, parameters, expected] of [
    ['SELECT :x,?', [1n], [null, { type: 'integer', value: '1' }]],
    ['SELECT ?4,?1', [1n], [null, { type: 'integer', value: '1' }]],
    ['SELECT ?', [], [null]],
  ]) { statement = RawStatement.prepare(invoke, sql); statement.bind(parameters); assert.deepEqual(statement.next(), expected); statement.finish(); }
  statement = RawStatement.prepare(invoke, 'SELECT :x');
  assert.throws(() => statement.bind([1n]), error => error.errcode === 25); statement.finish();
  let metadataCalls = 0; db.function('probe_metadata_once', () => { metadataCalls++; return '只求值一次'; });
  const metadataSql = 'SELECT id AS "同名🚢",v AS "同名🚢",n+1 AS expression,probe_metadata_once() AS once FROM subject WHERE id=1';
  const originalColumns = db.prepare(metadataSql).columns();
  statement = RawStatement.prepare(invoke, metadataSql);
  assert.deepEqual(statement.columns(), originalColumns); assert.equal(metadataCalls, 0);
  assert.deepEqual(statement.next(), [{ type: 'integer', value: '1' }, original, { type: 'integer', value: '2' }, '只求值一次']);
  assert.deepEqual(statement.columns(), originalColumns); assert.equal(statement.next(), null); statement.finish(); assert.equal(metadataCalls, 1);
  let sourceCalls = 0; db.function('probe_source_once', () => { sourceCalls++; return '原SQL调用' + sourceCalls; });
  const first = '/*' + '🚢'.repeat(300000) + '*/ SELECT probe_source_once() AS "列🚢";', rest = '\n SELECT probe_source_once()';
  const nativePrefix = db.prepare(first + rest).sourceSQL;
  statement = RawStatement.prepare(invoke, first + rest);
  assert.equal(statement.sourceSQL, first); assert.equal(statement.sourceSQL, nativePrefix); assert.equal(statement.hasStatement, true);
  assert.equal(sourceCalls, 0); assert.deepEqual(statement.next(), ['原SQL调用1']); assert.equal(statement.next(), null); statement.finish(); assert.equal(sourceCalls, 1);
  statement = RawStatement.prepare(invoke, rest); assert.deepEqual(statement.next(), ['原SQL调用2']); statement.finish(); assert.equal(sourceCalls, 2);
  statement = RawStatement.prepare(invoke, 'SELECT 1');
  assert.throws(() => closed.next()); closed.finish(); assert.deepEqual(statement.next(), [{ type: 'integer', value: '1' }]); statement.finish();
  statement = RawStatement.prepare(invoke, '/*纯注释🚢*/ -- 没有SQL');
  assert.equal(statement.hasStatement, false); assert.deepEqual(statement.columns(), []); assert.deepEqual(statement.parameterNames(), []); assert.equal(statement.next(), null); statement.finish();
  assert.equal(invoke(12), 0); const chunk = Buffer.alloc(65536, 32);
  for (let index = 0; index < 320; index++) assert.equal(invoke(13, chunk), (index + 1) * 65536);
  assert.throws(() => invoke(13, new Uint8Array([32])), /DBARK_RAW_PROBE_INVALID/); invoke(2);
  assert.equal(invoke(12), 0); invoke(13, new Uint8Array([0xc0, 0x80])); assert.throws(() => invoke(14), /DBARK_RAW_PROBE_INVALID/); invoke(2);
  db.exec('CREATE TEMP TABLE probe_boundary_audit(note)');
  const trigger = "CREATE TEMP TRIGGER probe_boundary AFTER INSERT ON subject BEGIN INSERT INTO probe_boundary_audit VALUES('分号;不是边界'); INSERT INTO probe_boundary_audit VALUES('第二句'); END;";
  const nativeTrigger = db.prepare(trigger + rest).sourceSQL;
  statement = RawStatement.prepare(invoke, trigger + rest); assert.equal(statement.sourceSQL, nativeTrigger); assert.equal(statement.sourceSQL, trigger);
  assert.deepEqual(statement.columns(), []); assert.equal(statement.next(), null); statement.finish(); assert.equal(sourceCalls, 2);
  let badSteps = 0, badError;
  statement = RawStatement.prepare((op, value) => { if (op === 1) badSteps++; return invoke(op, value); }, 'SELECT v FROM subject WHERE id=2');
  assert.throws(() => statement.next(), error => { badError = error; return error.code === 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE'; });
  assert.throws(() => statement.next(), error => error === badError); assert.equal(badSteps, 1); statement.finish();
  return { positionalTypesKept: true, namedSlotsKept: true, duplicateColumnsKept: true, metadataMatchesNative: true, metadataCalls, longSqlBytes: Buffer.byteLength(first + rest), prefixMatchesNative: true, sourceCalls, triggerBoundaryKept: true, badSteps, badTextFailureSticky: true, maximumSqlBytes: 20 * 1024 * 1024, overBudgetRejected: true, invalidSqlUtf8Rejected: true, staleObjectIsolated: true };
}

/** 原生帧覆盖最大字段、百万行、ACK取消及原事务；只累计计数和总和，不收全结果。 */
async function frameExperiment(db, invoke, RawStatement, consume, encoding, original, path) {
  const smallRows = [], read = async (sql, parameters = [], bytes = 65536) => {
    const statement = RawStatement.prepare(invoke, sql); statement.bind(parameters); const rows = []; let current, count = 0, maximum = 0;
    try { await consume({ readFrame: (limit, size) => { const frame = statement.readFrame(limit, size); count++; maximum = Math.max(maximum, frame.length); return frame; } }, { rows: 2, bytes, check: () => {}, onFrame: frame => {
      for (const event of frame.events) { if (event.kind === 'row') current = []; else if (event.kind === 'value') current.push(event.value); else if (event.kind === 'rowEnd') { rows.push(current); current = undefined; } }
    } }); return { rows, count, maximum }; } finally { statement.finish(); }
  };
  smallRows.push(...(await read('SELECT id,v,n+0.25,zeroblob(0),NULL FROM subject WHERE id=1', [], 64)).rows);
  assert.deepEqual(smallRows, [[{ type: 'integer', value: '1' }, original, { type: 'real', value: '1.25' }, { type: 'binary', base64: '' }, null]]);
  assert.deepEqual((await read("SELECT 9223372036854775807,-9223372036854775808,-0.0,1e999,1.25,x'00ff',CAST(x'' AS TEXT)", [], 64)).rows, [[{ type: 'integer', value: '9223372036854775807' }, { type: 'integer', value: '-9223372036854775808' }, { type: 'real', value: '-0' }, { type: 'real', value: 'Infinity' }, { type: 'real', value: '1.25' }, { type: 'binary', base64: 'AP8=' }, '']]);
  const text = 'a'.repeat(encoding === 'UTF-8' ? 1048576 : 524288), blob = Buffer.alloc(1048576, 0xab);
  const large = await read('SELECT ?,?', [text, blob]);
  assert.deepEqual(large.rows, [[text, { type: 'binary', base64: blob.toString('base64') }]]); assert.ok(large.count > 16); assert.ok(large.maximum <= 65536);
  assert.deepEqual((await read('SELECT id FROM subject WHERE 0')).rows, []);
  let millionRows = 0, millionSum = 0n, millionFrames = 0, maxFrame = 0;
  const million = RawStatement.prepare(invoke, 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000001) SELECT x FROM n'), started = performance.now();
  try { await consume({ readFrame: (rows, bytes) => { const frame = million.readFrame(rows, bytes); millionFrames++; maxFrame = Math.max(maxFrame, frame.length); return frame; } }, { check: () => {}, onFrame: frame => {
    let ended = 0; for (const event of frame.events) { if (event.kind === 'value') { assert.equal(event.value.type, 'integer'); millionSum += BigInt(event.value.value); } else if (event.kind === 'rowEnd') { millionRows++; ended++; } }
    assert.ok(ended <= 200);
  } }); } finally { million.finish(); }
  const millionMs = performance.now() - started; assert.equal(millionRows, 1000001); assert.equal(millionSum, 500001500001n); assert.equal(millionFrames, 5001); assert.ok(maxFrame <= 65536);
  let evaluated = 0; db.function('probe_frame_ack', { useBigIntArguments: true }, value => { evaluated++; return value; });
  db.exec('BEGIN'); let reads = 0, cancel = false, release, reached;
  const ack = new Promise(resolve => { release = resolve; }), first = new Promise(resolve => { reached = resolve; });
  const source = RawStatement.prepare(invoke, 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10) SELECT probe_frame_ack(x) FROM n');
  const cancelled = Error('本例准确帧任务取消');
  const reading = consume({ readFrame: (rows, bytes) => { reads++; return source.readFrame(rows, bytes); } }, { rows: 2, check: () => { if (cancel) throw cancelled; }, onFrame: async () => { reached(); await ack; } });
  const outcome = reading.catch(error => error);
  await first; await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 1); assert.equal(evaluated, 2); cancel = true; release(); assert.equal(await outcome, cancelled); assert.equal(reads, 1); assert.equal(evaluated, 2);
  source.finish(); assert.equal(db.isTransaction, true); assert.equal(db.prepare('SELECT count(*) AS n FROM subject').get().n, 2); db.exec('ROLLBACK'); assert.equal(db.isTransaction, false);
  const partial = RawStatement.prepare(invoke, 'SELECT zeroblob(1048576)'); let partialReads = 0, partialCancel = false;
  await assert.rejects(consume({ readFrame: (rows, bytes) => { partialReads++; return partial.readFrame(rows, bytes); } }, { bytes: 64, check: () => { if (partialCancel) throw cancelled; }, onFrame: frame => { assert.equal(frame.events.some(event => event.kind === 'value'), false); partialCancel = true; } }), error => error === cancelled);
  assert.equal(partialReads, 1); partial.finish(); assert.deepEqual((await read('SELECT 1')).rows, [[{ type: 'integer', value: '1' }]]);
  let badEvaluated = 0; db.function('probe_frame_bad', { useBigIntArguments: true }, value => { badEvaluated++; return value; });
  const badSql = "SELECT v,probe_frame_bad(id) FROM subject UNION ALL SELECT '末行',probe_frame_bad(3)", native = db.prepare(badSql); native.setReturnArrays(true);
  const iterator = native.iterate(); iterator.next(); iterator.next(); iterator.return(); assert.equal(badEvaluated, 2); badEvaluated = 0;
  const bad = RawStatement.prepare(invoke, badSql); let completed = 0, terminal;
  try { await assert.rejects(consume(bad, { check: () => {}, onFrame: frame => { for (const event of frame.events) { if (event.kind === 'rowEnd') completed++; if (event.kind === 'error') terminal = event.code; } } }), error => error.code === 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE'); }
  finally { bad.finish(); }
  assert.equal(badEvaluated, 2); assert.equal(completed, 1); assert.equal(terminal, 0x7fff0001);
  const failed = RawStatement.prepare(invoke, "INSERT INTO subject VALUES(1,0,'重复')");
  await assert.rejects(consume(failed, { check: () => {}, onFrame: frame => { assert.deepEqual(frame.events, [{ kind: 'error', code: 1555 }]); } }), error => error.errcode === 1555);
  assert.throws(() => failed.finish(), error => error.errcode === 1555);
  if (encoding !== 'UTF-8') {
    const wide = Buffer.from('中'.repeat(524288), 'utf16le'); if (encoding === 'UTF-16be') wide.swap16();
    const budget = RawStatement.prepare(invoke, 'SELECT CAST(? AS TEXT)'); budget.bind([wide]);
    try { await assert.rejects(consume(budget, { check: () => {}, onFrame: frame => { assert.equal(frame.events.at(-1).code, 0x7fff0002); } }), error => error.code === 'SQLITE_RAW_VALUE_INVALID'); }
    finally { budget.finish(); }
  }
  db.exec('CREATE TABLE probe_frame_write(id INTEGER PRIMARY KEY,n INTEGER)');
  let writeCancel = false, writeRows = 0;
  const returning = RawStatement.prepare(invoke, "INSERT INTO probe_frame_write SELECT value,0 FROM json_each('[1,2,3]') RETURNING id");
  await assert.rejects(consume(returning, { rows: 1, check: () => { if (writeCancel) throw cancelled; }, onFrame: frame => { writeRows += frame.events.filter(event => event.kind === 'rowEnd').length; writeCancel = true; } }), error => error === cancelled);
  returning.finish(); assert.equal(writeRows, 1); assert.equal(db.isTransaction, false);
  const independent = () => { const other = new DatabaseSync(path, { readOnly: true }); try { return other.prepare('SELECT id,n FROM probe_frame_write ORDER BY id').all().map(row => [row.id, row.n]); } finally { other.close(); } };
  assert.deepEqual(independent(), [[1, 0], [2, 0], [3, 0]]);
  db.exec('BEGIN'); writeCancel = false;
  const transactionWrite = RawStatement.prepare(invoke, 'UPDATE probe_frame_write SET n=n+1 RETURNING id');
  await assert.rejects(consume(transactionWrite, { rows: 1, check: () => { if (writeCancel) throw cancelled; }, onFrame: () => { writeCancel = true; } }), error => error === cancelled);
  transactionWrite.finish(); assert.equal(db.isTransaction, true);
  assert.deepEqual(db.prepare('SELECT n FROM probe_frame_write ORDER BY id').all().map(row => row.n), [1, 1, 1]); assert.deepEqual(independent(), [[1, 0], [2, 0], [3, 0]]);
  db.exec('ROLLBACK'); assert.deepEqual(independent(), [[1, 0], [2, 0], [3, 0]]);
  const noStep = RawStatement.prepare(invoke, 'INSERT INTO probe_frame_write VALUES(4,0) RETURNING id'); let cancelledReads = 0;
  await assert.rejects(consume({ readFrame: (rows, bytes) => { cancelledReads++; return noStep.readFrame(rows, bytes); } }, { check: () => { throw cancelled; }, onFrame: () => { throw Error('首帧前取消不应回包'); } }), error => error === cancelled);
  noStep.finish(); assert.equal(cancelledReads, 0); assert.deepEqual(independent(), [[1, 0], [2, 0], [3, 0]]);
  return { smallTypesKept: true, numericExtremesKept: true, maximumTextBytes: Buffer.byteLength(text), maximumBlobBytes: blob.length, largeValueFrames: large.count, maximumFrameBytes: large.maximum, convertedBudgetChecked: encoding !== 'UTF-8', millionRows, millionSum: String(millionSum), millionFrames, millionMs, ackReads: reads, ackEvaluated: evaluated, cancellationPreservedTransaction: true, partialReads, partialBufferFinalized: true, badEvaluated, completedBeforeBad: completed, nativeErrorKept: true, returningRowsDelivered: writeRows, returningWritesAfterCancel: 3, explicitTransactionKept: true, explicitRollbackVerified: true, cancelledReads, independentDiskVerified: true };
}

main().catch(error => { console.error(error); process.exitCode = 1; });
