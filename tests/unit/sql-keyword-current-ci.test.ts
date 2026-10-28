import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 只导入真实新消费者，CLI guard不触发；不运行构建、Playwright、端口或系统工具。
const runner: any = await import(new URL('../../scripts/sql-keyword-current-ci.mjs', import.meta.url).href);
const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

/** 与新工作流身份一一对应，测试中的架构参数只送入纯函数，不冒充真实Mac执行。 */
function environment() { return {
  GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'zhao-yc/DBArk', GITHUB_REF: 'refs/heads/main', GITHUB_JOB: 'keyword-current-arm64',
  GITHUB_WORKFLOW_REF: 'zhao-yc/DBArk/.github/workflows/sql-keyword-current.yml@refs/heads/main', GITHUB_WORKFLOW_SHA: 'a'.repeat(40),
  GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'push',
  KEYWORD_CURRENT_RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'macOS', RUNNER_ARCH: 'ARM64',
}; }

/** 原两例的公开合成附件只用于拒绝不完整报告，不充当实际原生验收原件。 */
function report() { return { errors: [], suites: [{ specs: ['upper', 'lower'].map(restoredCase => ({ file: 'sql-keyword-case-native.spec.ts', ok: true, tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [], attachments: [{ name: '关键字原生终态', contentType: 'application/json', body: Buffer.from(JSON.stringify({ accepted: true, restoredCase, schema: 9, restart: { activeTabId: '公开合成查询', paneIndex: 0, editor: 1, model: 2 }, owners: [0, 1].map(() => ({ confirmed: true, willQuit: true, closed: true, recordedPids: 3 })), lateModule: { held: 1, delivered: 1, detached: true, failed: false, contextRoundTrip: true }, directoryRemoved: true, systemClipboard: 0, sqlExecution: 0 })).toString('base64') }] }] }] })) }] }; }

describe('当前源码关键字arm64专项上下文和原报告边界', () => {
  it('只接受main首轮托管原生arm64精确job，push与手动新运行使用同一门', () => {
    expect(() => runner.requireKeywordCurrentCI(['source'], 'darwin', 'arm64', environment())).not.toThrow();
    expect(() => runner.requireKeywordCurrentCI(['source'], 'darwin', 'arm64', { ...environment(), GITHUB_EVENT_NAME: 'workflow_dispatch' })).not.toThrow();
  });
  it.each([
    { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_REF: 'refs/heads/codex/old' }, { GITHUB_JOB: 'desktop' },
    { GITHUB_WORKFLOW_REF: 'zhao-yc/DBArk/.github/workflows/v028-keyword-native.yml@refs/heads/main' },
    { GITHUB_WORKFLOW_SHA: 'b'.repeat(40) }, { GITHUB_REPOSITORY: 'other/DBArk' }, { RUNNER_ARCH: 'X64' },
    { RUNNER_OS: 'Linux' }, { KEYWORD_CURRENT_RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_SHA: 'main' }, { GITHUB_RUN_ID: '' },
  ])('拒绝跨job/旧准许/自动重跑或未知平台：%j', patch => {
    expect(() => runner.requireKeywordCurrentCI(['source'], 'darwin', 'arm64', { ...environment(), ...patch })).toThrow();
  });
  it.each([[], ['--list'], ['source', '--list'], ['installed'], ['source', '--retry'], ['source', 'source']].map(args => ({ args })))('参数$args在资源访问前被纯门拒绝', ({ args }) => {
    expect(() => runner.requireKeywordCurrentCI(args, 'darwin', 'arm64', environment())).toThrow();
  });
  it.each([['win32', 'x64'], ['linux', 'arm64'], ['darwin', 'x64']])('实际%s/%s不能被环境字段伪装为arm64', (platform, arch) => {
    expect(() => runner.requireKeywordCurrentCI(['source'], platform, arch, environment())).toThrow();
  });
  it('父环境认证/旧门/renderer/Node和动态注入均被清掉，只保桌面必需白名单', () => {
    const env = runner.keywordCurrentEnvironment({ PATH: '/public/bin', HOME: '/public/runner', TMPDIR: '/public/tmp', DISPLAY: ':0', CI: 'true', DBARK_INTEGRATION_ENABLED: '1', DBARK_TEST_PASSWORD: '合成秘密', DBARK_SQL_KEYWORD_CASE_NATIVE_TEST: '1', DBARK_EDITOR_INDENT_NATIVE_TEST: '1', DBARK_DEV_URL: 'https://invalid.example', NODE_OPTIONS: '--require=bad', node_path: 'bad', ELECTRON_RUN_AS_NODE: '1', DYLD_INSERT_LIBRARIES: 'bad', LD_PRELOAD: 'bad', GH_TOKEN: '合成令牌', SSL_CERT_FILE: '私有路径', GITHUB_TOKEN: '合成令牌' });
    expect(env).toEqual({ PATH: '/public/bin', HOME: '/public/runner', TMPDIR: '/public/tmp', DISPLAY: ':0', CI: 'true' });
  });
  it('精确运行原spec且单worker/零重试/120秒/无trace，不含其它专项或安装入口', () => {
    const args = runner.keywordCurrentArguments('/public/project', '/public/evidence');
    expect(args).toEqual([join('/public/project', 'node_modules/@playwright/test/cli.js'), 'test', 'tests/e2e/sql-keyword-case-native.spec.ts', '--workers=1', '--retries=0', '--timeout=120000', '--trace=off', '--reporter=list,json', '--output=' + join('/public/evidence', 'attachments')]);
  });
  it('原两例/四owner齐备且进程exit0才通过，绿色报告不能覆盖非零或未知退出', () => {
    expect(runner.assertKeywordCurrentRun({ status: 0 }, report())).toHaveLength(2);
    for (const result of [{ status: 1 }, { status: null, signal: 'SIGABRT' }, { status: 0, error: Error('原spawn失败') }]) expect(() => runner.assertKeywordCurrentRun(result, report())).toThrow();
  });
  it.each(['retry', 'missing-owner', 'schema', 'late', 'restart', 'one-case'])('原消费者拒绝%s缺口，不补造证明', kind => {
    const value = report(), result = value.suites[0].specs[0].tests[0].results[0];
    if (kind === 'retry') result.retry = 1;
    else if (kind === 'one-case') value.suites[0].specs.pop();
    else {
      const attachment = result.attachments[0], proof = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
      if (kind === 'missing-owner') proof.owners.pop(); if (kind === 'schema') proof.schema = 8; if (kind === 'late') proof.lateModule.delivered = 0; if (kind === 'restart') proof.restart.activeTabId = '';
      attachment.body = Buffer.from(JSON.stringify(proof)).toString('base64');
    }
    expect(() => runner.assertKeywordCurrentRun({ status: 0 }, value)).toThrow();
  });
});

