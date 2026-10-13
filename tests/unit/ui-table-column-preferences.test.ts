import { describe, expect, it } from 'vitest';
import { changeTablePreference, moveTableColumn, reconcileTablePreferences, visibleTableKeys } from '../../src/renderer/tableColumnPreferences';
import { pasteCells } from '../../src/renderer/gridClipboard';
import type { DraftRow } from '../../src/renderer/dataChanges';

describe('表列偏好与可见坐标', () => {
  it('真实列调和删除旧列、追加新列、规范大小写且保留同名原型字段', () => {
    const preferences = reconcileTablePreferences(['ID', '__proto__', 'constructor', 'new'], { version: 1, columns: [{ name: 'constructor', hidden: false, width: 250 }, { name: 'id', hidden: true }, { name: 'removed', hidden: false }, { name: '__proto__', hidden: false }] });
    expect(preferences.columns.map(column => column.name)).toEqual(['constructor', 'ID', '__proto__', 'new']);
    expect(visibleTableKeys(preferences)).toEqual(['constructor', '__proto__', 'new']);
  });
  it('至少一可见列，非法宽度整批拒绝，损坏全隐藏配置可恢复操作', () => {
    const preferences = reconcileTablePreferences(['id'], { version: 1, columns: [{ name: 'id', hidden: true }] });
    expect(visibleTableKeys(preferences)).toEqual(['id']);
    expect(() => changeTablePreference(preferences, 'id', { hidden: true })).toThrow();
    for (const width of [NaN, 63, 2001, 165.5]) expect(() => changeTablePreference(preferences, 'id', { width })).toThrow();
    expect(changeTablePreference(preferences, 'id', { width: 64 }).columns[0].width).toBe(64);
  });
  it('精确Value/value与Unicode折叠歧义不合并，保存侧歧义不猜，原型名仍完整', () => {
    const actual = ['Value', 'value', 'İ', 'i\u0307', '__proto__', 'constructor'];
    const preferences = reconcileTablePreferences(actual, { version: 1, columns: [{ name: 'value', hidden: true }, { name: 'VALUE', hidden: false }, { name: 'İ', hidden: false }, { name: '__proto__', hidden: false }] });
    expect(preferences.columns.map(column => column.name)).toEqual(['value', 'İ', '__proto__', 'Value', 'i\u0307', 'constructor']);
    expect(preferences.columns).toHaveLength(actual.length);
    const ambiguousSaved = reconcileTablePreferences(['Value'], { version: 1, columns: [{ name: 'value', hidden: true }, { name: 'VALUE', hidden: true }] });
    expect(ambiguousSaved.columns).toEqual([{ name: 'Value', hidden: false }]);
  });
  it('重排后矩阵粘贴只改变可见目标，隐藏可靠key和原始整行保持', () => {
    let preferences = reconcileTablePreferences(['id', '__proto__', 'constructor'], null);
    preferences = changeTablePreference(preferences, 'id', { hidden: true }); preferences = moveTableColumn(preferences, 'constructor', '__proto__');
    const data = Object.fromEntries([['id', '9007199254740993'], ['__proto__', null], ['constructor', { type: 'binary', base64: 'AA==' }]]);
    const rows: DraftRow[] = [{ id: 'row', data, original: structuredClone(data), inserted: false, deleted: false }];
    const keys = visibleTableKeys(preferences); expect(keys).toEqual(['constructor', '__proto__']);
    const next = pasteCells(rows, keys, 'row', 'constructor', [['first', 'second']], new Set());
    expect(next[0].data.constructor).toBe('first'); expect(next[0].data.__proto__).toBe('second'); expect(next[0].data.id).toBe('9007199254740993'); expect(next[0].original).toBe(rows[0].original);
  });
});
