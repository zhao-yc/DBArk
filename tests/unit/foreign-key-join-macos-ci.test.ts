import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const runner: any = await import(new URL('../../scripts/foreign-key-join-macos-ci.mjs', import.meta.url).href);
const original: any = await import(new URL('../../scripts/macos-mode-keeper-ci.mjs', import.meta.url).href);
const env = { GITHUB_ACTIONS: 'true', MODE_KEEPER_RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: 'zhao-yc/tabrelio', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: 'zhao-yc/tabrelio/.github/workflows/foreign-key-join.yml@refs/heads/main', GITHUB_JOB: 'join-components', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '1' };
const modes = ['dark', 'light', 'filter-dark', 'filter-light', 'group-dark', 'group-light', 'summary-dark', 'summary-light', 'having-dark', 'having-light', 'distinct-dark', 'distinct-light'];
const plan = { mode: { logicalWidth: 1600, logicalHeight: 1200 } };
/** 合成报告只供纯协议验收；不构建Swift、不访问显示器、PID或目录。 */
function fixture() {
  const attach = (name: string, value: unknown) => ({ name, contentType: 'application/json', body: Buffer.from(JSON.stringify(value)).toString('base64') });
  return { config: { workers: 1 }, errors: [], stats: { expected: 12, unexpected: 0, skipped: 0, flaky: 0 }, suites: [{ specs: modes.map((mode, index) => {
    const pid = 1000 + index, directory = join(tmpdir(), 'dbark-join-order-native-TEST' + index);
    return { title: 'JOIN真实菜单、双侧排序、上限及独立草稿：' + mode, ok: true, tests: [{ timeout: 120000, status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed', retry: 0, errors: [], attachments: [
      attach('JOIN组件校准后显示几何', { page: { width: 1024, height: 680, devicePixelRatio: 1 }, native: { bounds: { x: 250, y: 100, width: 1024, height: 712 }, contentBounds: { x: 250, y: 132, width: 1024, height: 680 }, contentSize: [1024, 680], zoom: 1, display: { scaleFactor: 1, bounds: { x: 0, y: 0, width: 1600, height: 1200 }, workArea: { x: 0, y: 31, width: 1600, height: 1091 } } } }),
      attach('JOIN组件原窗口收尾', { pid, directory, accepted: true, exitCode: 0, signal: null, forced: false, directoryRetained: false }),
      attach('JOIN排序原生组件终态', { pid, directory, mode, theme: mode.endsWith('light') ? 'light' : 'dark', normalExit: true, zeroDatabaseExecutions: true, zeroClipboardOperations: true, sourceDraftUnchanged: true, newQueryCount: 1, originalGlobalLimit: 43, realDatabaseVerified: false }),
    ] }] }] };
  }) }] };
}
/** 修改已编码原附件以覆盖实际协议失败形态，不直接伪造测试调用的返回值。 */
function changeAttachment(report: ReturnType<typeof fixture>, index: number, mutate: (value: any) => void) {
  const entry = report.suites[0].specs[0].tests[0].results[0].attachments[index], value = JSON.parse(Buffer.from(entry.body, 'base64').toString('utf8'));
  mutate(value); entry.body = Buffer.from(JSON.stringify(value)).toString('base64');
}

describe('JOIN临时显示租约准确上下文', () => {
  it.each(['push', 'workflow_dispatch'])('仅准确main托管arm64的%s准入', event => expect(() => runner.requireJoinKeeperCI([], 'darwin', 'arm64', { ...env, GITHUB_EVENT_NAME: event })).not.toThrow());
  it.each([
    { GITHUB_ACTIONS: 'false' }, { MODE_KEEPER_RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_REPOSITORY: 'other/DBArk' },
    { GITHUB_REF: 'refs/pull/1/merge' }, { GITHUB_REF: 'refs/heads/other' }, { GITHUB_JOB: 'desktop' },
    { GITHUB_WORKFLOW_REF: 'zhao-yc/tabrelio/.github/workflows/ci.yml@refs/heads/main' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_SHA: 'a'.repeat(39) }, { GITHUB_RUN_ID: '../other' }, { GITHUB_RUN_ATTEMPT: '0' },
    { DBARK_TEST_PASSWORD: '' }, { DBARK_USER_DATA: '' }, { NODE_OPTIONS: '' }, { NODE_PATH: '' }, { DYLD_INSERT_LIBRARIES: '' },
  ])('外来上下文或模块注入拒绝：%j', change => expect(() => runner.requireJoinKeeperCI([], 'darwin', 'arm64', { ...env, ...change })).toThrow());
  it('Windows、Intel和任意参数拒绝，旧源码/安装入口不借新JOIN上下文放行', () => {
    expect(() => runner.requireJoinKeeperCI([], 'win32', 'arm64', env)).toThrow(); expect(() => runner.requireJoinKeeperCI([], 'darwin', 'x64', env)).toThrow(); expect(() => runner.requireJoinKeeperCI(['other-command'], 'darwin', 'arm64', env)).toThrow();
    expect(() => original.requireKeeperCI(['source'], 'darwin', 'arm64', env)).toThrow(); expect(() => original.requireInstalledKeeperCI(['installed'], 'darwin', 'arm64', env)).toThrow();
  });
});

