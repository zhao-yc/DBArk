import { describe, expect, it } from 'vitest';
import { pageFindPanelHarness } from '../helpers/pageFindPanelHarness';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';

describe('完整生产面板的单调替换意图', () => {
  it('未发生其它意图的正常命令仍只写一次，保留精度、BLOB和original', async () => {
    const h = await pageFindPanelHarness(); try { await h.initialize(); h.enter(4); await h.flush(); h.workers.at(-1)!.release(); await h.flush(); expect(h.applied).toHaveLength(1); expect(h.props.rows[0].data.note).toBe('NEW old'); expect(h.props.rows[0].original).toBe(h.original); expect(h.props.rows[0].data.amount).toBe(h.original.amount); expect(h.props.rows[0].data.payload).toEqual(h.original.payload); } finally { await h.dispose(); } expect(h.workers.every(worker => worker.terminated)).toBe(true);
  });
  it.each(['替换文字ABA', 'IME开始结束', '查询文字ABA', '列范围ABA', '大小写ABA', '下一处再上一处', '外部网格选择ABA'] as const)('%s永久撤销在途命令，旧响应也不能落稿', async kind => {
    const h = await pageFindPanelHarness(); try {
      await h.initialize(); h.enter(4); await h.flush(); const worker = h.workers.at(-1)!; expect(worker.message?.request.operation).toBe('preview');
      if (kind === '替换文字ABA') { h.change(4, '其它'); h.change(4, 'NEW'); }
      else if (kind === 'IME开始结束') { h.view.tree.props.onCompositionStart(); h.view.render(); h.view.tree.props.onCompositionEnd({ target: {} }); h.view.render(); }
      else if (kind === '查询文字ABA') { h.change(0, '其它'); h.change(0, 'old'); }
      else if (kind === '列范围ABA') { h.view.nodes('select')[1].props.onChange({ target: { value: 'note' } }); h.view.render(); h.view.nodes('select')[1].props.onChange({ target: { value: '' } }); h.view.render(); }
      else if (kind === '大小写ABA') { h.view.nodes('input')[1].props.onChange({ target: { checked: true } }); h.view.render(); h.view.nodes('input')[1].props.onChange({ target: { checked: false } }); h.view.render(); }
      else if (kind === '下一处再上一处') { h.enter(0); h.view.nodes('input')[0].props.onKeyDown({ key: 'Enter', shiftKey: true, nativeEvent: {}, preventDefault() {}, stopPropagation() {} }); h.view.render(); }
      else { h.selection({ rowId: 'uuid-2', key: 'note' }); h.selection({ rowId: 'uuid-1', key: 'note' }); }
      worker.release(true); await h.flush(); expect(h.applied).toHaveLength(0); expect(h.props.rows[0].data.note).toBe('old old'); expect(h.props.rows[0].original).toBe(h.original);
    } finally { await h.dispose(); } expect(h.workers.every(worker => worker.terminated)).toBe(true);
  });
  it.each([['替换文字ABA', true], ['IME开始结束', true], ['替换文字ABA', false], ['IME开始结束', false]] as const)('%s（事件间渲染：%s）即使原结果已生成且仅等待终止确认，也不能恢复旧命令', async (kind, renderBetween) => {
    const h = await pageFindPanelHarness(); try { await h.initialize(); h.enter(4); await h.flush(); const worker = h.workers.at(-1)!; worker.holdTermination(); worker.release(); await h.flush(); expect(worker.terminated).toBe(true); expect(worker.acknowledged).toBe(false);
      if (kind === '替换文字ABA') {
        const change = h.view.nodes('input')[4].props.onChange; change({ target: { value: '其它' } }); if (renderBetween) h.view.render(); change({ target: { value: 'NEW' } }); h.view.render();
      } else { h.view.tree.props.onCompositionStart(); if (renderBetween) h.view.render(); h.view.tree.props.onCompositionEnd({ target: {} }); h.view.render(); }
      worker.acknowledge(); await h.flush(); expect(h.applied).toHaveLength(0); expect(h.props.rows[0].data.note).toBe('old old');
      h.enter(4); await h.flush(); h.workers.at(-1)!.release(); await h.flush(); expect(h.applied).toHaveLength(1); expect(h.props.rows[0].data.note).toBe('NEW old');
    } finally { await h.dispose(); }
  });
  it('已经显示的整批预览也受修订保护，保留旧确认处理器不能复活ABA预览', async () => {
    const h = await pageFindPanelHarness(); try { await h.initialize(); h.click(text.preview); await h.flush(); h.workers.at(-1)!.release(); await h.flush(); const confirm = h.view.nodes('button').find(node => node.props.children === text.apply)!.props.onClick; h.change(4, '其它'); h.change(4, 'NEW'); await h.flush(); confirm(); await h.flush(); expect(h.applied).toHaveLength(0); expect(h.props.rows[0].data.note).toBe('old old'); } finally { await h.dispose(); }
  });
});
