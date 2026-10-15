import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SchemaCompareDialog } from '../../src/renderer/components/SchemaCompareDialog';

describe('结构比较只读入口投影', () => {
  it('只显示明确配对的输入和方向，用户提交前不自动触发比较或取消', () => {
    const services = { compare: vi.fn(), cancel: vi.fn(), preview: vi.fn(), release: vi.fn(), save: vi.fn() };
    const html = renderToStaticMarkup(<SchemaCompareDialog connections={[{ id: 'left', name: '源连接' }, { id: 'right', name: '目标连接' }]} services={services} initialSource={{ connectionId: 'left', database: '源数据库', table: '源表名' }} initialTarget={{ connectionId: 'right', database: '目标数据库', table: '目标表名' }} onClose={() => undefined}/>);
    expect(html).toContain('新增表示目标缺少'); expect(html).toContain('删除表示目标多出'); expect(html).toContain('不执行同步');
    expect(html).toContain('value="源表名"'); expect(html).toContain('value="目标表名"'); expect(html).toContain('value="left" selected=""'); expect(html).toContain('value="right" selected=""');
    expect(services.compare).not.toHaveBeenCalled(); expect(services.cancel).not.toHaveBeenCalled();
  });
  it('连接名和对象名按纯文本渲染，不把用户输入变为可执行标记', () => {
    const html = renderToStaticMarkup(<SchemaCompareDialog connections={[{ id: 'c', name: '<img src=x onerror=alert(1)>' }]} services={{ compare: vi.fn(), cancel: vi.fn(), preview: vi.fn(), release: vi.fn(), save: vi.fn() }} initialSource={{ connectionId: 'c', database: '"><script>alert(1)</script>', table: '表名.with`quote' }} onClose={() => undefined}/>);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x'); expect(html).toContain('&lt;script&gt;'); expect(html).toContain('&lt;img'); expect(html).toContain('表名.with`quote');
  });
});
