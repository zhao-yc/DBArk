import { expect, it } from 'vitest';
import { observeQueryFileNativeDocument as observe, type QueryFileNativeDocumentInput } from '../e2e/query-file-native-document-observer';
import { createQueryFileNativeDocumentRam } from './query-file-native-document-ram';

/** 输入与状态均为普通UI的RAM合成；不证明真实按键、保存、退出或旧审核通过。 */
function fixture() {
  const ui = createQueryFileNativeDocumentRam();
  const begin = (token = 'request-1') => ui.evaluate(observe, { action: 'begin', token, expected: { tabId: 'tab', sourceId: 'source', revision: ui.settings.tabs[0].fileSourceBinding.revision } });
  const check = (token = 'request-1', action: QueryFileNativeDocumentInput['action'] = 'check', growth = true) => ui.evaluate(observe, { action, token, settings: ui.settings, allowRevisionGrowth: growth });
  return { ui, begin, check };
}
it('发布前核对实际活动查询标签及来源修订', () => {
  for (const mode of ['标签', '来源', '修订']) {
    const value = fixture(); value.begin();
    if (mode === '标签') value.ui.settings.activeTabId = 'other';
    if (mode === '来源') value.ui.setSource('新的文件来源');
    if (mode === '修订') value.ui.setRevision(2);
    expect(() => value.check('request-1', 'check', false)).toThrow(/活动文档|来源/);
  }
});
it('等待内切换标签立即失效，选择回原标签仍不能沿用本请求', () => {
  const value = fixture(); value.begin(); value.check(); value.ui.select(1); expect(() => value.check()).toThrow(/其他标签|切换|离开/); value.ui.select(0); expect(() => value.check()).toThrow(/其他标签|切换|离开/);
});
it('等待内的DOM切换记录尚未投递时，takeRecords仍发现离开再回来的记录', () => {
  const value = fixture(); value.begin(); value.ui.select(1, false, false); value.ui.select(0, false, false); expect(() => value.check()).toThrow(/离开/);
});
it('来源变化及模型更换保持本请求失效，不使用更新后的状态重签', () => {
  const source = fixture(); source.begin(); source.ui.setSource('另一个来源'); expect(() => source.check()).toThrow(/来源/); source.ui.setSource('source'); expect(() => source.check()).toThrow(/来源/);
  const model = fixture(); model.begin(); model.ui.changeModel(); expect(() => model.check()).toThrow(/模型/);
});
it('发送后的正常revision增长及冲突弹窗允许，未要求焦点或dirty保持不变', () => {
  const value = fixture(); value.begin(); value.check('request-1', 'check', false); value.ui.setRevision(2); value.ui.openConflict(); expect(value.check()).toMatchObject({ sourceId: 'source', revision: 2 }); expect(value.check('request-1', 'end')).toMatchObject({ revision: 2 }); expect(value.ui.window.__queryFileNativeDocument).toBeUndefined();
});
it('等待中选择当前标签不属于文档切换', () => {
  const value = fixture(); value.begin(); value.ui.select(0); expect(value.check()).toMatchObject({ tabId: 'tab', sourceId: 'source' }); value.check('request-1', 'end');
});
it('请求间重读草稿及选回原标签不影响下一次独立请求，迟到通知不能污染新token', () => {
  const value = fixture(); value.begin(); value.check('request-1', 'end'); const old = value.ui.observers[0];
  value.ui.select(1); value.ui.select(0); value.ui.setRevision(3); value.begin('request-2');
  old.callback([{ type: 'attributes', target: value.ui.panes[0], attributeName: 'hidden', removedNodes: [] }]);
  expect(value.check('request-2')).toMatchObject({ token: 'request-2', revision: 3 }); value.check('request-2', 'end'); expect(value.ui.observers.filter(observer => observer.connected)).toHaveLength(0);
});
