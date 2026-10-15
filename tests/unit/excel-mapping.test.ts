import { describe, expect, it } from 'vitest';
import { validateExcelMapping } from '../../src/shared/excelTransfer';

describe('Excel 字段映射提交边界', () => {
  it('允许原型属性同名来源和目标，不通过普通对象键表判断存在性', () => {
    expect(() => validateExcelMapping([{ source: '__proto__', target: 'constructor' }], ['__proto__'], ['constructor'])).not.toThrow();
  });
  it('未知来源、未知目标、重复来源和重复目标都不能进入数据库提交', () => {
    for (const mapping of [[], [{ source: '旧字段', target: '目标' }], [{ source: '来源', target: '未知' }], [{ source: '来源', target: '目标' }, { source: '来源', target: '另一目标' }], [{ source: '来源', target: '目标' }, { source: '另一来源', target: '目标' }]]) {
      expect(() => validateExcelMapping(mapping, ['来源', '另一来源'], ['目标', '另一目标'])).toThrow();
    }
  });
});