describe('首轮进程原件保留，RAM端口不启动子进程', () => {
  it.each([{ status: 1, signal: null }, { status: null, signal: 'SIGABRT' }])('完整stdout/stderr及%s状态独占写入，重复不能覆盖', terminal => {
    const parent = resolve('.cache/sql-keyword-current-unit'); mkdirSync(parent, { recursive: true }); const directory = mkdtempSync(join(parent, '公开-')); directories.push(directory);
    const execute = vi.fn((_binary: string, _args: string[], options: any) => { writeFileSync(options.stdio[1], '原stdout中文\n'); writeFileSync(options.stdio[2], '原stderr未知终态\n'); return terminal; });
    const result = runner.recordedKeywordCurrentCommand(directory, 'playwright', '/public/node', ['original'], { cwd: '/public/project', env: {} }, execute);
    expect(result).toMatchObject({ ...terminal, stdout: '原stdout中文\n', stderr: '原stderr未知终态\n' }); expect(execute).toHaveBeenCalledOnce();
    const options = execute.mock.calls[0][2]; expect(options).not.toHaveProperty('timeout'); expect(options).not.toHaveProperty('killSignal'); expect(options).not.toHaveProperty('shell');
    const original = readFileSync(join(directory, 'playwright.process.json')); expect(JSON.parse(original.toString('utf8'))).toEqual({ ...terminal, errorCode: null, automaticRetry: false, automaticForceStop: false });
    expect(() => runner.recordedKeywordCurrentCommand(directory, 'playwright', '/public/node', [], {}, execute)).toThrow(); expect(execute).toHaveBeenCalledOnce(); expect(readFileSync(join(directory, 'playwright.process.json'))).toEqual(original); expect(existsSync(join(directory, 'accepted.json'))).toBe(false);
  });
  it('同步启动异常仍保原错误码与空日志，不重试或强停', () => {
    const parent = resolve('.cache/sql-keyword-current-unit'); mkdirSync(parent, { recursive: true }); const directory = mkdtempSync(join(parent, '异常-')); directories.push(directory);
    const execute = vi.fn(() => { throw Object.assign(Error('合成原spawn异常'), { code: 'ENOMEM' }); });
    const value = runner.recordedKeywordCurrentCommand(directory, 'playwright', '/public/node', [], {}, execute);
    expect(value.status).toBeNull(); expect(JSON.parse(readFileSync(join(directory, 'playwright.process.json'), 'utf8'))).toMatchObject({ status: null, signal: null, errorCode: 'ENOMEM', automaticForceStop: false }); expect(execute).toHaveBeenCalledOnce();
  });
});
