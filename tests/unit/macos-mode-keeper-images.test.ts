import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const policy: any = await import(new URL('../../scripts/macos-mode-keeper-policy.mjs', import.meta.url).href);
const bytes = readFileSync(new URL('../fixtures/macos-display-20261021.0445.8.json', import.meta.url));

/** 使用实际同job枚举原字节；只调用纯策略，不加载AppKit或执行显示配置。 */
function inventory() { return JSON.parse(bytes.toString('utf8')); }

describe('已审阅的macOS托管镜像准入', () => {
  it('夹具与76ba9252的原附件JSON逐字一致', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('44b60a542572d6049ff44d25b4e8dabd536d76306e0ccdc6c6320b3c2823e143');
  });
  it.each(['20261013.0424.1', '20261021.0445.8'])('镜像%s仍按真实模式及保守余量选择候选', imageVersion => {
    const value = inventory(); value.context.imageVersion = imageVersion;
    const plan = policy.selectModeCandidate(value);
    expect(plan.mode).toEqual(value.displays[0].availableModes.find((mode: any) => mode.modeID === 9));
    expect(plan.estimatedVisible).toEqual({ width: 1600, height: 1106 });
    expect(plan.limits).toMatchObject({ leaseSeconds: 600, contentWidth: 1400, contentHeight: 1000 });
  });
  it.each(['20261021.0445.9', '20261021.0445.8-extra', '', undefined])('未审阅的版本%s拒绝', imageVersion => {
    const value = inventory(); value.context.imageVersion = imageVersion;
    expect(() => policy.selectModeCandidate(value)).toThrow();
  });
  it('版本相同也不能放过未知缩放或不足的真实模式', () => {
    const scaled = inventory(); scaled.displays[0].backingScaleFactor = 2;
    expect(() => policy.selectModeCandidate(scaled)).toThrow();
    const small = inventory(), display = small.displays[0];
    display.availableModes = display.availableModes.filter((mode: any) => mode.modeID !== 9);
    display.availableModeCount = display.availableModes.length;
    expect(() => policy.selectModeCandidate(small)).toThrow();
  });
});
