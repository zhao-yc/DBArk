import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { dataTypeColorKind, catalogColorType, type DataTypeColorSource } from '../../src/renderer/dataTypeColors';
import { DataTypeColor, DataTypeColorLegend, DataTypeColorPreferences } from '../../src/renderer/components/DataTypeColor';
import { dataTypeColorsZh as text } from '../../src/renderer/locales/dataTypeColors.zh-CN';
import type { CellValue } from '../../src/shared/contracts';

describe('D08可靠元数据与正式标记', () => {
  it.each(['int', 'BIGINT UNSIGNED', 'decimal(65,30)', 'double', 'float(10, 2)', 'tinyint(1)', 'BOOL'])('目录%s只说明数值语义，不转换精确字符串', type => {
    const value = '9007199254740993.000000000001'; expect(dataTypeColorKind(value, type, 'catalog')).toBe('number'); expect(value).toBe('9007199254740993.000000000001');
  });
  it.each(['TINY', 'SHORT', 'LONG', 'INT24', 'LONGLONG', 'NEWDECIMAL', 'DECIMAL', 'FLOAT', 'DOUBLE'])('SQL正式协议%s映射数字，不依赖JS值猜测', type => expect(dataTypeColorKind('保留原值', type, 'protocol')).toBe('number'));
  it.each(['DATE', 'time(6)', 'datetime(3)', 'TIMESTAMP', 'year(4)'])('目录%s按时间元数据分类，不解析内容', type => expect(dataTypeColorKind('不是日期文本也不做转换', type, 'catalog')).toBe('temporal'));
  it.each(['DATE', 'NEWDATE', 'TIME', 'TIME2', 'DATETIME', 'DATETIME2', 'TIMESTAMP', 'TIMESTAMP2', 'YEAR'])('协议%s为正式时间类型', type => expect(dataTypeColorKind('0000-00-00', type, 'protocol')).toBe('temporal'));
  it.each(['123', '2026-10-16', '{"number":123}', 'NULL', '0x1234'])('文本内容%s不用于猜数字/时间/JSON/NULL/二进制', value => {
    expect(dataTypeColorKind(value, 'VARCHAR(200)', 'catalog')).toBe('text'); expect(dataTypeColorKind(value, 'VAR_STRING', 'protocol')).toBe('text'); expect(dataTypeColorKind(value, undefined, 'protocol')).toBeUndefined();
  });
  it.each(['BLOB', 'TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'GEOMETRY', '未知', '3', 'INT', 'varchar(20)', '', 'DECIMAL UNSIGNED'])('协议歧义或未知类型%s沿默认样式', type => expect(dataTypeColorKind('{"looks":"json"}', type, 'protocol')).toBeUndefined());
  it.each(['unknown', 'INT garbage', 'DATETIME(9)', 'VARCHAR(10); DROP', 'enum(unknown)', 'JSON ARRAY', 'BLOB COLLATE unknown', 'x'.repeat(513)])('无可靠目录类型%s不使用前缀猜测', type => expect(dataTypeColorKind('123', type, 'catalog')).toBeUndefined());
  it('JSON需要明确JSON类型，二进制优先认显式包装，NULL和DEFAULT不被列类型覆盖', () => {
    for (const source of ['catalog', 'protocol'] as const) {
      expect(dataTypeColorKind('{"a":1}', 'JSON', source)).toBe('json'); expect(dataTypeColorKind(null, 'BLOB', source)).toBe('null'); expect(dataTypeColorKind(undefined, 'JSON', source)).toBeUndefined();
      expect(dataTypeColorKind({ type: 'binary', base64: 'AAE=' }, 'VAR_STRING', source)).toBe('binary'); expect(dataTypeColorKind({ type: 'binary', base64: '' }, undefined, source)).toBe('binary');
    }
    expect(dataTypeColorKind('原文', 'BLOB', 'catalog')).toBe('binary'); expect(dataTypeColorKind('原文', 'BLOB', 'protocol')).toBeUndefined(); expect(dataTypeColorKind('1', 'INT', 'unknown' as DataTypeColorSource)).toBeUndefined();
  });
  it('目录必须唯一且精确匹配内部键，重复别名和继承属性不选择另一列', () => {
    const columns = [{ name: 'id', type: 'int' }, { name: 'id', type: 'varchar(20)' }, { name: '__proto__', type: 'json' }];
    expect(catalogColorType(columns, 'id')).toBeUndefined(); expect(catalogColorType(columns, '__proto__')).toBe('json'); expect(catalogColorType(columns, 'constructor')).toBeUndefined(); expect(catalogColorType(undefined, 'id')).toBeUndefined();
  });
});

describe('D08纯组件与状态保护', () => {
  it.each([undefined, false, 'true', 1])('默认或非显式开关%s不添加任何语义样式', enabled => {
    const html = renderToStaticMarkup(<DataTypeColor enabled={enabled as boolean} value={null} source="protocol" className="null-value" title="NULL">NULL</DataTypeColor>);
    expect(html).toContain('class="null-value"'); expect(html).toContain('title="NULL"'); expect(html).toContain('>NULL</span>'); expect(html).not.toContain('data-value-type'); expect(html).not.toContain('data-type-color');
  });
  it.each([true, 'true', 'grammar', 'spelling'])('错误标记%s保留，语义颜色不覆盖错误状态', invalid => {
    const html = renderToStaticMarkup(<DataTypeColor enabled value="a" type="STRING" source="protocol" aria-invalid={invalid as true}>a</DataTypeColor>); expect(html).not.toContain('data-value-type'); expect(html).toContain('aria-invalid');
  });
  it.each([null, '123', { type: 'binary', base64: 'AAE=' }] as CellValue[])('选中状态保留原内容/标题/NULL标记，不添加语义颜色', value => {
    const html = renderToStaticMarkup(<DataTypeColor enabled selected value={value} type="JSON" source="protocol" className={value === null ? 'null-value' : ''} title="原标题">原展示</DataTypeColor>); expect(html).not.toContain('data-value-type'); expect(html).toContain('title="原标题"'); expect(html).toContain('原展示'); if (value === null) expect(html).toContain('null-value');
  });
  it('开关和重置只回传布尔偏好；图例有六个中文文字说明，不携带数据', () => {
    const change = vi.fn(), node = DataTypeColorPreferences({ enabled: true, onChange: change });
    const children = node.props.children, label = children[0], button = children[3]; label.props.children[0].props.onChange({ target: { checked: true } }); button.props.onClick(); expect(change.mock.calls).toEqual([[true], [false]]);
    const html = renderToStaticMarkup(<DataTypeColorLegend/>); expect(html.match(/<li>/g)).toHaveLength(6); for (const label of ['文本', '数字', '日期时间', 'JSON', '二进制', 'NULL']) expect(html).toContain(label); expect(html).toContain(text.legend);
  });
  it('暗亮主题六种前景对既有普通/悬停底色均至少4.5对比度，状态规则不改背景或边框', () => {
    const css = readFileSync(new URL('../../src/renderer/dataTypeColors.css', import.meta.url), 'utf8');
    // 独立按WCAG相对亮度计算，不把同源颜色函数的返回值当可读性结论。
    const luminance = (hex: string) => { const values = hex.match(/\w\w/g)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return values[0] * .2126 + values[1] * .7152 + values[2] * .0722; };
    const palettes = [...css.matchAll(/:root(?:\[data-theme=light\])?\{([^}]+)\}/g)].map(match => [...match[1].matchAll(/--data-type-\w+:#([0-9a-f]{6})/g)].map(color => color[1]));
    expect(palettes).toHaveLength(2); for (const [index, palette] of palettes.entries()) { expect(palette).toHaveLength(6); for (const color of palette) for (const bg of index ? ['f9fafb', 'ffffff', 'f2f5f7', 'e8edf1'] : ['111519', '171c21', '1d232a', '252d35']) { const a = luminance(color), b = luminance(bg); expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), color + '/' + bg).toBeGreaterThanOrEqual(4.5); } }
    const stateRule = css.slice(css.indexOf('.results-grid'), css.indexOf('.data-type-legend')); expect(stateRule).toContain(':focus-within'); expect(stateRule).toContain('aria-invalid'); expect(stateRule).toContain('color:inherit'); expect(stateRule).not.toMatch(/background|border|outline/);
  });
});
