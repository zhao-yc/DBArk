import { describe, expect, it, vi } from 'vitest';
import { captureObjectUriLaunch, receiveObjectUriLaunch } from '../../src/main/externalObjectUriLaunch';
import { objectUri } from '../../src/shared/workbench';
import { ExternalObjectUris } from '../../src/main/externalObjectUris';

const uri = objectUri({ connectionId: '原连接', database: '库/名', kind: 'table', name: '表" %22/尾\\' });
const exe = 'C:\\含空格 应用\\DBArk.exe';

describe('单实例原参数保真接收', () => {
  it('冷启动与开发入口只剥固定启动前缀，完整Unicode百分号地址保持逐字相同', () => {
    const expected = { dbarkObjectUri: { kind: 'url', uri } };
    expect(captureObjectUriLaunch([exe, uri], false)).toEqual(expected);
    expect(captureObjectUriLaunch([exe, 'dist/main/index.cjs', uri], true)).toEqual(expected);
    expect(captureObjectUriLaunch([exe], false)).toEqual({ dbarkObjectUri: { kind: 'none' } });
  });
  it.each(['--flag', '--original-process-start-time=1', '任意拆分尾项'])('即便前半是canonical链接，也拒绝追加参数%s', extra => {
    const valid = objectUri({ connectionId: 'c', database: 'd', kind: 'table', name: 'safe' });
    expect(captureObjectUriLaunch([exe, valid, extra], false)).toEqual({ dbarkObjectUri: { kind: 'error', code: 'invalid' } });
    expect(captureObjectUriLaunch([exe, extra, valid], false)).toEqual({ dbarkObjectUri: { kind: 'error', code: 'invalid' } });
  });
  it('双候选不挑一个打开，普通无协议重复启动不覆盖原待处理对象', () => {
    const queue = fixture();
    receiveObjectUriLaunch(queue, captureObjectUriLaunch([exe, uri], false));
    receiveObjectUriLaunch(queue, captureObjectUriLaunch([exe, '--normal'], false));
    queue.ready('原文档'); expect(queue.take('原文档')).toMatchObject({ kind: 'target', target: { name: '表" %22/尾\\' } });
    const other = fixture(); receiveObjectUriLaunch(other, captureObjectUriLaunch([exe, uri, uri], false));
    other.ready('原文档'); expect(other.take('原文档')).toMatchObject({ kind: 'error', code: 'multiple' });
  });
  it.each([undefined, {}, { dbarkObjectUri: { kind: 'url', uri, command: 'private' } }, { dbarkObjectUri: { kind: 'none' }, argv: [uri] }, { dbarkObjectUri: { kind: 'url', uri: 'dbark://object/v1/incomplete' } }])('副实例缺失或篡改数据固定拒绝，不回退扫描被Chromium重排的参数', data => {
    const queue = fixture(); receiveObjectUriLaunch(queue, data); queue.ready('原文档');
    expect(queue.take('原文档')).toMatchObject({ kind: 'error', code: 'invalid' });
  });
  it('整体预算在过滤前检查，错误结果不包含原始参数', () => {
    for (const argv of [Array(129).fill(uri), [exe, uri, 'secret'.repeat(6000)]]) {
      const captured = captureObjectUriLaunch(argv, false);
      expect(captured).toEqual({ dbarkObjectUri: { kind: 'error', code: 'invalid' } });
      expect(JSON.stringify(captured)).not.toContain('secret');
    }
  });
});

/** 真实队列配最小元数据端口，测试从启动归一化到可领取结果的完整交界。 */
function fixture() {
  return new ExternalObjectUris<string>({ revision: () => 1, assertOwner: () => {}, sameOwner: (a, b) => a === b, resolve: async target => target, notify: vi.fn() });
}
