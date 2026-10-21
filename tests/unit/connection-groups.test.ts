import { expect, it } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { connectionGroups } from '../../src/renderer/connectionGroups';

/** 固定原profile身份，分组投影不得修改连接或按显示文字误合并。 */
function profile(id: string, group?: string): ConnectionProfile {
  const result: ConnectionProfile = { id, group: group ?? '', color: '#52c5a2', name: id, dialect: 'mysql', host: 'example.invalid', port: 3306, user: 'synthetic', rememberPassword: false };
  if (group === undefined) Reflect.deleteProperty(result, 'group'); // 遗留缺省分组仍按空分组投影。
  return result;
}
it('空分组与字面“未分组”分别持有准确成员，undefined和空串才合并', () => {
  const rows = [profile('a'), profile('b', '未分组'), profile('c', ''), profile('d', '未分组')];
  const groups = connectionGroups(rows); expect(groups.map(group => [group.name, group.connections.map(row => row.id)])).toEqual([['', ['a', 'c']], ['未分组', ['b', 'd']]]);
  expect(groups[0].connections[0]).toBe(rows[0]); expect(rows[0].group).toBeUndefined();
});
it('原型名称、前后空格、Unicode及首次出现顺序保持，不排序或重写连接数组', () => {
  const rows = [profile('a', '__proto__'), profile('b', ' 生产 '), profile('c', '生产'), profile('d', '😊'), profile('e', '__proto__')];
  expect(connectionGroups(rows).map(group => [group.name, group.connections.map(row => row.id)])).toEqual([['__proto__', ['a', 'e']], [' 生产 ', ['b']], ['生产', ['c']], ['😊', ['d']]]);
  expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c', 'd', 'e']); expect(connectionGroups([])).toEqual([]);
});
