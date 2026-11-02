import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { keeperLimits, selectModeCandidate, acceptKeeperEvent } from './macos-mode-keeper-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** 仅本仓库main的准确托管arm64 JOIN job；外部参数、PR、本机及注入环境先于显示资源拒绝。 */
export function requireJoinKeeperCI(args, platform, arch, env) {
  assert.deepEqual(args, []); assert.equal(platform, 'darwin'); assert.equal(arch, 'arm64');
  assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.MODE_KEEPER_RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(env.GITHUB_REPOSITORY, 'zhao-yc/DBArk'); assert.equal(env.GITHUB_REF, 'refs/heads/main');
  assert.equal(env.GITHUB_JOB, 'join-components');
  assert.equal(env.GITHUB_WORKFLOW_REF, 'zhao-yc/DBArk/.github/workflows/foreign-key-join.yml@refs/heads/main');
  assert.ok(['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME));
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) assert.match(env[key] ?? '', /^[1-9][0-9]*$/);
  for (const key of Object.keys(env)) assert.ok(!/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$|DYLD_|LD_PRELOAD$)/i.test(key), '显示准备前拒绝外部入口或模块注入');
}

/** 消费原十二例与真实窗口几何，不通过缩小客户区、缺项或伪造收尾恢复显示。 */
export function requireJoinKeeperReport(report, plan) {
  assert.deepEqual(report.errors, []); assert.equal(report.config.workers, 1);
  assert.equal(report.stats.expected, 12); assert.equal(report.stats.unexpected, 0); assert.equal(report.stats.skipped, 0); assert.equal(report.stats.flaky, 0);
  const specs = [], visit = suite => { specs.push(...(suite.specs ?? [])); for (const child of suite.suites ?? []) visit(child); };
  for (const suite of report.suites ?? []) visit(suite);
  const modes = ['dark', 'light', 'filter-dark', 'filter-light', 'group-dark', 'group-light', 'summary-dark', 'summary-light', 'having-dark', 'having-light', 'distinct-dark', 'distinct-light'];
  assert.equal(specs.length, 12); const owners = [], pids = new Set(), directories = new Set();
  for (const [index, spec] of specs.entries()) {
    assert.equal(spec.title, 'JOIN真实菜单、双侧排序、上限及独立草稿：' + modes[index]); assert.equal(spec.ok, true);
    assert.equal(spec.tests.length, 1); const test = spec.tests[0];
    assert.equal(test.timeout, 120000); assert.equal(test.status, 'expected'); assert.equal(test.expectedStatus, 'passed'); assert.equal(test.results.length, 1);
    const result = test.results[0]; assert.equal(result.status, 'passed'); assert.equal(result.retry, 0); assert.deepEqual(result.errors, []);
    const attachment = name => {
      const matches = result.attachments.filter(value => value.name === name); assert.equal(matches.length, 1);
      const entry = matches[0]; assert.equal(entry.contentType, 'application/json'); assert.equal(typeof entry.body, 'string'); assert.ok(!entry.path);
      assert.ok(entry.body.length < 2 * 1024 * 1024); return JSON.parse(Buffer.from(entry.body, 'base64').toString('utf8'));
    };
    const geometry = attachment('JOIN组件校准后显示几何'), page = geometry.page, native = geometry.native;
    assert.deepEqual(page, { width: 1024, height: 680, devicePixelRatio: 1 });
    assert.deepEqual(native.contentSize, [1024, 680]); assert.equal(native.contentBounds.width, 1024); assert.equal(native.contentBounds.height, 680); assert.equal(native.zoom, 1);
    assert.equal(native.display.scaleFactor, 1); assert.equal(native.display.bounds.width, plan.mode.logicalWidth); assert.equal(native.display.bounds.height, plan.mode.logicalHeight);
    const area = native.display.workArea, bounds = native.bounds;
    for (const rect of [area, bounds]) for (const key of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(rect[key]));
    assert.ok(area.width >= keeperLimits.minimumVisibleWidth && area.height >= keeperLimits.minimumVisibleHeight);
    assert.ok(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
    const owner = attachment('JOIN组件原窗口收尾'), final = attachment('JOIN排序原生组件终态');
    assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0); assert.equal(typeof owner.directory, 'string');
    assert.equal(dirname(resolve(owner.directory)), resolve(tmpdir())); assert.match(basename(owner.directory), /^dbark-join-order-native-[a-zA-Z0-9]+$/);
    assert.ok(!pids.has(owner.pid) && !directories.has(owner.directory)); pids.add(owner.pid); directories.add(owner.directory);
    assert.equal(owner.accepted, true); assert.equal(owner.exitCode, 0); assert.equal(owner.signal, null); assert.equal(owner.forced, false); assert.equal(owner.directoryRetained, false);
    assert.equal(final.pid, owner.pid); assert.equal(final.directory, owner.directory); assert.equal(final.normalExit, true);
    assert.equal(final.mode, modes[index]); assert.equal(final.theme, modes[index].endsWith('light') ? 'light' : 'dark');
    for (const key of ['zeroDatabaseExecutions', 'zeroClipboardOperations', 'sourceDraftUnchanged']) assert.equal(final[key], true);
    assert.equal(final.newQueryCount, 1); assert.equal(final.originalGlobalLimit, 43); assert.equal(final.realDatabaseVerified, false);
    owners.push({ pid: owner.pid, directory: owner.directory });
  }
  return owners;
}

