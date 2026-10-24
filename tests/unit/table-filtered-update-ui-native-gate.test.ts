import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertTableFilteredUpdateUiEnvironment, bindTableFilteredUpdateUiEnvironment, tableFilteredUpdateUiFixture, tableFilteredUpdateUiConflictFiles, tableFilteredUpdateUiConflictRequest, parseTableFilteredUpdateUiConflictAck } from '../helpers/tableFilteredUpdateUi';

const source = readFileSync(new URL('../e2e/table-filtered-update.spec.ts', import.meta.url), 'utf8');
/** 真实spec在RAM转译，所有未获门控的helper/live/桌面/驱动读取均立即失败。 */
function fixture(values: NodeJS.ProcessEnv = {}, args: string[] = [], forbidReads = false, active = false) {
  const modules: string[] = [], reads: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (forbidReads || !active && !['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_FILTERED_UPDATE_UI_TEST'].includes(key)) throw Error('默认/list读取了认证或资源'); return target[key]; } });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: { env, argv: ['node', 'playwright', ...args], platform: 'win32' },
    require(name: string) { modules.push(name); if (name === '@playwright/test') return { test: { skip } }; if (active && name === '../helpers/tableFilteredUpdateUi') return { bindTableFilteredUpdateUiEnvironment }; if (active && name === './table-filtered-update-live') return { registerTableFilteredUpdateUiTests: register }; throw Error('默认/list加载了资源模块：' + name); },
  });
  return { modules, reads, skip, register };
}

/** 只构造合成RAM认证；不读取实际进程环境，不分配任何外部资源。 */
function environment(): NodeJS.ProcessEnv {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_FILTERED_UPDATE_UI_TEST: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成用户', DBARK_TEST_PASSWORD: '', DBARK_TEST_DATABASE: 'dbark_filteredupdateui_' + 'a'.repeat(32), DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001', DBARK_TABLE_FILTERED_UPDATE_UI_OWNER: 'dbark-table-filtered-update-ui:' + 'b'.repeat(32), DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST: 'D:/isolated/source.json', DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST_SHA256: 'c'.repeat(64), DBARK_TABLE_FILTERED_UPDATE_UI_OUTPUT: 'D:/isolated/output' };
}

describe('全部筛选行填充正式源码窗口默认关闭门（纯RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_TABLE_FILTERED_UPDATE_UI_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_FILTERED_UPDATE_UI_TEST: 'true' }])('缺双门只登记跳过：%j', values => { const current = fixture(values); expect(current.skip).toHaveBeenCalledOnce(); expect(current.modules).toEqual(['@playwright/test']); });
  it.each(['list', '--list', '--list=true'])('%s早于所有环境和资源模块读取', flag => { const current = fixture(environment(), [flag], true); expect(current.skip).toHaveBeenCalledOnce(); expect(current.reads).toEqual([]); expect(current.modules).toEqual(['@playwright/test']); });
  it('准确双门只捕获绑定并注册live，不执行资源操作', () => { const current = fixture(environment(), ['--trace=off'], false, true); expect(current.skip).not.toHaveBeenCalled(); expect(current.modules).toEqual(['@playwright/test', '../helpers/tableFilteredUpdateUi', './table-filtered-update-live']); expect(current.register).toHaveBeenCalledOnce(); });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TABLE_FILTERED_UPDATE_UI_OWNER', 'DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST', 'DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST_SHA256', 'DBARK_TABLE_FILTERED_UPDATE_UI_OUTPUT'])('拒绝错误目标或批准来源：%s', key => { expect(() => assertTableFilteredUpdateUiEnvironment({ ...environment(), [key]: 'other' }, [], 'win32')).toThrow(); });
  it.each(['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'])('替代环境即使空值仍拒绝：%s', key => { expect(() => assertTableFilteredUpdateUiEnvironment({ ...environment(), [key]: '' }, [], 'win32')).toThrow(); });
  it.each([['--trace=on'], ['--trace', 'retain-on-failure'], ['--config=other.ts'], ['-cother.ts'], ['--ui'], ['--debug']].map(args => ({ args })))('拒绝CLI绕行：$args', ({ args }) => { expect(() => assertTableFilteredUpdateUiEnvironment(environment(), args, 'win32')).toThrow(); });
  it('非Windows、缺认证和环境大小写别名拒绝', () => { expect(() => assertTableFilteredUpdateUiEnvironment(environment(), [], 'darwin')).toThrow(); for (const change of [{ DBARK_TEST_USER: '' }, { DBARK_TEST_PASSWORD: undefined }, { dbark_test_host: 'other' }]) expect(() => assertTableFilteredUpdateUiEnvironment({ ...environment(), ...change }, [], 'win32')).toThrow(); });
  it('目标、argv和键存在性漂移永久停链，恢复原值不能复活', () => {
    for (const kind of ['target', 'argv', 'key']) { const env = environment(), args: string[] = [], binding = bindTableFilteredUpdateUiEnvironment(() => ({ env, args, platform: 'win32' })); binding.assertCurrent(); if (kind === 'target') env.DBARK_TEST_PORT = '3306'; else if (kind === 'argv') args.push('--workers=2'); else env.DBARK_TABLE_FILTERED_UPDATE_UI_EXTRA = ''; expect(() => binding.assertCurrent()).toThrow(); env.DBARK_TEST_PORT = '13384'; args.length = 0; delete env.DBARK_TABLE_FILTERED_UPDATE_UI_EXTRA; expect(() => binding.assertCurrent()).toThrow(); }
  });
  it('81行独立期望准确61匹配、第二页11行；并发仅改变不可见的第31个匹配原行', () => {
    const env = environment(), plan = tableFilteredUpdateUiFixture(env.DBARK_TEST_DATABASE!, env.DBARK_TABLE_FILTERED_UPDATE_UI_OWNER!);
    expect(plan.expectedInitial).toHaveLength(81); expect(plan.expectedAfterFill).toHaveLength(81); expect(plan.expectedAfterConflict).toHaveLength(81); expect(plan.expectedFilteredIds).toHaveLength(61); expect(plan.expectedSecondPageIds).toHaveLength(11);
    expect(plan.expectedFilteredIds[0]).toBe('9007199254741053'); expect(plan.expectedFilteredIds[30]).toBe('9007199254740993'); expect(plan.expectedSecondPageIds[0]).toBe('9007199254741014'); expect(plan.expectedSecondPageIds.at(-1)).toBe('9007199254740994'); expect(plan.expectedSecondPageIds).not.toContain(plan.conflict.id);
    expect(plan.filters[3]).toEqual({ column: 'amount', operator: '>', value: '999999999999999999.999999', enabled: false }); expect(plan.filterGroup).toEqual({ mode: 'all', children: [2, 3, { mode: 'any', children: [0, 1] }] }); expect(plan.sort).toEqual([{ column: 'label', direction: 'ASC' }, { column: 'id', direction: 'DESC' }]);
    expect(plan.expectedAfterFill.slice(61)).toEqual(plan.expectedInitial.slice(61)); expect(plan.expectedAfterConflict.slice(1)).toEqual(plan.expectedAfterFill.slice(1)); expect(plan.expectedAfterConflict[0].noteHex).toBe(Buffer.from('Root并发修改').toString('hex').toUpperCase());
    for (const [index, original] of plan.expectedInitial.entries()) { expect({ ...plan.expectedAfterFill[index], noteHex: original.noteHex }).toEqual(original); expect({ ...plan.expectedAfterConflict[index], noteHex: original.noteHex }).toEqual(original); }
    expect(plan.expectedInitial[4].amount).toBeNull(); expect(plan.expectedInitial[0].amount).toBe('123456789012345678.000001'); expect(plan.expectedInitial[0].payloadHex).toBe('00FF01'); expect(plan.expectedInitial.at(-1)?.payloadHex).toBe('00FF51');
    expect(plan.conflict.parameters).toEqual(['Root并发修改', '9007199254740993', '跨页整批新值']); expect(plan.conflict.affectedRows).toBe(1); expect(plan.conflict.sql).toBe('UPDATE `' + env.DBARK_TEST_DATABASE + '`.`subject` SET note = ? WHERE id = CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED) AND BINARY note = BINARY ?'); expect(plan.rowSql).toContain(' ORDER BY `' + env.DBARK_TEST_DATABASE + '`.`subject`.`id` ASC'); expect(() => tableFilteredUpdateUiFixture('business', plan.marker)).toThrow();
  });
});

