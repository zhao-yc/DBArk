import { expect, it, vi } from 'vitest';
import { sqliteTableEditPreviewSchema as schema, sqliteTableEditLimits as limits } from '../../src/shared/sqliteTableEdit';
/** 各页row编号独立，所有页仍共享同一整批预算。 */
const update = (row = 0, value = '精确原文') => ({ kind: 'update', row, values: [{ column: 'note', value: { kind: 'text', value } }] });
const input = () => ({ snapshotId: '原页一', taskId: '本批', changes: [update()], additionalPages: [{ snapshotId: '原页二', changes: [update()] }] });
it('多页保持原typed协议和每页独立row位置，单页不自动追加字段', () => {
 const source=input();expect(schema.parse(source)).toEqual(source);const single={snapshotId:'原页',taskId:'原任务',changes:[update()]};expect(schema.parse(single)).toEqual(single);
});
it.each(['duplicate','anchor','empty','too-many','duplicate-row','empty-changes','row-outside','private-field'] as const)('%s拒绝非法页集合，不由Renderer注入私有旧值或定位',kind=>{
 const source:any=input();if(kind==='duplicate')source.additionalPages.push(source.additionalPages[0]);if(kind==='anchor')source.additionalPages[0].snapshotId=source.snapshotId;if(kind==='empty')source.additionalPages=[];if(kind==='too-many')source.additionalPages=Array.from({length:16},(_,i)=>({snapshotId:'页'+i,changes:[update()]}));if(kind==='duplicate-row')source.additionalPages[0].changes.push(update());if(kind==='empty-changes')source.additionalPages[0].changes=[];if(kind==='row-outside')source.additionalPages[0].changes[0].row=1000;if(kind==='private-field')source.additionalPages[0].oldValues=['不得信任'];expect(schema.safeParse(source).success).toBe(false);
});
it('16页仍可准入，17页拒绝，原500行总预算不按页倍增',()=>{
 const source:any=input();source.additionalPages=Array.from({length:limits.pages-1},(_,i)=>({snapshotId:'页'+i,changes:[update()]}));expect(schema.safeParse(source).success).toBe(true);
 source.changes=Array.from({length:250},(_,i)=>update(i));source.additionalPages=[{snapshotId:'第二页',changes:Array.from({length:250},(_,i)=>update(i))}];expect(schema.safeParse(source).success).toBe(true);source.additionalPages[0].changes.push(update(250));expect(schema.safeParse(source).success).toBe(false);
});
it('页数或全批行数超限时先拒绝，不读取任何字段值getter',()=>{
 const getter=vi.fn(()=>{throw Error('不应深读字段');}),source:any=input();Object.defineProperty(source.changes[0],'values',{get:getter});source.additionalPages=Array.from({length:16},()=>({}));expect(schema.safeParse(source).success).toBe(false);expect(getter).not.toHaveBeenCalled();
 source.additionalPages=[{snapshotId:'第二页',changes:Array(500).fill({kind:'insert',values:[]})}];expect(schema.safeParse(source).success).toBe(false);expect(getter).not.toHaveBeenCalled();
});
it('累计字段数先拒绝，再读任何字段正文，单页不能独占额外整批预算',()=>{
 const source:any=input(),getter=vi.fn(()=>{throw Error('不应读正文');}),field={};Object.defineProperty(field,'column',{get:getter});source.changes=[{kind:'insert',values:Array(5001).fill(field)}];source.additionalPages[0].changes=[{kind:'insert',values:Array(5000).fill(field)}];expect(schema.safeParse(source).success).toBe(false);expect(getter).not.toHaveBeenCalled();
});
it('2MiB为全部原页的累计输入，精确整数与NULL保持，超总量不返回部分变化',()=>{
 const source:any=input();source.changes[0].values=[{column:'id',value:{kind:'integer',value:'9223372036854775807'}}];source.additionalPages[0].changes[0].values=[{column:'note',value:{kind:'null'}}];expect(schema.parse(source)).toEqual(source);
 const values=Array.from({length:17},(_,i)=>({column:'列'+i,value:{kind:'text',value:'x'.repeat(65536)}}));source.changes=[{kind:'insert',values}];source.additionalPages[0].changes=[{kind:'insert',values}];expect(schema.safeParse(source).success).toBe(false);
});
