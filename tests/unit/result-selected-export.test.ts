import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { ResultExportSelection, resultExportData } from '../../src/renderer/resultExport';
import { validateResultExportData } from '../../src/shared/resultExport';

/** 精度、重复显示名与内部列键独立，夹具不调用数据库或剪贴板。 */
function result(): QueryResult {
 return { columns: [{ key: 'c0', name: '重复', type: 'BIGINT' }, { key: 'c1', name: '重复', type: 'BLOB' }], rows: [{ c0: '18446744073709551615', c1: null }, { c0: '0.12345678901234567890', c1: { type: 'binary', base64: 'AP8=' } }, { c0: '', c1: { type: 'binary', base64: '' } }], truncated: true, elapsedMs: 1, statement: '不应进入导出请求的SQL' };
}
function fixture() {
 const source = result(), owner = new ResultExportSelection(), binding = owner.bind(source, ['current', 1])!;
 return { source, owner, binding, select(indices: number[]) { return owner.select(binding, { scope: binding, rows: source.rows, columns: source.columns, indices: new Set(indices) }); } };
}
describe('勾选结果的准确归属和固定导出快照', () => {
 it('空选择不能回退全量，按显示顺序克隆勾选值并保持truncated和内部键', () => {
  const f = fixture(); expect(f.owner.count(f.binding)).toBe(0); expect(() => f.owner.snapshot(f.binding)).toThrow();
  f.select([2, 0]); const selected = f.owner.snapshot(f.binding); expect(selected.rows).toEqual([f.source.rows[0], f.source.rows[2]]); expect(selected.rows).not.toBe(f.source.rows); expect(selected.rows[0]).not.toBe(f.source.rows[0]);
  expect(selected.columns.map(x => [x.key,x.name])).toEqual([['c0','重复'],['c1','重复']]); expect(selected.truncated).toBe(true); expect(selected.statement).toBe(''); expect(() => validateResultExportData(resultExportData(selected))).not.toThrow();
  f.select([]); expect(f.owner.count(f.binding)).toBe(0); expect(() => f.owner.snapshot(f.binding)).toThrow();
 });
 it.each(['result','rows','columns','row-in-array','column-in-array','name','key','type','truncated','selected-cell','binary'])('%s变化在effect之前就拒绝旧选择', change => {
  const f = fixture(); f.select([1]);
  if(change==='result') f.owner.bind({...f.source},['current',1]);
  else if(change==='rows') f.source.rows=[...f.source.rows]; else if(change==='columns') f.source.columns=[...f.source.columns];
  else if(change==='row-in-array') f.source.rows[1]={...f.source.rows[1]}; else if(change==='column-in-array') f.source.columns[0]={...f.source.columns[0]};
  else if(change==='name') f.source.columns[0].name='新列'; else if(change==='key') f.source.columns[0].key='other'; else if(change==='type') f.source.columns[0].type='TEXT'; else if(change==='truncated') f.source.truncated=false;
  else if(change==='selected-cell') f.source.rows[1].c0='后来值'; else (f.source.rows[1].c1 as {base64:string}).base64='AA==';
  expect(f.owner.count(f.binding)).toBe(0); expect(() => f.owner.snapshot(f.binding)).toThrow(); expect(f.select([0])).toBe(false);
 });
 it('A→B→A、固定快照切换及新执行均不复活旧回调，明确重选才允许', () => {
  const f=fixture(); f.select([0]); f.owner.bind(result(),['other',1]); const next=f.owner.bind(f.source,['current',1])!;
  expect(next).not.toBe(f.binding); expect(f.select([1])).toBe(false); expect(f.owner.count(next)).toBe(0);
  expect(f.owner.select(next,{scope:next,rows:f.source.rows,columns:f.source.columns,indices:new Set([1])})).toBe(true);
  f.owner.invalidate(); expect(f.owner.count(next)).toBe(0); expect(f.owner.select(next,{scope:next,rows:f.source.rows,columns:f.source.columns,indices:new Set([0])})).toBe(false);
  const pinned=f.owner.bind(f.source,['pin',1])!; expect(f.owner.count(pinned)).toBe(0);
 });
 it('对话框快照不随后续选择、源改动或新执行变化；全结果投影仍保持原有引用', () => {
  const f=fixture(); f.select([1]); const saved=f.owner.snapshot(f.binding); f.select([0]); f.source.rows[1].c0='后来'; f.owner.invalidate();
  expect(saved.rows[0].c0).toBe('0.12345678901234567890'); expect(saved.rows[0].c1).toEqual({type:'binary',base64:'AP8='});
  expect(resultExportData(f.source).rows).toBe(f.source.rows);
 });
 it.each([-1,0.5,3,Number.NaN])('无效索引%s整次拒绝', value=>{const f=fixture();expect(()=>f.select([value])).toThrow();expect(f.owner.count(f.binding)).toBe(0);});
 it('伪造scope或数组拒绝；预算在克隆前生效，超限不留下可导出的选择', () => {
  const f=fixture(); expect(f.owner.select(f.binding,{scope:{},rows:f.source.rows,columns:f.source.columns,indices:new Set([0])})).toBe(false);
  expect(f.owner.select(f.binding,{scope:f.binding,rows:[...f.source.rows],columns:f.source.columns,indices:new Set([0])})).toBe(false);
  f.source.rows[0].c0='界'.repeat(100000); expect(()=>f.select([0])).toThrow('256 KiB'); expect(f.owner.count(f.binding)).toBe(0);
 });
});