/** 每次只运行原固定入口一次；失败等待原命令终态，不重试、不kill应用、失败不恢复显示。 */
export async function runJoinKeeper() {
  requireJoinKeeperCI(process.argv.slice(2), process.platform, process.arch, process.env);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }), dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' });
  assert.equal(head.status, 0); assert.equal(head.stdout.trim(), process.env.GITHUB_SHA); assert.equal(dirty.status, 0); assert.equal(dirty.stdout.trim(), '');
  // Playwright会清空自己的output目录；租约日志必须放在并列目录，不能被原入口删除。
  const output = join(root, 'test-results/foreign-key-join-display-lease'); mkdirSync(output, { recursive: true });
  const journal = join(output, 'keeper.jsonl'); writeFileSync(journal, '', { flag: 'wx' });
  const nonce = randomBytes(32).toString('hex'), start = performance.now();
  let state = { nonce, seq: 0, last: start, deadline: start + keeperLimits.leaseSeconds * 1000, phase: 'starting', failed: false };
  let fault, ended = false, nativeRunning = false, nativeResult, proofs, reportHash, frame = Buffer.alloc(0), total = 0, readyResolve, readyReject;
  const ready = new Promise((yes, no) => { readyResolve = yes; readyReject = no; }); void ready.catch(() => {});
  const keeper = spawn(join(root, '.cache/foreign-key-join-keeper/keeper'), ['--hold', '600', nonce], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
  const current = () => { assert.ok(!fault && !ended && performance.now() < state.deadline, '原显示租约已失效'); };
  const retain = reason => {
    if (fault) return; fault = reason; state = { ...state, failed: true }; readyReject(Error(reason));
    if (!ended && !keeper.stdin.destroyed) keeper.stdin.write(JSON.stringify({ action: 'retain', nonce }) + '\n');
  };
  keeper.stdin.on('error', () => retain('keeper输入通道失败')); keeper.on('error', () => retain('keeper启动失败'));
  const exited = new Promise(done => keeper.once('close', (code, signal) => {
    ended = true; if (nativeRunning || state.phase !== 'restored' || code !== 0 || signal !== null) retain('keeper在完整证明与恢复之前退出'); done({ code, signal });
  }));
  keeper.stdout.on('data', chunk => {
    try {
      total += chunk.length; assert.ok(total <= 8 * 1024 * 1024); appendFileSync(journal, chunk); frame = Buffer.concat([frame, chunk]); assert.ok(frame.length <= 2 * 1024 * 1024);
      for (let end; (end = frame.indexOf(10)) >= 0;) {
        const line = frame.subarray(0, end); frame = frame.subarray(end + 1); if (fault) continue;
        const event = JSON.parse(line.toString('utf8')); state = acceptKeeperEvent(state, event, performance.now());
        if (event.type === 'inventory') {
          const plan = selectModeCandidate(event.snapshot); state = { ...state, plan, original: event.snapshot.displays[0], phase: 'selected' };
          writeFileSync(join(output, 'plan.json'), JSON.stringify({ inventory: event.snapshot, plan }, null, 2) + '\n', { flag: 'wx' });
          keeper.stdin.write(JSON.stringify({ action: 'apply', nonce, modeID: plan.mode.modeID }) + '\n');
        } else if (event.type === 'ready') readyResolve();
      }
    } catch { retain('keeper原帧、空间或日志证明失败'); }
  });
  let timer, stage = '显示准备';
  try {
    await Promise.race([ready, new Promise((_, no) => { timer = setTimeout(() => no(Error('原15秒显示准备未完成')), 15000); })]); clearTimeout(timer); current();
    stage = '原JOIN命令'; nativeRunning = true;
    const child = spawn(process.execPath, ['scripts/foreign-key-join-ci.mjs'], { cwd: root, env: process.env, stdio: 'inherit', shell: false });
    nativeResult = await new Promise(done => { child.once('error', () => done({ code: null, signal: '启动失败' })); child.once('close', (code, signal) => done({ code, signal })); });
    nativeRunning = false; current(); assert.equal(nativeResult.code, 0); assert.equal(nativeResult.signal, null);
    stage = '原十二例报告'; const bytes = readFileSync(join(root, 'test-results/foreign-key-join/report.json')); assert.ok(bytes.length <= 20 * 1024 * 1024);
    proofs = requireJoinKeeperReport(JSON.parse(bytes.toString('utf8')), state.plan); reportHash = createHash('sha256').update(bytes).digest('hex');
    stage = '原目录与PID'; for (const owner of proofs) {
      current(); assert.equal(existsSync(owner.directory), false, '原成功用例目录尚存在');
      let absent = false; try { process.kill(owner.pid, 0); } catch (error) { if (error?.code !== 'ESRCH') throw error; absent = true; }
      assert.equal(absent, true, '原App PID尚存在或状态未知');
    }
    current(); stage = '原模式恢复'; state = { ...state, phase: 'releasing' }; keeper.stdin.write(JSON.stringify({ action: 'release', nonce }) + '\n');
  } catch { retain(stage + '未闭合'); }
  finally { clearTimeout(timer); }
  const result = await exited;
  const accepted = !fault && proofs?.length === 12 && state.phase === 'restored' && result.code === 0 && result.signal === null;
  writeFileSync(join(output, 'receipt.json'), JSON.stringify({ accepted, fault: fault ?? null, head: process.env.GITHUB_SHA, nativeResult: nativeResult ?? null, keeper: result, reportSha256: reportHash ?? null, proofs: proofs ?? [], leaseSeconds: 600, modeScope: 'forSession', normalRestoreObservedBeforeKeeperExit: state.phase === 'restored', postKeeperExitRestoreObserved: false, artifactUploadConfirmed: false, applicationForceStop: false, nativeOriginalAssertionsUnchanged: true }, null, 2) + '\n', { flag: 'wx' });
  if (!accepted) throw Error('JOIN显示租约、原十二例或恢复证据未闭合，原失败保留');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runJoinKeeper().catch(error => { console.error(error.message); process.exitCode = 1; });
