import { describe, expect, it } from 'vitest';
import { completeCaptureSql, type CaptureSqlChange } from '../helpers/pageCaptureSql';

const changes: CaptureSqlChange[] = [{ id: '18446744073709551614', before: 'old-x/old', after: '[old|x|$]' }, { id: '18446744073709551615', before: '前old后', after: '前[old||$]后' }];
/** 用独立手写夹具验证完整性守卫，不调用产品SQL生成器。 */
function statement(change: CaptureSqlChange, duplicateKey = false) {
  return 'UPDATE `dbark_e2e_unit`.`capture_batch` SET `note` = ? WHERE `id` <=> ?' + (duplicateKey ? ' AND `id` <=> ?' : '') + ' AND BINARY CONVERT(`note` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4);\n-- 参数：' + JSON.stringify([change.after, change.id, ...(duplicateKey ? [change.id] : []), change.before]);
}
const complete = (source: string) => completeCaptureSql(source, 'dbark_e2e_unit', 'capture_batch', changes);
describe('捕获实库UI必须等到完整SQL而非UPDATE表头', () => {
  it.each([false, true])('完整两行含原可靠键布局duplicate=%s才可通过', duplicate => {
    const source = changes.map(change => statement(change, duplicate)).join('\n\n'); expect(complete(source)).toBe(true);
    expect(complete(source.replaceAll(' ', '\u00a0').replace('[old|x|$]', '[old|\nx|$]'))).toBe(true);
  });
  it('首行、缺末尾JSON及只有UPDATE不能提前通过', () => {
    const source = changes.map(change => statement(change)).join('\n\n');
    for (const partial of ['UPDATE', statement(changes[0]), source.slice(0, -1), source.slice(0, source.lastIndexOf('-- 参数：'))]) expect(complete(partial)).toBe(false);
  });
  it('错after、错原值、重复行或缺占位符均拒绝', () => {
    const source = changes.map(change => statement(change)).join('\n\n');
    for (const wrong of [source.replace('[old|x|$]', '截断'), source.replace('old-x/old', '外部变化'), [statement(changes[0]), statement(changes[0])].join('\n\n'), source.replace(' AND BINARY CONVERT(`note` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4)', '')]) expect(complete(wrong)).toBe(false);
  });
  it('真实空格保留，不把JSON值内空格归一化后误认同值', () => {
    const one = { id: '1', before: '原 值', after: '新 值' }, source = statement(one);
    expect(completeCaptureSql(source, 'dbark_e2e_unit', 'capture_batch', [one])).toBe(true);
    expect(completeCaptureSql(source, 'dbark_e2e_unit', 'capture_batch', [{ ...one, after: '新值' }])).toBe(false);
  });
});
