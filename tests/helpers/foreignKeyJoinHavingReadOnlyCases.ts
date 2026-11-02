import type { ForeignKeyJoinOptions } from '../../src/renderer/tableForeignKeyJoin';
import type { ForeignKeyJoinHaving } from '../../src/renderer/tableForeignKeyJoinHaving';

/** 仅对预置合成行列出独立预期；不执行参照SQL或用生成器计算答案。 */
export function foreignKeyJoinHavingReadOnlyCases():{name:string;options:ForeignKeyJoinOptions;expected:Record<string,unknown>[]}[]{
  const maximum='99999999999999999999.1234',uint='18446744073709551615',sentinel="中文'\\:fake;--\0🚢";
  const rows:Record<string,unknown>[]=[
    {p_1_id:'100',n:'2',matched:'2',s:'24.6800',a:'12.34000000',min_id:'9007199254740993',max_id:'9007199254740995',note:null},
    {p_1_id:'200',n:'1',matched:'1',s:maximum,a:'99999999999999999999.12340000',min_id:uint,max_id:uint,note:'parent200'},
    {p_1_id:'300',n:'1',matched:'1',s:'0.0000',a:'0.00000000',min_id:'18446744073709551614',max_id:'18446744073709551614',note:''},
    {p_1_id:null,n:'2',matched:'0',s:null,a:null,min_id:'9007199254740994',max_id:'9007199254740996',note:null},
  ];
  const base:ForeignKeyJoinOptions={childColumns:['id'],parentColumns:[],summary:{groups:[{side:'parent',column:'id'}],aggregates:[{fn:'COUNT_ALL',alias:'n'},{fn:'COUNT',side:'parent',column:'id',alias:'matched'},{fn:'SUM',side:'parent',column:'amount',alias:'s'},{fn:'AVG',side:'parent',column:'amount',alias:'a'},{fn:'MIN',side:'child',column:'id',alias:'min_id'},{fn:'MAX',side:'child',column:'id',alias:'max_id'},{fn:'MAX',side:'parent',column:'note',alias:'note'}]},sort:[{side:'parent',column:'id',direction:'ASC',nulls:'LAST'}]};
  const q=(name:string,having:ForeignKeyJoinHaving,indices:number[],extra:Partial<ForeignKeyJoinOptions>={})=>({name,options:{...base,...extra,having},expected:indices.map(index=>rows[index])});
  const one=(column:string,operator:'='|'!='|'>'|'>='|'<'|'<=',value:string):ForeignKeyJoinHaving=>({filters:[{column,operator,value}]});
  const result:{name:string;options:ForeignKeyJoinOptions;expected:Record<string,unknown>[]}[]=[
    q('HAVING计数在分组后过滤两个JOIN行',one('n','>=','2'),[0,3]),
    q('HAVING非空父计数区分未匹配子组',one('matched','=','0'),[3]),
    q('HAVING精确合计不降DOUBLE',one('s','>','24.6800'),[1]),
    q('HAVING八位平均值按原文精确比较',one('a','=','99999999999999999999.12340000'),[1]),
    q('HAVING合计NULL匹配全无父值组',{filters:[{column:'s',operator:'IS NULL'}]},[3]),
    q('HAVING非NULL保留真实零金额',{filters:[{column:'s',operator:'IS NOT NULL'}]},[0,1,2]),
    q('HAVING计数区间双边界完整保留',{filters:[{column:'n',operator:'BETWEEN',values:['2','2']}]},[0,3]),
    q('HAVING金额集合不转成字符串拼接',{filters:[{column:'s',operator:'IN',values:['24.6800','0.0000']}]},[0,2]),
    q('HAVING金额排除集合遵守三值逻辑',{filters:[{column:'s',operator:'NOT IN',values:[maximum]}]},[0,2]),
    q('HAVING可引用明确输出的分组字段',one('p_1_id','=','100'),[0]),
    q('HAVING指标别名id不改绑到源id',one('id','=',uint),[],{summary:{...base.summary!,aggregates:base.summary!.aggregates.map(value=>value.alias==='min_id'?{...value,alias:'id'}:value)}}),
    q('HAVING UINT64最大值MAX比较无精度损失',one('max_id','=',uint),[1]),
    q('HAVING文本指标特殊字符独立编码',one('label_max','=',sentinel),[],{summary:{...base.summary!,aggregates:[...base.summary!.aggregates,{fn:'MAX',side:'child',column:'label',alias:'label_max'}]}}),
    {name:'空输入全体汇总HAVING计数零保留一行',options:{...base,sort:[],filters:[{side:'child',column:'id',operator:'=',value:'0'}],summary:{groups:[],aggregates:[{fn:'COUNT_ALL',alias:'n'},{fn:'SUM',side:'parent',column:'amount',alias:'s'}]},having:one('n','=','0')},expected:[{n:'0',s:null}]},
    {name:'空输入全体汇总HAVING可排除伪结果',options:{...base,sort:[],filters:[{side:'child',column:'id',operator:'=',value:'0'}],summary:{groups:[],aggregates:[{fn:'COUNT_ALL',alias:'n'}]},having:one('n','>','0')},expected:[]},
    q('HAVING AND中嵌套OR保留NULL分支',{filters:[{column:'n',operator:'>=',value:'2'},{column:'s',operator:'>',value:'0'},{column:'s',operator:'IS NULL'}],group:{mode:'all',children:[0,{mode:'any',children:[1,2]}]}},[0,3]),
    q('HAVING停用AND子树不能让OR为真',{filters:[{column:'n',operator:'=',value:'无效数字',enabled:false},{column:'s',operator:'IS NULL',enabled:false},{column:'p_1_id',operator:'=',value:'300'}],mode:'any',group:{mode:'any',children:[{mode:'all',children:[0,1]},2]}},[2]),
    {name:'仅分组也支持HAVING键NULL',options:{...base,summary:{groups:base.summary!.groups,aggregates:[]},having:{filters:[{column:'p_1_id',operator:'IS NULL'}]}},expected:[{p_1_id:null}]},
    q('HAVING发生在指标排序和LIMIT之前',{filters:[{column:'s',operator:'IS NOT NULL'}]},[1,0],{sort:[{side:'aggregate',column:'s',direction:'DESC',nulls:'LAST'},{side:'parent',column:'id',direction:'ASC'}],limit:2}),
    q('全停用HAVING不生成恒真条件',{filters:[{column:'n',operator:'=',value:'无效数字',enabled:false}],group:{mode:'all',children:[0]}},[0,1,2,3]),
    q('HAVING文本LIKE按原表达式比较',{filters:[{column:'note',operator:'LIKE',value:'%200'}]},[1]),
    q('HAVING文本NOTLIKE包含空串但不包含NULL',{filters:[{column:'note',operator:'NOT LIKE',value:'%200'}]},[2]),
    q('HAVING计数不等比较',one('n','!=','1'),[0,3]),
    q('HAVING金额小于等于保留精确边界',one('s','<=','24.6800'),[0,2]),
    q('HAVING计数严格小于边界',one('n','<','2'),[1,2]),
    q('WHERE先取三个输入行再HAVING计数组',{filters:[{column:'n',operator:'>=',value:'2'}]},[0],{filters:[{side:'child',column:'id',operator:'BETWEEN',values:['9007199254740993','9007199254740995']}]}),
    {name:'HAVING文本分组键特殊字符不被推成任意SQL',options:{...base,sort:[],summary:{groups:[{side:'child',column:'label'}],aggregates:[{fn:'COUNT_ALL',alias:'n'}]},having:one('c_3_label','=',sentinel)},expected:[{c_3_label:sentinel,n:'1'}]},
  ];
  // 两个扩展投影的准确期望独立补字段；依旧不取任何实际查询输出。
  const {min_id,...renamed}=rows[1];result[10].expected=[{...renamed,id:min_id}];result[12].expected=[{...rows[0],label_max:sentinel}];
  return result;
}
