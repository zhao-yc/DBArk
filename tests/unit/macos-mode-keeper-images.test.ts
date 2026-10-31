import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const policy: any = await import(new URL('../../scripts/macos-mode-keeper-policy.mjs', import.meta.url).href);
const bytes = readFileSync(new URL('../fixtures/macos-display-20261021.0445.8.json', import.meta.url));
const renewedBytes = readFileSync(new URL('../fixtures/macos-display-20261026.0455.2.json', import.meta.url));

/** 使用实际同job枚举原字节；只调用纯策略，不加载AppKit或执行显示配置。 */
function inventory(sourceBytes = bytes) { return JSON.parse(sourceBytes.toString('utf8')); }

describe('已审阅的macOS托管镜像准入', () => {
  it('夹具与76ba9252的原附件JSON逐字一致', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('44b60a542572d6049ff44d25b4e8dabd536d76306e0ccdc6c6320b3c2823e143');
  });
  it('新夹具与28563431的同job原附件JSON逐字一致', () => {
    expect(renewedBytes.length).toBe(5057);
    expect(createHash('sha256').update(renewedBytes).digest('hex')).toBe('4cc3845bbc1abce3336afb1c158b6688c3698e8bef71add420e95bf526151ece');
  });
  it.each(['20261013.0424.1', '20261021.0445.8'])('镜像%s仍按真实模式及保守余量选择候选', imageVersion => {
    const value = inventory(); value.context.imageVersion = imageVersion;
    const plan = policy.selectModeCandidate(value);
    expect(plan.mode).toEqual(value.displays[0].availableModes.find((mode: any) => mode.modeID === 9));
    expect(plan.estimatedVisible).toEqual({ width: 1600, height: 1106 });
    expect(plan.limits).toMatchObject({ leaseSeconds: 600, contentWidth: 1400, contentHeight: 1000 });
  });
  it('新镜像真实夹具仅版本变化，仍按原余量选择mode9', () => {
    const value = inventory(renewedBytes), previous = inventory();
    expect(value.context.imageVersion).toBe('20261026.0455.2');
    expect({ ...value, context: { ...value.context, imageVersion: previous.context.imageVersion } }).toEqual(previous);
    const plan = policy.selectModeCandidate(value);
    expect(plan.mode).toEqual(value.displays[0].availableModes.find((mode: any) => mode.modeID === 9));
    expect(plan.estimatedVisible).toEqual({ width: 1600, height: 1106 });
    expect(plan.limits).toMatchObject({ leaseSeconds: 600, minimumVisibleWidth: 1440, minimumVisibleHeight: 1050, contentWidth: 1400, contentHeight: 1000 });
  });
  it.each(['20261021.0445.9', '20261021.0445.8-extra', '20261026.0455.3', '20261026.0455.2-extra', '', undefined])('未审阅的版本%s拒绝', imageVersion => {
    const value = inventory(); value.context.imageVersion = imageVersion;
    expect(() => policy.selectModeCandidate(value)).toThrow();
  });
  it('版本相同也不能放过未知缩放或不足的真实模式', () => {
    for (const sourceBytes of [bytes, renewedBytes]) {
      const scaled = inventory(sourceBytes); scaled.displays[0].backingScaleFactor = 2;
      expect(() => policy.selectModeCandidate(scaled)).toThrow();
      const small = inventory(sourceBytes), display = small.displays[0];
      display.availableModes = display.availableModes.filter((mode: any) => mode.modeID !== 9);
      display.availableModeCount = display.availableModes.length;
      expect(() => policy.selectModeCandidate(small)).toThrow();
    }
  });
});