describe('全部筛选行填充Root唯一CAS交接（纯RAM）', () => {
  const env = environment(), token = '00000000-0000-0000-0000-000000000002', digest = 'd'.repeat(64), request = tableFilteredUpdateUiConflictRequest(env.DBARK_TEST_DATABASE!, env.DBARK_TABLE_FILTERED_UPDATE_UI_OWNER!, token);
  const ack = () => ({ ...request, requestSha256: digest, affectedRows: 1, controlThreadId: 8 });
  it('只准准确两个JSON及两个发布临时名，成功ACK绑定原摘要和不同控制线程', () => { expect(tableFilteredUpdateUiConflictFiles).toEqual({ request: 'conflict-request.json', ack: 'conflict-ack.json', requestTemporary: 'conflict-request.json.dbark-test.partial', ackTemporary: 'conflict-ack.json.dbark-root.partial' }); expect(request).toEqual({ owner: env.DBARK_TABLE_FILTERED_UPDATE_UI_OWNER, database: env.DBARK_TEST_DATABASE, previewToken: token }); expect(parseTableFilteredUpdateUiConflictAck(ack(), request, digest, 7)).toEqual(ack()); });
  it.each(['owner', 'database', 'previewToken', 'requestSha256', 'affectedRows', 'controlThreadId'])('回执%s缺失、改变或额外SQL均拒绝', key => { const missing = { ...ack() } as Record<string, unknown>; delete missing[key]; expect(() => parseTableFilteredUpdateUiConflictAck(missing, request, digest, 7)).toThrow(); expect(() => parseTableFilteredUpdateUiConflictAck({ ...ack(), [key]: key === 'affectedRows' ? 0 : key === 'controlThreadId' ? 7 : 'other' }, request, digest, 7)).toThrow(); expect(() => parseTableFilteredUpdateUiConflictAck({ ...ack(), sql: 'UPDATE business.private' }, request, digest, 7)).toThrow(); });
  it('访问器、继承、隐藏字段及错误原摘要不能变成授权证明', () => {
    let reads = 0; const accessor = { ...ack() }; Object.defineProperty(accessor, 'owner', { enumerable: true, get() { reads++; return request.owner; } }); expect(() => parseTableFilteredUpdateUiConflictAck(accessor, request, digest, 7)).toThrow(); expect(reads).toBe(0);
    const hidden = { ...ack() }; Object.defineProperty(hidden, 'owner', { value: request.owner, enumerable: false }); expect(() => parseTableFilteredUpdateUiConflictAck(hidden, request, digest, 7)).toThrow(); expect(() => parseTableFilteredUpdateUiConflictAck(Object.assign(Object.create(ack()), {}), request, digest, 7)).toThrow(); expect(() => parseTableFilteredUpdateUiConflictAck(ack(), request, 'e'.repeat(64), 7)).toThrow(); expect(() => tableFilteredUpdateUiConflictRequest('business', request.owner, token)).toThrow();
  });
});
