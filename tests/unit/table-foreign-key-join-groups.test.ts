import { describe, expect, it, vi } from 'vitest';
import type { FilterGroup, TableInfo } from '../../src/shared/contracts';
import { buildForeignKeyJoin, type ForeignKeyJoinOptions } from '../../src/renderer/tableForeignKeyJoin';
import { foreignKeyJoinGroupAfterChange, type ForeignKeyJoinFilter, type ForeignKeyJoinFilterDraft } from '../../src/renderer/tableForeignKeyJoinFilters';
import { emptyFilterDraft } from '../../src/renderer/tableFilters';
import { foreignKeyJoinPreview, TableForeignKeyJoinIntent } from '../../src/renderer/tableForeignKeyJoinIntent';
import { foreignKeyJoinFilterReadOnlyCases } from '../helpers/foreignKeyJoinFilterReadOnlyCases';
import { splitSql } from '../../src/engine/sql';
import { namedParameterTokens } from '../../src/shared/queryParameters';

/** 双方同名列及不输出列用真实生成器编译；不把单元SQL断言当作服务器执行。 */
function fixture() {
  const table = (name: string): TableInfo => ({ database: 'db', name, objectKind: 'table', engine: 'InnoDB', columns: ['id','pid','label'].map(name => ({ name, type: name === 'label' ? 'TEXT' : 'BIGINT UNSIGNED', nullable: true, generated: false, extra: '', comment: '', defaultValue: null })), foreignKeys: [], indexes: [], primaryKey: [], editableKey: [], ddl: '' });
  const child = table('child'), parent = table('parent'); child.foreignKeys = [{ name: 'fk', columns: ['pid'], referencedDatabase: 'db', referencedTable: 'parent', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }];
  const filters: ForeignKeyJoinFilter[] = [{ side: 'child', column: 'id', operator: '=', value: '9007199254740993' },{ side: 'parent', column: 'label', operator: 'IS NULL' },{ side: 'child', column: 'label', operator: '=', value: '备选' }];
  const options: ForeignKeyJoinOptions = { childColumns: ['id'], parentColumns: [], filters, filterMode: 'all' };
  const group: FilterGroup = { mode: 'all', children: [0,{ mode: 'any', children: [1,2] }] };
  return { child, parent, filters, options, group, build: (extra: Partial<ForeignKeyJoinOptions> = {}) => buildForeignKeyJoin(child,parent,'fk','LEFT',43,{ ...options,...extra }).sql };
}
describe('JOIN嵌套条件完整语义与身份', () => {
  it('原二十向量字节保持，新增八份嵌套向量为四模式单条零参数SELECT',()=>{const before=foreignKeyJoinFilterReadOnlyCases(),after=foreignKeyJoinFilterReadOnlyCases(true);expect(after).toHaveLength(28);expect(after.slice(0,20)).toEqual(before);expect(after.slice(20).every(test=>!!test.options.filterGroup)).toBe(true);for(const test of after)for(const ansiQuotes of [false,true])for(const noBackslashEscapes of [false,true]){expect(splitSql(test.sql,noBackslashEscapes,ansiQuotes)).toHaveLength(1);expect(namedParameterTokens(test.sql,{ansiQuotes,noBackslashEscapes})).toEqual([]);}});
  it('混合括号保留真实叶顺序与双方来源，不平铺为统一模式', () => {
    const f=fixture(), sql=f.build({filterGroup:f.group}), where=sql.split('\nWHERE ')[1].split('\nLIMIT')[0];
    expect(where).toContain(' AND (((p.`label` IS NULL)) OR ((c.`label` ='); expect(where).not.toBe(f.build().split('\nWHERE ')[1].split('\nLIMIT')[0]); expect(sql).toContain("c.`id` = CAST(CAST(_utf8mb4 X'39303037313939323534373430393933' AS DECIMAL(20,0)) AS UNSIGNED)");
    const inner=buildForeignKeyJoin(f.child,f.parent,'fk','INNER',43,{...f.options,filterGroup:f.group}).sql; expect(inner).toContain('INNER JOIN'); expect(inner.split('\nWHERE ')[1]).toBe(sql.split('\nWHERE ')[1]);
  });
  it('没有树保持旧字节，显式平铺树保留相同叶和连接词', () => { const f=fixture(); expect(f.build({filterGroup:undefined})).toBe(f.build()); expect(f.build({filterGroup:{mode:'all',children:[0,1,2]}})).toBe(f.build()); });
  it('停用子树被省略，OR不能因空组变为真；原下标不移位', () => {const f=fixture(); f.filters[0].enabled=false;f.filters[1].enabled=false;const sql=f.build({filterMode:'any',filterGroup:{mode:'any',children:[{mode:'all',children:[0,1]},2]}});expect(sql).not.toContain('c.`id` =');expect(sql).not.toContain('p.`label` IS NULL');expect(sql).toContain('c.`label` =');expect(sql).not.toContain(' OR ');f.filters[2].enabled=false;expect(f.build({filterGroup:f.group})).not.toContain('\nWHERE ');});
  it.each([
    {mode:'any',children:[0,1,2]}, {mode:'all',children:[0,1]}, {mode:'all',children:[0,0,1,2]}, {mode:'all',children:[0,1,2,3]}, {mode:'all',children:[0,{mode:'any',children:[]},1,2]}, {mode:'all',children:[0,1,NaN]},
  ])('不完整/重复/越界/空子组/根模式漂移整批拒绝：%j', filterGroup => expect(()=>fixture().build({filterGroup:filterGroup as FilterGroup})).toThrow());
  it('深度组数循环访问器及继承树不被降级为平铺', () => {
    const f=fixture(),getter=vi.fn(()=>f.group),cyclic:any={mode:'all',children:[]};cyclic.children.push(cyclic);let deep:FilterGroup={mode:'all',children:[0,1,2]};for(let i=0;i<8;i++)deep={mode:'all',children:[deep]};
    for(const group of [cyclic,deep,{mode:'all',children:[0,1,2,...Array.from({length:16},()=>({mode:'all',children:[0]}))]}])expect(()=>f.build({filterGroup:group})).toThrow();
    const accessor={...f.options};Object.defineProperty(accessor,'filterGroup',{enumerable:true,get:getter});expect(()=>buildForeignKeyJoin(f.child,f.parent,'fk','LEFT',43,accessor)).toThrow();const inherited=Object.assign(Object.create({filterGroup:f.group}),f.options);expect(()=>buildForeignKeyJoin(f.child,f.parent,'fk','LEFT',43,inherited)).toThrow();expect(getter).not.toHaveBeenCalled();
  });
  it('冻结树纳入打开意图，括号篡改不能消费原SQL', () => {const f=fixture(),intent=new TableForeignKeyJoinIntent(f.child,'c',43,[],()=>true),p=foreignKeyJoinPreview(intent,f.parent,'fk','LEFT',{...f.options,filterGroup:f.group});expect(Object.isFrozen(p.options.filterGroup!.children)).toBe(true);expect(()=>intent.consume({...p,options:{...p.options,filterGroup:{mode:'all',children:[{mode:'any',children:[0,1]},2]}}})).toThrow();expect(intent.current()).toBe(true);expect(intent.consume(p)).toBe(p.sql);});
  it('草稿稳定ID映射支持无效原值编辑、删除重编号、新增置根与清空', () => {
    const f=fixture(),entries:ForeignKeyJoinFilterDraft[]=['a','b','c'].map(id=>({id,side:'child',enabled:true,draft:{...emptyFilterDraft('id'),value:'无效数字'}}));
    expect(foreignKeyJoinGroupAfterChange(entries,entries.map((e,i)=>i===1?{...e,draft:{...e.draft,value:''}}:e),f.group,'all')).toEqual(f.group);
    expect(foreignKeyJoinGroupAfterChange(entries,[entries[0],entries[2]],f.group,'all')).toEqual({mode:'all',children:[0,{mode:'any',children:[1]}]});
    expect(foreignKeyJoinGroupAfterChange(entries,[...entries,{...entries[0],id:'d'}],f.group,'all')).toEqual({mode:'all',children:[0,{mode:'any',children:[1,2]},3]});
    expect(foreignKeyJoinGroupAfterChange(entries,[],f.group,'all')).toBeUndefined();expect(()=>foreignKeyJoinGroupAfterChange(entries,[entries[0],entries[0]],f.group,'all')).toThrow();
  });
});