describe('原十二例真实几何与资源证明', () => {
  it('仅完整十二例和足够原生工作区返回准确owner，纯函数不配置系统', () => {
    const owners = runner.requireJoinKeeperReport(fixture(), plan); expect(owners).toHaveLength(12); expect(owners[0]).toEqual({ pid: 1000, directory: join(tmpdir(), 'dbark-join-order-native-TEST0') });
  });
  it.each(['missing', 'repeat', 'skip', 'retry', 'timeout', 'errors', 'wrong-mode', 'attachment-path', 'duplicate-attachment'])('原报告%s不能被当作成功', action => {
    const report = fixture(), spec = report.suites[0].specs[0], test = spec.tests[0], result = test.results[0];
    if (action === 'missing') report.suites[0].specs.pop();
    if (action === 'repeat') test.results.push(structuredClone(result));
    if (action === 'skip') result.status = 'skipped';
    if (action === 'retry') result.retry = 1;
    if (action === 'timeout') test.timeout = 130000;
    if (action === 'errors') report.stats.unexpected = 1;
    if (action === 'wrong-mode') spec.title = report.suites[0].specs[1].title;
    if (action === 'attachment-path') Object.assign(result.attachments[0], { path: '/other.json' });
    if (action === 'duplicate-attachment') result.attachments.push(structuredClone(result.attachments[0]));
    expect(() => runner.requireJoinKeeperReport(report, plan)).toThrow();
  });
  it.each(['small-css', 'small-native', 'zoom', 'dpi', 'small-area', 'offscreen', 'wrong-display'])('显示%s不能替代原1024×680客户区', action => {
    const report = fixture(); changeAttachment(report, 0, value => {
      if (action === 'small-css') value.page.height = 642;
      if (action === 'small-native') value.native.contentSize[1] = 642;
      if (action === 'zoom') value.native.zoom = 0.9;
      if (action === 'dpi') value.page.devicePixelRatio = 2;
      if (action === 'small-area') value.native.display.workArea.height = 677;
      if (action === 'offscreen') value.native.bounds.y = -1;
      if (action === 'wrong-display') value.native.display.bounds.width = 1920;
    }); expect(() => runner.requireJoinKeeperReport(report, plan)).toThrow();
  });
  it.each(['not-accepted', 'signal', 'forced', 'retained', 'outside', 'same-pid', 'same-directory', 'wrong-final', 'write', 'clipboard'])('资源或业务%s不能放行恢复', action => {
    const report = fixture(); changeAttachment(report, action === 'wrong-final' || action === 'write' || action === 'clipboard' ? 2 : 1, value => {
      if (action === 'not-accepted') value.accepted = false;
      if (action === 'signal') value.signal = 'SIGTERM';
      if (action === 'forced') value.forced = true;
      if (action === 'retained') value.directoryRetained = true;
      if (action === 'outside') value.directory = join(tmpdir(), '..', 'dbark-join-order-native-escape');
      if (action === 'same-pid') value.pid = 1001;
      if (action === 'same-directory') value.directory = join(tmpdir(), 'dbark-join-order-native-TEST1');
      if (action === 'wrong-final') value.pid = 9999;
      if (action === 'write') value.zeroDatabaseExecutions = false;
      if (action === 'clipboard') value.zeroClipboardOperations = false;
    }); expect(() => runner.requireJoinKeeperReport(report, plan)).toThrow();
  });
});
