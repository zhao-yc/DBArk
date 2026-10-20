import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { readQueryResultSortCaseGrid } from '../helpers/queryResultSortCaseGrid';

/** 仅模拟虚拟行和裁切矩形；不启动浏览器、不读取产品排序器或向系统发送输入。 */
function fixture(height = 254, ids = ['4', '5', '1', '3', '2', '6', '7']) {
  const options = { frozen: false, omitted: -1, duplicate: false, conflicting: false, drift: false, content: Math.max(height, 40 + ids.length * 32) };
  const scrolls: number[] = []; let top = 0, frames = 0;
  const bounds = (y: number, h: number, x = 100, width = 400) => ({ top: y, bottom: y + h, height: h, left: x, right: x + width, width });
  const grid = {
    clientHeight: height, clientWidth: 400, clientTop: 0, clientLeft: 0, isConnected: true,
    get scrollHeight() { return options.content; }, get scrollTop() { return top; },
    ownerDocument: { defaultView: { requestAnimationFrame(callback: () => void) { frames++; Promise.resolve().then(callback); return frames; } } },
    getAttribute(name: string) { if (name !== 'aria-rowcount') throw Error('未知属性读取'); return String(ids.length + 1 + (options.drift && scrolls.length > 0 ? 1 : 0)); },
    getBoundingClientRect: () => bounds(100, height),
    scrollTo(position: { top: number; left: number; behavior: string }) {
      expect(position.left).toBe(0); expect(position.behavior).toBe('instant'); scrolls.push(position.top);
      if (!options.frozen) top = Math.max(0, Math.min(options.content - height, position.top));
    },
    querySelectorAll(selector: string) {
      if (selector === '[role="columnheader"]') return [{ getBoundingClientRect: () => bounds(100, 40) }];
      if (selector !== '[role="row"][aria-rowindex]') throw Error('不得读取其它页面内容');
      const rows = ids.flatMap((id, index) => {
        const y = 140 + index * 32 - top;
        if (index === options.omitted || y + 32 <= 108 || y >= 132 + height) return [];
        return [{
          getAttribute: (name: string) => name === 'aria-rowindex' ? String(index + 2) : null,
          querySelector: (name: string) => {
            if (name !== '[role="gridcell"][aria-colindex="2"]') throw Error('不得读取其它字段');
            return { textContent: options.conflicting && top > 0 && index === 2 ? '7' : id, getBoundingClientRect: () => bounds(y, 32, 135, 100) };
          },
        }];
      });
      return options.duplicate && rows.length ? [...rows, rows[0]] : rows;
    },
  };
  // 与Playwright一样把真实函数序列化到独立全局，外部变量依赖会在本测试中失败。
  const read = () => runInNewContext(`(${readQueryResultSortCaseGrid.toString()})(grid)`, { grid }) as ReturnType<typeof readQueryResultSortCaseGrid>;
  return { options, grid, scrolls, read, frames: () => frames };
}

describe('七行窗口矩阵的有界虚拟滚动读取（RAM）', () => {
  it('254像素视口滚动补齐末行，保持手写全七行顺序并回到首行', async () => {
    const f = fixture(), result = await f.read();
    expect(result.ids).toEqual(['4', '5', '1', '3', '2', '6', '7']);
    expect(result).toMatchObject({ dataRows: 7, viewportHeight: 254, contentHeight: 264 });
    expect(result.pages).toEqual([{ top: 0, indices: [0, 1, 2, 3, 4, 5] }, { top: 10, indices: [1, 2, 3, 4, 5, 6] }]);
    expect(f.scrolls).toEqual([0, 10, 0]); expect(f.grid.scrollTop).toBe(0);
  });
  it('96像素视口按整行推进，半行不能在相邻两页都遗漏', async () => {
    const f = fixture(96), result = await f.read();
    expect(result.ids).toEqual(['4', '5', '1', '3', '2', '6', '7']);
    expect(result.pages.length).toBeLessThanOrEqual(8); expect(f.scrolls).toEqual([0, 32, 64, 96, 128, 160, 168, 0]);
  });
  it.each([{ ids: [] }, { ids: ['3'] }, { ids: ['1', '3', '6', '7'] }])('空及过滤后的矩阵仍读取准确行数（$ids）', async ({ ids }) => {
    const result = await fixture(254, ids).read(); expect(result.ids).toEqual(ids); expect(result.dataRows).toBe(ids.length);
  });
  it('低于产品最小内容高度或缺失完整内容高度时拒绝，不开始滚动', async () => {
    const short = fixture(95); await expect(short.read()).rejects.toThrow('完整行序'); expect(short.scrolls).toEqual([]);
    const clipped = fixture(); clipped.options.content = 263; await expect(clipped.read()).rejects.toThrow('完整行序'); expect(clipped.scrolls).toEqual([]);
  });
  it('滚动不前进时有界失败，不能返回可见六行冒充完整七行', async () => {
    const f = fixture(); f.options.frozen = true; await expect(f.read()).rejects.toThrow('完整行序');
    expect(f.scrolls.length).toBeLessThanOrEqual(8); expect(f.frames()).toBeLessThanOrEqual(18);
  });
  it('末行从未渲染时失败，不按计数补造ID或使用内部数据', async () => {
    const f = fixture(); f.options.omitted = 6; await expect(f.read()).rejects.toThrow('完整行序');
    expect(f.grid.scrollTop).toBe(10); expect(f.scrolls).toEqual([0, 10]);
  });
  it.each(['duplicate', 'conflicting', 'drift'] as const)('%s行身份／内容／行数漂移不能拼接为成功矩阵', async name => {
    const f = fixture(); f.options[name] = true; await expect(f.read()).rejects.toThrow('完整行序');
  });
});
