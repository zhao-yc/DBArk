import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindEditorIndentNativeCase, type IndentNativeTestInfo } from '../e2e/editor-indentation-native-gate';

const local = createRequire(join(process.cwd(), 'package.json'));
const playwright = createRequire(createRequire(local.resolve('@playwright/test/package.json')).resolve('playwright/package.json'));
const iso = playwright('playwright-core/lib/coreBundle').iso as { monotonicTime(): number; timeOrigin(): number; setTimeOrigin(value: number): void };
afterEach(() => vi.restoreAllMocks());

/** 运行默认生产时钟路径，只控制真实框架依赖的performance.now；不注入替代守卫或启动原生资源。 */
function fixture(elapsed = 0) {
  let instant = 500, wall = 100000;
  vi.spyOn(performance, 'now').mockImplementation(() => instant);
  const start = iso.monotonicTime(), info: IndentNativeTestInfo = { _startWallTime: wall, _startTime: start, timeout: 120000, status: 'passed' };
  const wallReads = vi.spyOn(Date, 'now').mockImplementation(() => wall), environment = { assertCurrent: vi.fn() };
  instant += elapsed;
  const scope = bindEditorIndentNativeCase(info, environment, () => info);
  return { scope, info, wallReads, environment, tick: (value: number) => { instant = 500 + value; }, wall: (value: number) => { wall = value; } };
}

describe('原TestInfo单调期限（默认框架路径，RAM）', () => {
  it('墙钟回退1毫秒或大幅校时不改变原120秒，后续完全不读取Date.now', () => {
    const f = fixture(); f.scope.assertCurrent();
    for (const [elapsed, wall] of [[1, 99999], [500, -9000000], [1000, 9000000000]]) {
      f.tick(elapsed); f.wall(wall); expect(() => f.scope.assertCurrent()).not.toThrow();
    }
    f.wallReads.mockImplementation(() => { throw Error('墙钟不得参与后续授权'); });
    f.tick(119999); expect(() => f.scope.assertCurrent()).not.toThrow();
    f.tick(120000); expect(() => f.scope.assertCurrent()).toThrow('分支=deadline；');
    expect(f.wallReads).not.toHaveBeenCalled();
  });
  it('绑定前已消耗的时间计入原期限，迟到建立守卫不能再领取120秒', () => {
    const f = fixture(119000); f.scope.assertCurrent(); f.tick(119999); f.scope.assertCurrent();
    f.tick(120000); expect(() => f.scope.assertCurrent()).toThrow('分支=deadline；');
    f.tick(119000); expect(() => f.scope.assertCurrent()).toThrow('分支=retained；');
  });
  it('原单调时间倒退仍立即拒绝且永不复活，不用clamp吞掉异常', () => {
    const f = fixture(); f.scope.assertCurrent(); f.tick(2); f.scope.assertCurrent(); f.tick(1);
    expect(() => f.scope.assertCurrent()).toThrow('分支=clock-reversed；');
    f.tick(3); expect(() => f.scope.assertCurrent()).toThrow('分支=retained；');
  });
  it.each([undefined, NaN, Infinity, -Infinity])('缺失或无效原单调起点%s不能用当前时刻补造', value => {
    const f = fixture(); f.info._startTime = value;
    expect(() => f.scope.assertCurrent()).toThrow('分支=monotonic-start-changed；');
    const info = { _startWallTime: 100000, timeout: 120000, ...(value === undefined ? {} : { _startTime: value }) };
    expect(() => bindEditorIndentNativeCase(info, { assertCurrent() {} }, () => info).assertCurrent()).toThrow('分支=invalid-monotonic-start；');
  });
  it('框架原点偏移产生的有限负时间戳仍沿原elapsed计时，不能把合法时间域误判为无效', () => {
    const origin = iso.timeOrigin();
    try {
      iso.setTimeOrigin(performance.timeOrigin + 10000);
      const f = fixture(); expect(f.info._startTime).toBeLessThan(0); f.scope.assertCurrent();
      f.tick(119999); expect(() => f.scope.assertCurrent()).not.toThrow();
      f.tick(120000); expect(() => f.scope.assertCurrent()).toThrow('分支=deadline；');
    } finally { iso.setTimeOrigin(origin); }
  });
  it('原单调字段删除后再恢复也不能复活，框架原点漂移同样拒绝', () => {
    const f = fixture(), original = f.info._startTime; delete f.info._startTime;
    expect(() => f.scope.assertCurrent()).toThrow('分支=monotonic-start-changed；');
    f.info._startTime = original; expect(() => f.scope.assertCurrent()).toThrow('分支=retained；');
    const second = bindEditorIndentNativeCase(f.info, { assertCurrent() {} }, () => f.info), origin = iso.timeOrigin();
    try { iso.setTimeOrigin(origin - 1); expect(() => second.assertCurrent()).toThrow('原框架单调时钟已变化'); }
    finally { iso.setTimeOrigin(origin); }
    expect(() => second.assertCurrent()).toThrow('分支=retained；');
  });
});
