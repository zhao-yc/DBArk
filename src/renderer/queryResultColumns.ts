import type { DataRow, QueryResult, ResultColumn, ResultExportData } from '../shared/contracts';
import { resultExportLimits, validateResultExportData } from '../shared/resultExport';

export interface QueryResultColumnLayout { order: string[]; visible: string[]; frozenThrough?: string; }
/** 内部唯一key才是身份；显示别名允许重复，元数据预算保持原上限。 */
export function queryResultColumnKeys(columns: ResultColumn[]): string[] {
  if (!columns.length || columns.length > resultExportLimits.columns) throw Error('结果列数量超出可管理范围');
  const keys = columns.map(column => column.key);
  if (keys.some(key => typeof key !== 'string' || !key.length) || new Set(keys).size !== keys.length) throw Error('结果内部列键无效或重复');
  return keys;
}
/** 布局完整覆盖原列一次，显隐至少留一列，不能通过伪造key授予其它字段。 */
export function queryResultVisibleColumns(columns: ResultColumn[], layout: QueryResultColumnLayout): ResultColumn[] {
  const keys = queryResultColumnKeys(columns), actual = new Set(keys), visible = new Set(layout.visible);
  if (layout.order.length !== keys.length || new Set(layout.order).size !== keys.length || layout.order.some(key => !actual.has(key)) || !visible.size || visible.size !== layout.visible.length || layout.visible.some(key => !actual.has(key))) throw Error('结果列布局已失效');
  const frozen = Object.getOwnPropertyDescriptor(layout, 'frozenThrough');
  if (frozen && (!('value' in frozen) || !frozen.enumerable || typeof frozen.value !== 'string' || !frozen.value.length || !visible.has(frozen.value))) throw Error('结果冻结边界必须是当前可见的精确内部列键');
  const map = new Map(columns.map(column => [column.key,column]));
  return layout.order.filter(key => visible.has(key)).map(key => map.get(key)!);
}
/** 冻结标记只接受布局中的可见唯一key，重名显示别名不会参与身份判断。 */
export function setQueryResultFrozenThrough(layout: QueryResultColumnLayout, key?: string): QueryResultColumnLayout {
  const output: QueryResultColumnLayout = { order: [...layout.order], visible: [...layout.visible] };
  if (key === undefined) return output;
  const available = new Set(output.order);
  if (typeof key !== 'string' || !key.length || key.length > 4096 || output.order.length > resultExportLimits.columns || output.order.some(value => typeof value !== 'string' || !value.length) || available.size !== output.order.length || new Set(output.visible).size !== output.visible.length || output.visible.some(value => !available.has(value)) || !available.has(key) || !output.visible.includes(key)) throw Error('结果冻结边界必须是当前可见的精确唯一内部列键');
  return { ...output, frozenThrough: key };
}
/** 只从已验证的当前可见顺序取前缀；元数据或边界失效时安全解除，不猜测其他列。 */
export function frozenQueryResultKeys(columns: ResultColumn[], layout: QueryResultColumnLayout): string[] {
  const frozen = Object.getOwnPropertyDescriptor(layout, 'frozenThrough');
  if (!frozen || !('value' in frozen) || !frozen.enumerable || typeof frozen.value !== 'string' || !frozen.value.length) return [];
  try {
    const visible = queryResultVisibleColumns(columns, { order: layout.order, visible: layout.visible }).map(column => column.key), index = visible.indexOf(frozen.value);
    return index < 0 ? [] : visible.slice(0, index + 1);
  } catch { return []; }
}
/** 相邻移动只修改有界列布局，行数组及原结果完全不变。 */
export function moveQueryResultColumn(layout: QueryResultColumnLayout, key: string, direction: -1 | 1): QueryResultColumnLayout {
  const index=layout.order.indexOf(key), target=index+direction;
  if (index < 0 || direction !== -1 && direction !== 1 || target < 0 || target >= layout.order.length) return layout;
  const order=[...layout.order];[order[index],order[target]]=[order[target],order[index]];
  const frozen = Object.getOwnPropertyDescriptor(layout, 'frozenThrough');
  const frozenThrough = frozen && 'value' in frozen && frozen.enumerable && typeof frozen.value === 'string' && order.filter(value => value === frozen.value).length === 1 && layout.visible.includes(frozen.value) ? frozen.value : undefined;
  return {order,visible:layout.visible,...(frozenThrough === undefined ? {} : {frozenThrough})};
}
/** 在打开导出或接纳行选择时才投影；逐行计量，超预算即停，绝不复制隐藏单元格。 */
export function projectQueryResultRows(result: QueryResult, columns: ResultColumn[], indices?: readonly number[]): ResultExportData {
  queryResultColumnKeys(result.columns);
  const keys=queryResultColumnKeys(columns), source=new Map(result.columns.map(column=>[column.key,column]));
  if (columns.some(column=>source.get(column.key)!==column)) throw Error('可见列不属于准确原结果');
  const count=indices?.length ?? result.rows.length;
  if (count>resultExportLimits.rows || count*columns.length>resultExportLimits.cells) throw Error('结果投影超过行数或单元格预算');
  const output:ResultExportData={columns:columns.map(({key,name})=>({key,name})),rows:[],truncated:result.truncated}, encoder=new TextEncoder();
  validateResultExportData(output);
  let bytes=32+encoder.encode(JSON.stringify(output.columns)).byteLength;
  for(let position=0;position<count;position++) {
    const index=indices?.[position] ?? position;
    if(!Number.isSafeInteger(index)||index<0||index>=result.rows.length)throw Error('结果行位置无效');
    const sourceRow=result.rows[index], row:DataRow=Object.create(null);
    for(const key of keys){if(!Object.hasOwn(sourceRow,key))throw Error('结果行缺少可见字段');Object.defineProperty(row,key,{value:sourceRow[key],enumerable:true,writable:true,configurable:true});}
    // 复用共享的字段／单行校验，再做累计预算；此时单行序列化本身已经有界。
    validateResultExportData({columns:output.columns,rows:[row],truncated:output.truncated});
    bytes+=encoder.encode(JSON.stringify(row)).byteLength+2;
    if(bytes>resultExportLimits.bytes)throw Error('已返回结果超过 32 MiB 导出预算，请减少查询返回的数据');
    output.rows.push(row);
  }
  validateResultExportData(output);return output;
}
/** 打开时生成独立有界快照；之后的布局、选择、源单元格或固定快照变化均不改变内容。 */
export function snapshotQueryResultColumns(result: QueryResult, columns: ResultColumn[], indices?: readonly number[]): QueryResult {
  const data=structuredClone(projectQueryResultRows(result,columns,indices));
  return {...data,columns:columns.map(column=>({...column})),elapsedMs:0,statement:''};
}
