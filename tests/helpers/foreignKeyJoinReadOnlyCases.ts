import type { TableInfo } from '../../src/shared/contracts';
import { buildForeignKeyJoin, type ForeignKeyJoinSort } from '../../src/renderer/tableForeignKeyJoin';

/** 只把生成器的两个固定FROM目标换为合成派生表；不创建物理库表，也不冒称实物外键目录验收。 */
export function foreignKeyJoinReadOnlyCases() {
  const info = (name: string, fields: [string, string][]): TableInfo => ({ database: 'join_virtual_fixture', name, objectKind: 'table', engine: 'InnoDB', columns: fields.map(([name,type]) => ({ name,type,nullable:true,generated:false,extra:'',comment:'',defaultValue:null })), foreignKeys: [], primaryKey: [], editableKey: [], indexes: [], ddl: '' });
  const child = info('child', [['id','BIGINT UNSIGNED'],['parent_id','BIGINT UNSIGNED']]), parent = info('parent', [['id','BIGINT UNSIGNED'],['amount','DECIMAL(30,4)']]);
  child.foreignKeys = [{ name:'fk', columns:['parent_id'], referencedDatabase:parent.database, referencedTable:parent.name, referencedColumns:['id'], onUpdate:'RESTRICT', onDelete:'RESTRICT' }];
  const ids = ['9007199254740992','9007199254740993','9007199254740994','9007199254740995','18446744073709551614','18446744073709551615'], parentIds = ['300',null,'100','999','200','300'], amounts = ['2.0000',null,'1.0000',null,'2.0000','2.0000'];
  const c = ids.map((id,i) => 'SELECT CAST(\''+id+'\' AS UNSIGNED) AS id,'+(parentIds[i]===null?'NULL':'CAST(\''+parentIds[i]+'\' AS UNSIGNED)')+' AS parent_id').join('\nUNION ALL\n');
  const p = ['100','200','300'].map((id,i) => "SELECT CAST('"+id+"' AS UNSIGNED) AS id,CAST('"+(i===0?'1.0000':'2.0000')+"' AS DECIMAL(30,4)) AS amount").join('\nUNION ALL\n');
  const definitions: { name:string; sort:ForeignKeyJoinSort[]; expected:number[]; kind?:'LEFT'|'INNER'; limit?:number; outputParent?:boolean }[] = [
    {name:'UINT64精确降序',sort:[{side:'child',column:'id',direction:'DESC'}],expected:[5,4,3,2,1,0],outputParent:true},
    {name:'父数值升序NULL后同值子键降序',sort:[{side:'parent',column:'amount',direction:'ASC',nulls:'LAST'},{side:'child',column:'id',direction:'DESC'}],expected:[2,5,4,0,3,1],outputParent:true},
    {name:'父数值降序NULL前同值子键升序',sort:[{side:'parent',column:'amount',direction:'DESC',nulls:'FIRST'},{side:'child',column:'id',direction:'ASC'}],expected:[1,3,0,4,5,2],outputParent:true},
    {name:'双方同名id分别排序',sort:[{side:'parent',column:'id',direction:'DESC',nulls:'LAST'},{side:'child',column:'id',direction:'DESC'}],expected:[5,0,4,2,3,1]},
    {name:'未输出父字段排序及显式三行上限',sort:[{side:'parent',column:'amount',direction:'DESC',nulls:'LAST'},{side:'child',column:'id',direction:'ASC'}],expected:[0,4,5],limit:3},
    {name:'INNER保留完整匹配并排序',sort:[{side:'child',column:'id',direction:'ASC'}],expected:[0,2,4,5],kind:'INNER',outputParent:true},
    {name:'显式一行上限',sort:[{side:'child',column:'id',direction:'ASC'}],expected:[0],limit:1},
    {name:'子关联键NULL前及同值降序',sort:[{side:'child',column:'parent_id',direction:'ASC',nulls:'FIRST'},{side:'child',column:'id',direction:'DESC'}],expected:[1,2,4,5,0,3]},
  ];
  return definitions.map(value => {
    const generated = buildForeignKeyJoin(child,parent,'fk',value.kind??'LEFT',43,{childColumns:['id'],parentColumns:value.outputParent?['amount']:[],sort:value.sort,...(value.limit?{limit:value.limit}:{})}).sql;
    const before='FROM `join_virtual_fixture`.`child` AS c\n'+(value.kind??'LEFT')+' JOIN `join_virtual_fixture`.`parent` AS p\n';
    if (generated.split(before).length!==2) throw Error('只读JOIN派生表替换目标不唯一');
    const sql=generated.replace(before,'FROM (\n'+c+'\n) AS c\n'+(value.kind??'LEFT')+' JOIN (\n'+p+'\n) AS p\n');
    return {name:value.name,generated,sql,expected:value.expected.map(index=>({c_1_id:ids[index],...(value.outputParent?{p_2_amount:amounts[index]}:{})}))};
  });
}
