import type { TableInfo } from '../../src/shared/contracts';
import type { TableStatisticsInput, TableStatisticsOutput } from '../../src/shared/tableStatistics';
import type { TableHistogram } from '../../src/shared/tableHistogram';

export const tableHistogramFixtureSource: TableInfo = {
  database: 'histogram_fixture', name: 'subject', objectKind: 'table', engine: 'InnoDB', columns: [['id', 'BIGINT UNSIGNED'], ['金额<script>', 'DECIMAL(65,30)'], ['floating', 'DOUBLE'], ['all_null', 'INT'], ['note', 'VARCHAR(80)']].map(([name, type]) => ({ name, type, nullable: true, defaultValue: null, extra: '', generated: false, comment: '' })), primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], ddl: 'CREATE TABLE subject(id BIGINT UNSIGNED PRIMARY KEY)',
};
/** 合成服务只验证真实界面，不冒充数据库：边界和原值频数独立手写，不调用产品分布规划器。 */
export function tableHistogramFixtureOutput(input: TableStatisticsInput): TableStatisticsOutput {
  if (input.columns.length || !input.histogram || input.connectionId !== 'offline-histogram' || input.database !== 'histogram_fixture' || input.table !== 'subject' || input.filters.length) throw Error('分布组件拒绝超出合成范围');
  const request = input.histogram, source = tableHistogramFixtureSource, column = source.columns.find(column => column.name === request.column);
  if (!column || !['金额<script>', 'floating', 'all_null'].includes(column.name) || ![5, 10, 20].includes(request.bins)) throw Error('分布组件字段或区间无效');
  let histogram: TableHistogram;
  if (column.name === 'all_null') histogram = { column: column.name, type: column.type, requestedBins: request.bins, approximate: false, min: null, max: null, nonNull: '0', nulls: '1000001', ranges: [] };
  else {
    const exact = column.name !== 'floating', quantum = '0.' + '0'.repeat(29), labels = (value: number) => exact ? quantum + value : String(value), frequencies = [100, 0, 200, 300, 999399, 1];
    const edges: [number, number][] = exact ? request.bins === 5 ? [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6]] : [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 6]] : Array.from({ length: request.bins }, (_, index) => [index * 10 / request.bins, (index + 1) * 10 / request.bins]);
    histogram = { column: column.name, type: column.type, requestedBins: request.bins, approximate: !exact, min: labels(exact ? 1 : 0), max: labels(exact ? 6 : 10), nonNull: '1000000', nulls: '1', ranges: edges.map(([lower, upper], index) => {
      const last = index === edges.length - 1, count = frequencies.reduce((sum, count, position) => { const value = exact ? position + 1 : position * 2; return sum + (value >= lower && (last ? value <= upper : value < upper) ? count : 0); }, 0);
      return { lower: labels(lower), upper: labels(upper), upperInclusive: last, count: String(count) };
    }) };
  }
  return { source: structuredClone(source), sourceDigest: 'a'.repeat(64), rowCount: '1000001', columns: [], histogram, warnings: ['离线合成统计回包；不代表真实数据库或安装验收。'] };
}
