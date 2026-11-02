import type { ForeignKeyJoinOptions } from '../../src/renderer/tableForeignKeyJoin';
import type { ForeignKeyJoinAggregate } from '../../src/renderer/tableForeignKeyJoinSummary';

/** 只消费已预置的十条合成行；预期独立列出，不执行参照SQL或用产品输出证明自身。 */
export function foreignKeyJoinSummaryReadOnlyCases(): {name:string;options:ForeignKeyJoinOptions;expected:Record<string,unknown>[]}[] {
  const n:ForeignKeyJoinAggregate={fn:'COUNT_ALL',alias:'n'}, sum:ForeignKeyJoinAggregate={fn:'SUM',side:'parent',column:'amount',alias:'s'}, avg:ForeignKeyJoinAggregate={fn:'AVG',side:'parent',column:'amount',alias:'a'};
  const parentGroups=[{side:'parent' as const,column:'id'}], byParent=[{side:'parent' as const,column:'id',direction:'ASC' as const,nulls:'LAST' as const}];
  const base={childColumns:['id'],parentColumns:['amount']}, maximum='99999999999999999999.1234', total='100000000000000000023.8034', mean='25000000000000000005.95085000';
  const parentRows=[{p_1_id:'100',n:'2',s:'24.6800',a:'12.34000000'},{p_1_id:'200',n:'1',s:maximum,a:'99999999999999999999.12340000'},{p_1_id:'300',n:'1',s:'0.0000',a:'0.00000000'},{p_1_id:null,n:'2',s:null,a:null}];
  return [
    {name:'COUNT星号非空字段与不同父键区分',options:{...base,summary:{groups:[],aggregates:[n,{fn:'COUNT',side:'parent',column:'id',alias:'matched'},{fn:'COUNT_DISTINCT',side:'parent',column:'id',alias:'parents'},{fn:'COUNT',side:'child',column:'id',alias:'children'}]}},expected:[{n:'6',matched:'4',parents:'3',children:'6'}]},
    {name:'高精度DECIMAL合计平均及极值保持原回包',options:{...base,summary:{groups:[],aggregates:[sum,avg,{fn:'MIN',side:'parent',column:'amount',alias:'lo'},{fn:'MAX',side:'parent',column:'amount',alias:'hi'}]}},expected:[{s:total,a:mean,lo:'0.0000',hi:maximum}]},
    {name:'UINT64合计不溢出或转JS数字',options:{...base,summary:{groups:[],aggregates:[{fn:'SUM',side:'child',column:'id',alias:'sum_id'},{fn:'MIN',side:'child',column:'id',alias:'min_id'},{fn:'MAX',side:'child',column:'id',alias:'max_id'}]}},expected:[{sum_id:['9007199254740993','9007199254740994','18446744073709551615','9007199254740995','9007199254740996','18446744073709551614'].reduce((n,s)=>n+BigInt(s),0n).toString(),min_id:'9007199254740993',max_id:'18446744073709551615'}]},
    {name:'父键分组含未匹配NULL与重复父值',options:{...base,summary:{groups:parentGroups,aggregates:[n,sum,avg]},sort:byParent},expected:parentRows},
    {name:'子键分组与父键同名分开',options:{...base,summary:{groups:[{side:'child',column:'pid'}],aggregates:[n]},sort:[{side:'child',column:'pid',direction:'ASC',nulls:'LAST'}]},expected:[{c_2_pid:'100',n:'2'},{c_2_pid:'200',n:'1'},{c_2_pid:'300',n:'1'},{c_2_pid:null,n:'2'}]},
    {name:'文本NULL分组合并真实父NULL及未匹配',options:{...base,summary:{groups:[{side:'parent',column:'note'}],aggregates:[n,sum]},sort:[{side:'parent',column:'note',direction:'ASC',nulls:'FIRST'}]},expected:[{p_3_note:null,n:'4',s:'24.6800'},{p_3_note:'',n:'1',s:'0.0000'},{p_3_note:'parent200',n:'1',s:maximum}]},
    {name:'双方同名有序复合分组完整输出',options:{...base,summary:{groups:[...parentGroups,{side:'child',column:'pid'}],aggregates:[n]},sort:byParent},expected:[{p_1_id:'100',c_2_pid:'100',n:'2'},{p_1_id:'200',c_2_pid:'200',n:'1'},{p_1_id:'300',c_2_pid:'300',n:'1'},{p_1_id:null,c_2_pid:null,n:'2'}]},
    {name:'仅GROUPBY不强行增加指标',options:{...base,summary:{groups:parentGroups,aggregates:[]},sort:byParent},expected:[{p_1_id:'100'},{p_1_id:'200'},{p_1_id:'300'},{p_1_id:null}]},
    {name:'空输入无分组COUNT零其余NULL',options:{...base,filters:[{side:'child',column:'id',operator:'=',value:'0'}],summary:{groups:[],aggregates:[n,sum,avg,{fn:'MIN',side:'child',column:'id',alias:'lo'}]}},expected:[{n:'0',s:null,a:null,lo:null}]},
    {name:'空输入有分组不产生伪汇总行',options:{...base,filters:[{side:'child',column:'id',operator:'=',value:'0'}],summary:{groups:parentGroups,aggregates:[n]}},expected:[]},
    {name:'父非空WHERE先减少输入再聚合',options:{...base,filters:[{side:'parent',column:'id',operator:'IS NOT NULL'}],summary:{groups:[],aggregates:[n,sum,{fn:'COUNT_DISTINCT',side:'parent',column:'id',alias:'parents'}]}},expected:[{n:'4',s:total,parents:'3'}]},
    {name:'嵌套OR条件先筛出两个同父子行',options:{...base,filters:[{side:'child',column:'id',operator:'=',value:'9007199254740993'},{side:'child',column:'id',operator:'=',value:'9007199254740995'}],filterMode:'any',filterGroup:{mode:'any',children:[{mode:'all',children:[0]},1]},summary:{groups:parentGroups,aggregates:[n,sum,avg]}},expected:[parentRows[0]]},
    {name:'指标NULL位置及排序LIMIT作用于聚合后',options:{...base,summary:{groups:parentGroups,aggregates:[sum]},sort:[{side:'aggregate',column:'s',direction:'DESC',nulls:'LAST'},{side:'parent',column:'id',direction:'ASC'}],limit:2},expected:[{p_1_id:'200',s:maximum},{p_1_id:'100',s:'24.6800'}]},
    {name:'指标别名与源id同名仍排序原COUNT',options:{...base,summary:{groups:parentGroups,aggregates:[{fn:'COUNT_ALL',alias:'id'}]},sort:[{side:'aggregate',column:'id',direction:'DESC'},...byParent]},expected:[{p_1_id:'100',id:'2'},{p_1_id:null,id:'2'},{p_1_id:'200',id:'1'},{p_1_id:'300',id:'1'}]},
    {name:'文本不同值保留空串引号反斜杠NUL和emoji',options:{...base,summary:{groups:[],aggregates:[{fn:'COUNT_DISTINCT',side:'child',column:'label',alias:'distinct_labels'},{fn:'MIN',side:'child',column:'label',alias:'lo'},{fn:'MAX',side:'child',column:'label',alias:'hi'}]}},expected:[{distinct_labels:'6',lo:'',hi:"中文'\\:fake;--\0🚢"}]},
    {name:'父文本MINMAX忽略NULL但COUNT包含空串',options:{...base,summary:{groups:[],aggregates:[{fn:'MIN',side:'parent',column:'note',alias:'lo'},{fn:'MAX',side:'parent',column:'note',alias:'hi'},{fn:'COUNT',side:'parent',column:'note',alias:'n'}]}},expected:[{lo:'',hi:'parent200',n:'2'}]},
  ];
}
