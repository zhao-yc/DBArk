import type { TableInfo, FilterMode, FilterGroup } from '../../src/shared/contracts';
import { buildForeignKeyJoin, type ForeignKeyJoinOptions } from '../../src/renderer/tableForeignKeyJoin';
import type { ForeignKeyJoinFilter } from '../../src/renderer/tableForeignKeyJoinFilters';

/** 仅合成派生表；值夹具独立用Buffer编码，不用产品字面量函数证明自己。 */
export function foreignKeyJoinFilterReadOnlyCases(includeGroups = false) {
  const info=(name:string,types:Record<string,string>):TableInfo=>({database:'join_filter_fixture',name,objectKind:'table',engine:'InnoDB',columns:Object.entries(types).map(([name,type])=>({name,type,nullable:true,generated:false,extra:'',comment:'',defaultValue:null})),foreignKeys:[],indexes:[],primaryKey:[],editableKey:[],ddl:''});
  const child=info('child',{id:'BIGINT UNSIGNED',pid:'BIGINT UNSIGNED',label:'VARCHAR(5000)'}),parent=info('parent',{id:'BIGINT UNSIGNED',amount:'DECIMAL(30,4)',note:'TEXT'});child.foreignKeys=[{name:'fk',columns:['pid'],referencedDatabase:parent.database,referencedTable:parent.name,referencedColumns:['id'],onDelete:'RESTRICT',onUpdate:'RESTRICT'}];
  const ids=['9007199254740993','9007199254740994','18446744073709551615','9007199254740995','9007199254740996','18446744073709551614'],parents=['100',null,'200','100','999','300'],labels=["中文'\\:fake;--\0🚢",'','100%_raw\\line','comma,a',' space ','other'];
  const parentAmounts=['12.3400',null,'99999999999999999999.1234','12.3400',null,'0.0000'],notes=[null,null,'parent200',null,null,''];
  const string=(value:string|null)=>value===null?'NULL':"_utf8mb4 X'"+Buffer.from(value,'utf8').toString('hex')+"' COLLATE utf8mb4_bin",integer=(value:string|null)=>value===null?'NULL':"CAST('"+value+"' AS UNSIGNED)";
  const c=ids.map((id,index)=>'SELECT '+integer(id)+' AS id,'+integer(parents[index])+' AS pid,'+string(labels[index])+' AS label').join('\nUNION ALL\n');
  const p=['100','200','300'].map((id,index)=>'SELECT '+integer(id)+" AS id,CAST('"+['12.3400','99999999999999999999.1234','0.0000'][index]+"' AS DECIMAL(30,4)) AS amount,"+string([null,'parent200',''][index])+' AS note').join('\nUNION ALL\n');
  const conditions:{name:string;filters:ForeignKeyJoinFilter[];expected:number[];mode?:FilterMode;limit?:number;group?:FilterGroup}[]=[
    {name:'BIGINT超过JS安全边界精确相等',filters:[{side:'child',column:'id',operator:'=',value:ids[0]}],expected:[0]},
    {name:'UINT64最大值精确集合',filters:[{side:'child',column:'id',operator:'IN',values:[ids[2],ids[1]]}],expected:[1,2]},
    {name:'父侧精确DECIMAL区间含两个子行',filters:[{side:'parent',column:'amount',operator:'BETWEEN',values:['12.3400','12.3400']}],expected:[0,3]},
    {name:'未输出父侧高精度DECIMAL比较',filters:[{side:'parent',column:'amount',operator:'>',value:'12.3400'}],expected:[2]},
    {name:'父ID空包含未匹配和空外键',filters:[{side:'parent',column:'id',operator:'IS NULL'}],expected:[1,4]},
    {name:'父非键列空也包含真实父NULL',filters:[{side:'parent',column:'note',operator:'IS NULL'}],expected:[0,1,3,4]},
    {name:'非NULL仍保留父空字符串',filters:[{side:'parent',column:'note',operator:'IS NOT NULL'}],expected:[5,2]},
    {name:'引号反斜杠NUL及伪参数文本精确原值',filters:[{side:'child',column:'label',operator:'=',value:labels[0]}],expected:[0]},
    {name:'集合保留逗号空格与空串',filters:[{side:'child',column:'label',operator:'IN',values:['','comma,a',' space ']}],expected:[1,3,4]},
    {name:'LIKE只在值中使用通配符',filters:[{side:'child',column:'label',operator:'LIKE',value:'%raw%'}],expected:[2]},
    {name:'NOT LIKE不会变成SQL片段',filters:[{side:'child',column:'label',operator:'NOT LIKE',value:'%raw%'}],expected:[0,1,3,4,5]},
    {name:'OR组合跨双方',filters:[{side:'child',column:'label',operator:'=',value:''},{side:'parent',column:'amount',operator:'>',value:'12.3400'}],mode:'any',expected:[1,2]},
    {name:'AND组合不能放宽为OR',filters:[{side:'child',column:'label',operator:'=',value:''},{side:'parent',column:'amount',operator:'>',value:'12.3400'}],expected:[]},
    {name:'停用条件不执行错误数值转换',filters:[{side:'child',column:'id',operator:'=',value:'非数字',enabled:false},{side:'child',column:'id',operator:'=',value:ids[2]}],expected:[2]},
    {name:'UINT64比较不降级DOUBLE',filters:[{side:'child',column:'id',operator:'<',value:ids[2]}],expected:[0,1,3,4,5]},
    {name:'全停用不伪造WHERE',filters:[{side:'child',column:'label',operator:'=',value:'不存在',enabled:false}],expected:[0,1,3,4,5,2]},
    {name:'先筛选排序再限制三行',filters:[{side:'child',column:'id',operator:'BETWEEN',values:[ids[0],ids[2]]}],limit:3,expected:[0,1,3]},
    {name:'NOT IN保留每个原值',filters:[{side:'child',column:'label',operator:'NOT IN',values:['','comma,a']}],expected:[0,4,5,2]},
    {name:'父非空文本不等空串遵守三值逻辑',filters:[{side:'parent',column:'note',operator:'!=',value:''}],expected:[2]},
    {name:'空结果不改写为全表',filters:[{side:'child',column:'label',operator:'IN',values:['带\n换行','完全不存在']}],expected:[]},
  ];
  // 新向量只在明确分组专项启用，原二十条SQL、模式和准确预期保持不变。
  if (includeGroups) conditions.push(
    {name:'AND包含跨双方OR子组',filters:[{side:'child',column:'id',operator:'>=',value:ids[0]},{side:'child',column:'label',operator:'=',value:''},{side:'parent',column:'amount',operator:'>',value:'12.3400'}],group:{mode:'all',children:[0,{mode:'any',children:[1,2]}]},expected:[1,2]},
    {name:'OR包含两个AND子组',mode:'any',filters:[{side:'child',column:'id',operator:'=',value:ids[0]},{side:'parent',column:'amount',operator:'=',value:'12.3400'},{side:'child',column:'label',operator:'=',value:''},{side:'parent',column:'id',operator:'IS NULL'}],group:{mode:'any',children:[{mode:'all',children:[0,1]},{mode:'all',children:[2,3]}]},expected:[0,1]},
    {name:'AND中全停用OR子树省略',filters:[{side:'child',column:'id',operator:'=',value:'无效数值',enabled:false},{side:'parent',column:'id',operator:'IS NULL',enabled:false},{side:'parent',column:'amount',operator:'>',value:'12.3400'}],group:{mode:'all',children:[{mode:'any',children:[0,1]},2]},expected:[2]},
    {name:'OR中全停用AND子树不能变为真',mode:'any',filters:[{side:'child',column:'id',operator:'=',value:'无效数值',enabled:false},{side:'parent',column:'id',operator:'IS NULL',enabled:false},{side:'child',column:'label',operator:'=',value:'comma,a'}],group:{mode:'any',children:[{mode:'all',children:[0,1]},2]},expected:[3]},
    {name:'全部停用嵌套树不附加WHERE',filters:[{side:'child',column:'id',operator:'IS NULL',enabled:false},{side:'parent',column:'id',operator:'IS NULL',enabled:false}],group:{mode:'all',children:[{mode:'any',children:[0,{mode:'all',children:[1]}]}]},expected:[0,1,3,4,5,2]},
    {name:'非顺序叶遍历仍绑定准确来源与值',mode:'any',filters:[{side:'child',column:'id',operator:'=',value:ids[0]},{side:'parent',column:'amount',operator:'>',value:'12.3400'},{side:'child',column:'label',operator:'=',value:'comma,a'}],group:{mode:'any',children:[2,{mode:'all',children:[0,1]}]},expected:[3]},
    {name:'父NULL与子集合嵌套遵守三值逻辑',filters:[{side:'parent',column:'note',operator:'IS NULL'},{side:'child',column:'label',operator:'IN',values:['','comma,a']},{side:'child',column:'id',operator:'=',value:ids[2]}],group:{mode:'all',children:[0,{mode:'any',children:[1,2]}]},expected:[1,3]},
    {name:'分组后按原排序及LIMIT取首行',limit:1,filters:[{side:'child',column:'id',operator:'>=',value:ids[0]},{side:'child',column:'label',operator:'=',value:''},{side:'parent',column:'amount',operator:'>',value:'12.3400'}],group:{mode:'all',children:[0,{mode:'any',children:[1,2]}]},expected:[1]},
  );
  return conditions.map(value=>{
    const options:ForeignKeyJoinOptions={childColumns:['id','label'],parentColumns:['amount','note'],filters:value.filters,filterMode:value.mode??'all',...(value.group?{filterGroup:value.group}:{}),sort:[{side:'child',column:'id',direction:'ASC'}],...(value.limit?{limit:value.limit}:{})};
    const generated=buildForeignKeyJoin(child,parent,'fk','LEFT',43,options).sql;
    const before='FROM `join_filter_fixture`.`child` AS c\nLEFT JOIN `join_filter_fixture`.`parent` AS p\n';if(generated.split(before).length!==2)throw Error('JOIN条件只读FROM替换目标不唯一');
    const sql=generated.replace(before,'FROM (\n'+c+'\n) AS c\nLEFT JOIN (\n'+p+'\n) AS p\n');
    return{name:value.name,options,generated,sql,expected:value.expected.map(index=>({c_1_id:ids[index],c_3_label:labels[index],p_2_amount:parentAmounts[index],p_3_note:notes[index]}))};
  });
}
