import { describe, expect, it } from 'vitest';
import { bindEditorIndentNativeCase, type IndentNativeTestInfo } from '../e2e/editor-indentation-native-gate';

/** 只使用RAM身份和时钟，失败后不创建目录、启动桌面或重新授权。 */
function fixture(start = 100, timeout = 120000) {
  const info: IndentNativeTestInfo = { _startWallTime: start, timeout, status: 'passed' };
  let clock = 101, current = info;
  const scope = bindEditorIndentNativeCase(info, { assertCurrent() {} }, () => current, () => clock);
  return { info, scope, clock: (value: number) => { clock = value; }, current: (value: IndentNativeTestInfo) => { current = value; } };
}

describe('原生TestInfo守卫失败诊断（不改变授权条件）', () => {
  it.each([
    ['retained', (value: ReturnType<typeof fixture>) => value.scope.retain()],
    ['different-info', (value: ReturnType<typeof fixture>) => value.current({ ...value.info })],
    ['start-field-changed', (value: ReturnType<typeof fixture>) => { delete value.info._startWallTime; }],
    ['start-object-changed', (value: ReturnType<typeof fixture>) => { value.info.startTime = new Date(100); }],
    ['start-value-changed', (value: ReturnType<typeof fixture>) => { value.info._startWallTime = 102; }],
    ['timeout-changed', (value: ReturnType<typeof fixture>) => { value.info.timeout = 240000; }],
    ['invalid-clock', (value: ReturnType<typeof fixture>) => value.clock(NaN)],
    ['before-start', (value: ReturnType<typeof fixture>) => value.clock(99)],
    ['clock-reversed', (value: ReturnType<typeof fixture>) => value.clock(100)],
    ['deadline', (value: ReturnType<typeof fixture>) => value.clock(120100)],
    ['status', (value: ReturnType<typeof fixture>) => { value.info.status = 'failed'; }],
  ] as const)('准确记录首个失败分支%s，修复输入也不能复活', (branch, change) => {
    const value = fixture();
    change(value);
    expect(() => value.scope.assertCurrent()).toThrow(`分支=${branch}；`);
    value.info._startWallTime = 100; value.info.startTime = undefined; value.info.timeout = 120000; value.info.status = 'passed'; value.clock(102); value.current(value.info);
    expect(() => value.scope.assertCurrent()).toThrow('分支=retained；');
  });

  it('保留原起点和120秒检查的先后顺序，不把异常输入归因为到期', () => {
    const original = fixture(100, 240000);
    expect(() => original.scope.assertCurrent()).toThrow('分支=original-timeout；');
    const invalid = fixture(Infinity);
    expect(() => invalid.scope.assertCurrent()).toThrow('分支=invalid-start；');
    const missing: IndentNativeTestInfo = { timeout: 120000 };
    expect(() => bindEditorIndentNativeCase(missing, { assertCurrent() {} }, () => missing, () => 0).assertCurrent()).toThrow('分支=start-value-changed；');
  });

  it('失败消息只含固定分支和已捕获时钟，不重新读取身份/状态或泄露TestInfo内容', () => {
    const info: IndentNativeTestInfo = { _startWallTime: 100, timeout: 120000 };
    let statusReads = 0, currentReads = 0;
    Object.defineProperty(info, 'status', { get() { statusReads++; return '秘密哨兵'; } });
    Object.defineProperty(info, 'title', { get() { throw Error('不得读取标题或任意附加信息'); } });
    const scope = bindEditorIndentNativeCase(info, { assertCurrent() {} }, () => { currentReads++; return info; }, () => 101);
    let failure: unknown;
    try { scope.assertCurrent(); } catch (reason) { failure = reason; }
    expect((failure as Error).message).toBe('缩进原生专项原TestInfo/期限已失效，保留资源；分支=status；start=100；instant=101；previous=101；deadline=120100');
    expect(statusReads).toBe(2); expect(currentReads).toBe(1);
    expect(() => scope.assertCurrent()).toThrow('分支=retained；');
    expect(statusReads).toBe(2); expect(currentReads).toBe(1);
  });

  it('保留环境异常原对象，随后永久拒绝；诊断不能吞掉上游错误', () => {
    const original = Error('环境原始错误');
    let broken = true;
    const info = { _startWallTime: 100, timeout: 120000 };
    const scope = bindEditorIndentNativeCase(info, { assertCurrent() { if (broken) throw original; } }, () => info, () => 101);
    let failure: unknown;
    try { scope.assertCurrent(); } catch (reason) { failure = reason; }
    expect(failure).toBe(original); broken = false;
    expect(() => scope.assertCurrent()).toThrow('分支=retained；');
  });

  it.each([undefined, 'passed'])('成功路径保持属性读取顺序与次数，status=%s', status => {
    const reads: string[] = [], original = { _startWallTime: 100, startTime: undefined, timeout: 120000, status };
    const info = new Proxy(original, { get(target, key, receiver) { reads.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); }, getOwnPropertyDescriptor(target, key) { reads.push(`own:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); } });
    const scope = bindEditorIndentNativeCase(info, { assertCurrent() { reads.push('environment'); } }, () => { reads.push('current'); return info; }, () => { reads.push('clock'); return 101; });
    reads.length = 0; scope.assertCurrent();
    expect(reads).toEqual(['environment', 'clock', 'current', 'own:_startWallTime', 'get:startTime', 'get:_startWallTime', 'get:_startWallTime', 'get:timeout', 'get:status', ...(status === undefined ? [] : ['get:status'])]);
  });

  it('失败顺序不访问后续会抛错的getter，Date起点仍比较原对象与毫秒值', () => {
    const info: IndentNativeTestInfo = { startTime: new Date(100), timeout: 120000 };
    const scope = bindEditorIndentNativeCase(info, { assertCurrent() {} }, () => info, () => 101);
    scope.assertCurrent(); info.startTime!.setTime(102);
    Object.defineProperty(info, 'timeout', { get() { throw Error('后续属性不应访问'); } });
    Object.defineProperty(info, 'status', { get() { throw Error('后续属性不应访问'); } });
    expect(() => scope.assertCurrent()).toThrow('分支=start-value-changed；');
  });
});
