import { ResultExportSelection } from '../../src/renderer/resultExport';

/** 给查询入口回归准备真实的已选结果；生产失效函数必须清除此实例，不能用空回调替代。 */
export function queryResultSelectionFixture() {
  const result = { columns: [{ key: 'c0', name: '原结果', type: 'VARCHAR' }], rows: [{ c0: '原选中值' }], truncated: false, elapsedMs: 1, statement: 'SELECT original' };
  const resultSelection = new ResultExportSelection(), binding = resultSelection.bind(result, ['current']);
  if (!binding || !resultSelection.select(binding, { scope: binding, rows: result.rows, columns: result.columns, indices: new Set([0]) }) || resultSelection.count(binding) !== 1) throw Error('查询入口回归未准备有效原选择');
  return { resultSelection, binding };
}
