import { serverMonitorLimits, type ServerMonitorSession } from '../shared/serverMonitor';

export type ServerMonitorSessionSort = 'id' | 'seconds';
export type ServerMonitorSessionDirection = 'asc' | 'desc';
export const serverMonitorSessionSearchLimit = 512;

/** 保留原精确文本，仅比较去前导零后的数字位数和字典序，绝不经Number舍入。 */
function decimal(value: string | null): string | undefined { return value !== null && /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/,'') : undefined; }
/** 有效数字按方向排序；空串/未知值在数字后，NULL始终最后，同值由原序号稳定裁决。 */
function compare(left: string | null, right: string | null, direction: ServerMonitorSessionDirection): number {
  const a = decimal(left), b = decimal(right);
  if (a === undefined || b === undefined) {
    const rank = (value: string | null, normalized: string | undefined) => normalized !== undefined ? 0 : value === null ? 2 : 1;
    return rank(left,a)-rank(right,b);
  }
  const order = a.length !== b.length ? a.length-b.length : a < b ? -1 : a > b ? 1 : 0;
  return direction === 'asc' ? order : -order;
}

/** 只投影本次有限快照，搜索字面摘要而非完整SQL；新数组排序不改原rows或行对象。 */
export function serverMonitorSessionView(rows: readonly ServerMonitorSession[], query: string, sort: ServerMonitorSessionSort, direction: ServerMonitorSessionDirection) {
  const needle = query.slice(0,serverMonitorSessionSearchLimit).toLowerCase();
  const bounded = rows.slice(0,serverMonitorLimits.sessions);
  const selected = bounded.map((row,index)=>({row,index})).filter(({row}) => !needle || [row.user,row.host,row.database,row.state,row.sql].some(value => value !== null && value.toLowerCase().includes(needle)));
  selected.sort((left,right)=>compare(left.row[sort],right.row[sort],direction)||left.index-right.index);
  return { rows: selected.map(value=>value.row), returned: rows.length, filtered: selected.length, capped: rows.length > serverMonitorLimits.sessions };
}
