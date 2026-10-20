import { describe, expect, it, vi } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { QueryResultFilter, queryResultFilterLimits, queryResultFilterOperators, queryResultFilteredSortView, type QueryResultFilterRule } from '../../src/renderer/queryResultFilter';
import { QueryResultSort } from '../../src/renderer/queryResultSort';
import { queryResultFilterZh as text } from '../../src/renderer/locales/queryResultFilter.zh-CN';
/** 仅RAM协议对象，不打开DB、文件、窗口或系统剪贴板。 */
function fixture(type='TEXT',values:CellValue[]=['a','',null,'b']){
  const source:QueryResult={columns:[{key:'k',name:'同名',type},{key:'group',name:'同名',type:'TEXT'}],rows:values.map((k,i)=>({k,group:i%2?'B':'A'})),truncated:true,statement:'原SQL',elapsedMs:1},filter=new QueryResultFilter(),binding=filter.bind(source,['current'])!;
  return{source,filter,binding,apply:(rules:QueryResultFilterRule[],mode:'AND'|'OR'='AND')=>filter.apply(binding,filter.view(binding)!,rules,mode)};
}
const rule=(operator:QueryResultFilterRule['operator'],value='',column='k'):QueryResultFilterRule=>({column,operator,value});
describe('已返回结果本地条件语义与原行身份',()=>{
  it('文本包含/等于/不等于保持原文、空串、NULL独立，不执行正则或转换JSON',()=>{
    const f=fixture('TEXT',['A.*','A','',null,'null','a']);expect(f.apply([rule('contains','.*')]).sourceIndices).toEqual([0]);expect(f.apply([rule('eq','')]).sourceIndices).toEqual([2]);expect(f.apply([rule('ne','')]).sourceIndices).toEqual([0,1,4,5]);expect(f.apply([rule('contains','')]).sourceIndices).toEqual([0,1,2,4,5]);expect(f.apply([rule('eq','null')]).sourceIndices).toEqual([4]);
  });
  it.each([
    ['notContains',[3,5,7]],['startsWith',[0,2,6]],['notStartsWith',[1,3,5,7]],
    ['endsWith',[0,1]],['notEndsWith',[2,3,5,6,7]],['empty',[3]],['notEmpty',[0,1,2,5,6,7]]
  ] as const)('%s按原文本匹配且排除NULL，原行顺序和引用保持', (operator, expected) => {
    const f=fixture('TEXT',['开头.*结尾','.*结尾','开头.*','',null,'开头X结尾','开头.*结尾 ','🚢e\u0301🚢']);
    const input=operator==='notContains'?'.*':operator==='startsWith'||operator==='notStartsWith'?'开头.*':operator==='endsWith'||operator==='notEndsWith'?'.*结尾':'';
    const saved=structuredClone(f.source),view=f.apply([rule(operator,input)]);
    expect(view.sourceIndices).toEqual(expected);view.sourceIndices.forEach((index,i)=>expect(view.result.rows[i]).toBe(f.source.rows[index]));expect(f.source).toEqual(saved);
  });
  it.each(['contains','notContains','startsWith','notStartsWith','endsWith','notEndsWith'] as const)('%s的空条件仍按字面匹配，不把空文本或NULL混同', operator => {
    const f=fixture('TEXT',['',' ','普通',null]);
    expect(f.apply([rule(operator,'')]).sourceIndices).toEqual(operator.startsWith('not')?[]:[0,1,2]);
  });
  it('百分号、下划线、反斜杠和正则符号按字面匹配，不成为SQL通配符',()=>{
    const f=fixture('TEXT',['%_.*尾','前%_.*','\\%_.*','任意文本',null]);
    expect(f.apply([rule('startsWith','%_.*')]).sourceIndices).toEqual([0]);
    expect(f.apply([rule('endsWith','%_.*')]).sourceIndices).toEqual([1,2]);
    expect(f.apply([rule('notContains','%_.*')]).sourceIndices).toEqual([3]);
  });
  it('前后缀保留Unicode组合形式、大小写和两侧空白，不做归一化',()=>{
    const f=fixture('TEXT',['🚢e\u0301','🚢é','🚢e\u0301🚢',' 🚢e\u0301','🚢E\u0301',null]);
    expect(f.apply([rule('startsWith','🚢e\u0301')]).sourceIndices).toEqual([0,2]);
    expect(f.apply([rule('endsWith','e\u0301')]).sourceIndices).toEqual([0,3]);
    expect(f.apply([rule('notStartsWith','🚢')]).sourceIndices).toEqual([3]);
  });
  it.each(['empty','notEmpty'] as const)('%s不接受隐藏条件值，失败保持上次视图',operator=>{
    const f=fixture('TEXT',['',' ',null]),before=f.filter.view(f.binding)!;
    expect(()=>f.apply([rule(operator,'旧条件不可隐藏')])).toThrow(text.invalid);expect(f.filter.view(f.binding)).toBe(before);
    expect(f.apply([rule(operator)]).sourceIndices).toEqual(operator==='empty'?[0]:[1]);
  });
  it.each(['BIGINT','DECIMAL','DATETIME','BIT','GEOMETRY'])('%s不因新增文本条件扩大类型准入',type=>{
    const f=fixture(type,[null]),before=f.filter.view(f.binding)!;
    for(const operator of ['notContains','startsWith','notStartsWith','endsWith','notEndsWith','empty','notEmpty'] as const){
      expect(queryResultFilterOperators(f.source.columns[0])).not.toContain(operator);expect(()=>f.apply([rule(operator)])).toThrow(text.invalid);expect(f.filter.view(f.binding)).toBe(before);
    }
  });
  it('BLOB字节包装不因否定或空文本判断被当成字符串，不解码',()=>{
    const f=fixture('BLOB',[{type:'binary',base64:''},null]),before=f.filter.view(f.binding)!;
    for(const operator of ['notContains','startsWith','notStartsWith','endsWith','notEndsWith','empty','notEmpty'] as const){expect(()=>f.apply([rule(operator)])).toThrow(text.value);expect(f.filter.view(f.binding)).toBe(before);}
  });
  it.each([
    ['BIGINT',['9007199254740992','9007199254740993',null],'9007199254740992'],
    ['DECIMAL',['0.12345678901234567890','0.12345678901234567891',null],'0.12345678901234567890'],
    ['DATETIME',['2026-10-19 12:00:00.000001','2026-10-19 12:00:00.000002',null],'2026-10-19 12:00:00.000001'],
    ['TIME',['-100:00:00.000001','-99:59:59.999999',null],'-100:00:00.000001'],
    ['DATE',['0000-00-00','2026-10-19',null],'0000-00-00'],
    ['DOUBLE',[1.25,2.5,null],'1.25'],
  ] as [string,CellValue[],string][])('%s六种比较按声明类型和原精度，NULL不会被普通不等于包含', (type,values,input)=>{
    const f=fixture(type,values);expect(f.apply([rule('eq',input)]).sourceIndices).toEqual([0]);expect(f.apply([rule('ne',input)]).sourceIndices).toEqual([1]);expect(f.apply([rule('gt',input)]).sourceIndices).toEqual([1]);expect(f.apply([rule('gte',input)]).sourceIndices).toEqual([0,1]);expect(f.apply([rule('lt',input)]).sourceIndices).toEqual([]);expect(f.apply([rule('lte',input)]).sourceIndices).toEqual([0]);
  });
  it('负零、前导零和小数尾零是数学相等值，未改变原字符串',()=>{
    const f=fixture('DECIMAL',['-0.0','000.000','0','1.000']);expect(f.apply([rule('eq','+0.000')]).sourceIndices).toEqual([0,1,2]);expect(f.source.rows[0].k).toBe('-0.0');
  });
  it.each([
    ['DECIMAL','.12345678901234567890','0.12345678901234567890','0.12345678901234567891'],
    ['NEWDECIMAL',' +1. ','1.000','1.00000000000000000001'],
    ['NUMERIC','-.5','-0.5000','-0.49999999999999999999'],
    ['DECIMAL UNSIGNED','+.5','0.5','0.50000000000000000001'],
    ['DECIMAL','-.0','-0.000','0.00000000000000000001'],
    ['FLOAT','.5',0.5,0.6],['DOUBLE','1.e2',100,101],['DOUBLE','-.5e-2',-0.005,-0.004],
  ] as [string,string,CellValue,CellValue][])('%s小数简写%s只规范化比较输入，保存原条件及精度', (type,input,value,next)=>{
    const f=fixture(type,[value,next,null]),saved=structuredClone(f.source),view=f.apply([rule('eq',input)]);
    expect(view.sourceIndices).toEqual([0]); expect(view.rules[0].value).toBe(input);
    expect(view.result.rows[0]).toBe(f.source.rows[0]);expect(f.source).toEqual(saved);
    expect(f.apply([rule('gt',input)]).sourceIndices).toEqual([1]);
  });
  it.each([['BIGINT','.5'],['INT','1.'],['DECIMAL','.'],['DECIMAL','1.e2'],['DECIMAL','1e2'],['DECIMAL','1.2.'],['DOUBLE','.e2'],['DECIMAL UNSIGNED','-.1'],['DOUBLE','.5e9999']] as const)('%s简写不扩大整数、科学精确数、符号或非法值准入：%s',(type,input)=>{
    const f=fixture(type,[null]),before=f.filter.view(f.binding);
    expect(()=>f.apply([rule('eq',input)])).toThrow(text.value);expect(f.filter.view(f.binding)).toBe(before);
  });
  it.each(['.5','1.'])('返回的DECIMAL原值%s仍须通过原严格协议格式，不借条件简写修补数据',value=>{
    const f=fixture('DECIMAL',[value]),before=f.filter.view(f.binding);
    expect(()=>f.apply([rule('eq',value)])).toThrow(text.value);expect(f.filter.view(f.binding)).toBe(before);
    const sort=new QueryResultSort(),binding=sort.bind(f.source,[])!;
    expect(()=>sort.apply(binding,sort.view(binding)!,{column:'k',direction:'ASC'})).toThrow();
  });
  it('文本条件不规范化；小数区间和成员列表共享输入准入但保留各自原文',()=>{
    const literal=fixture('TEXT',['.5','0.5']);expect(literal.apply([rule('eq','.5')]).sourceIndices).toEqual([0]);
    const f=fixture('DECIMAL',['0.49999999999999999999','0.5','1.000',null]);
    const range=f.apply([{...rule('between','.5'),upper:'1.'}]);expect(range.sourceIndices).toEqual([1,2]);expect(range.rules[0]).toEqual({...rule('between','.5'),upper:'1.'});
    const list=f.apply([{...rule('in'),values:['.5','1.']}]);expect(list.sourceIndices).toEqual([1,2]);expect(list.rules[0].values).toEqual(['.5','1.']);
  });
  it('补零后的完整DECIMAL输入仍受原4096单位键上限约束，失败保留旧投影',()=>{
    const f=fixture('DECIMAL',['0']),before=f.filter.view(f.binding),input='.'+'1'.repeat(queryResultFilterLimits.valueUnits-1);
    expect(input.length).toBe(queryResultFilterLimits.valueUnits);expect(()=>f.apply([rule('eq',input)])).toThrow(text.value);expect(f.filter.view(f.binding)).toBe(before);
  });
  it('AND/OR按完整条件求值，无条件保留全部，逐条移除回到原视图',()=>{
    const f=fixture();expect(f.apply([rule('eq','a'),rule('eq','B','group')],'AND').sourceIndices).toEqual([]);expect(f.apply([rule('eq','a'),rule('eq','B','group')],'OR').sourceIndices).toEqual([0,1,3]);expect(f.apply([rule('eq','a')]).sourceIndices).toEqual([0]);expect(f.apply([],'OR').result).toBe(f.source);
  });
  it.each(['BLOB','GEOMETRY','未知'])('%s未知/字节只允许NULL判断；二进制不解码，不把空字节当空串',type=>{
    const f=fixture(type,[null,{type:'binary',base64:''},{type:'binary',base64:'AA=='}]);expect(f.apply([rule('null')]).sourceIndices).toEqual([0]);expect(f.apply([rule('notNull')]).sourceIndices).toEqual([1,2]);expect(()=>f.apply([rule('eq','')])).toThrow();
  });
  it('过滤先于多列排序，显式合成原源位置，原行、原列、SQL及原顺序均保持',()=>{
    const f=fixture('BIGINT',['3','1','2','4']),saved=structuredClone(f.source),view=f.apply([rule('gte','2')]),sorter=new QueryResultSort(),sort=sorter.bind(view.result,[])!,sorted=sorter.apply(sort,sorter.view(sort)!,[{column:'group',direction:'ASC'},{column:'k',direction:'ASC'}]),joined=queryResultFilteredSortView(view,sorted)!;
    expect(view.sourceIndices).toEqual([0,2,3]);expect(joined.sourceIndices).toEqual([2,0,3]);expect(joined.result).toBe(sorted.result);joined.sourceIndices.forEach((sourceIndex,i)=>expect(joined.result.rows[i]).toBe(f.source.rows[sourceIndex]));expect(joined.result.columns).toBe(f.source.columns);expect(f.source).toEqual(saved);expect(Object.isFrozen(view.rules)).toBe(true);expect(Object.isFrozen(view.result.rows)).toBe(true);expect(Object.isFrozen(f.source.rows)).toBe(false);expect(f.apply([]).result).toBe(f.source);
  });
  it('排序映射若不属于该过滤视图则拒绝，不能按显示下标混用另一个源',()=>{
    const f=fixture(),view=f.apply([rule('eq','a')]);expect(()=>queryResultFilteredSortView(view,{result:f.source,sourceIndices:[0,1,2,3],rules:[]})).toThrow(text.stale);
  });
  it('只读取可见条件列，隐藏getter不执行；内部原型同名key通过自有属性定位',()=>{
    const f=fixture(),getter=vi.fn(()=>{throw Error('不能读隐藏值');});f.source.columns.push({key:'hidden',name:'秘密',type:'TEXT'});f.source.rows.forEach(row=>Object.defineProperty(row,'hidden',{get:getter}));const filter=new QueryResultFilter(),b=filter.bind(f.source,[],[f.source.columns[0]])!;expect(filter.apply(b,filter.view(b)!,[rule('eq','a')],'AND').sourceIndices).toEqual([0]);expect(getter).not.toHaveBeenCalled();expect(()=>filter.apply(b,filter.view(b)!,[rule('eq','x','hidden')],'AND')).toThrow(text.invalid);
  });
  it.each([['BIGINT',''],['DECIMAL','NaN'],['TIME','839:00:00'],['DATETIME','2026-10-19T12:00:00Z'],['BIGINT UNSIGNED','-1'],['DOUBLE','Infinity']] as const)('%s无效输入%s不猜测也不更改旧投影',(type,input)=>{
    const f=fixture(type,[null]),before=f.filter.view(f.binding)!;expect(()=>f.apply([rule('eq',input)])).toThrow(text.value);expect(f.filter.view(f.binding)).toBe(before);
  });
  it('坏返回值不会因OR已匹配或较早条件失败而被短路跳过',()=>{
    const f=fixture('BIGINT',['1','坏值']);expect(()=>f.apply([rule('eq','A','group'),rule('eq','1')],'OR')).toThrow(text.value);expect(()=>f.apply([rule('eq','永不匹配','group'),rule('eq','1')],'AND')).toThrow(text.value);
  });
});
describe('精确数值和时间区间筛选',()=>{
  it.each([
    ['BIGINT',['9007199254740992','9007199254740993','18446744073709551615',null],'9007199254740993','18446744073709551615'],
    ['DECIMAL',['-0.00000000000000000001','0.12345678901234567890','0.12345678901234567891',null],'0.12345678901234567890','0.12345678901234567891'],
    ['DATE',['0000-00-00','2026-10-19','2026-10-20',null],'2026-10-19','2026-10-20'],
    ['DATETIME',['2026-10-19 12:00:00.000000','2026-10-19 12:00:00.000001','2026-10-19 12:00:00.000002',null],'2026-10-19 12:00:00.000001','2026-10-19 12:00:00.000002'],
    ['TIME',['-100:00:00.000002','-100:00:00.000001','00:00:00',null],'-100:00:00.000001','00:00:00'],
    ['DOUBLE',[-1.5,0.1,0.2,null],'0.1','0.2'],
  ] as const)('%s区间包含两端，否定区间排除两端和NULL，不更改原源',(type,values,value,upper)=>{
    const f=fixture(type,[...values]),saved=structuredClone(f.source);
    const inside=f.apply([{...rule('between',value),upper}]);expect(inside.sourceIndices).toEqual([1,2]);
    expect(inside.result.rows).toEqual([f.source.rows[1],f.source.rows[2]]);expect(inside.result.rows[0]).toBe(f.source.rows[1]);
    expect(f.apply([{...rule('notBetween',value),upper}]).sourceIndices).toEqual([0]);expect(f.source).toEqual(saved);
  });
  it('数学上相等的两端与负零保持精度，OR只有显式NULL条件才纳入NULL',()=>{
    const f=fixture('DECIMAL',['-0','0.000','0.00000000000000000001',null]);
    expect(f.apply([{...rule('between',' -0.000 '),upper:' +0.0 '}]).sourceIndices).toEqual([0,1]);
    expect(f.apply([{...rule('notBetween','0.0'),upper:'-0'},rule('null')],'OR').sourceIndices).toEqual([2,3]);
  });
  it.each(['between','notBetween'] as const)('%s上下限颠倒即使没有行或OR已满足也完整拒绝',operator=>{
    for(const values of [[],['1']] as CellValue[][]){const f=fixture('BIGINT',values),before=f.filter.view(f.binding)!;
      expect(()=>f.apply([rule('notNull'),{...rule(operator,'2'),upper:'1'}],'OR')).toThrow(text.rangeOrder);expect(f.filter.view(f.binding)).toBe(before);
    }
  });
  it.each([undefined,null,1] as const)('上限缺失或不是原文字符串（%s）不采用部分条件',upper=>{
    const f=fixture('BIGINT',['1']),before=f.filter.view(f.binding)!;
    expect(()=>f.apply([{...rule('between','0'),upper} as unknown as QueryResultFilterRule])).toThrow(text.invalid);expect(f.filter.view(f.binding)).toBe(before);
  });
  it.each([['BIGINT',''],['BIGINT UNSIGNED','-1'],['TIME','839:00:00'],['DATETIME','2026-10-19T12:00:00Z'],['DOUBLE','Infinity']] as const)('%s的非法上限%s仍按原类型拒绝',(type,upper)=>{
    const lower=type==='TIME'?'00:00:00':type==='DATETIME'?'2026-10-19 12:00:00':'0',f=fixture(type,[null]),before=f.filter.view(f.binding)!;
    expect(()=>f.apply([{...rule('between',lower),upper}])).toThrow(text.value);expect(f.filter.view(f.binding)).toBe(before);
  });
  it.each(['TEXT','JSON','BIT','GEOMETRY','未知'])('%s不能借区间条件获得数值比较资格',type=>{
    const f=fixture(type,[null]);for(const operator of ['between','notBetween'] as const){expect(queryResultFilterOperators(f.source.columns[0])).not.toContain(operator);expect(()=>f.apply([{...rule(operator,'0'),upper:'1'}])).toThrow(text.invalid);}
  });
  it.each(['eq','null'] as const)('切换至%s后不得保留隐藏上限',operator=>{
    const f=fixture('BIGINT',['1']);expect(()=>f.apply([{...rule(operator,operator==='null'?'':'1'),upper:'2'}])).toThrow(text.invalid);
  });
  it('上下限都计入输入预算，区间按两个比较计费且不改变旧视图',()=>{
    const f=fixture('BIGINT',['1']),before=f.filter.view(f.binding)!;
    expect(()=>f.apply([{...rule('between','0'),upper:'9'.repeat(4097)}])).toThrow(text.budget);expect(f.filter.view(f.binding)).toBe(before);
    const g=fixture('BIGINT',Array.from({length:100000},()=>null)),range={...rule('between','0'),upper:'1'};
    const boundary=g.apply(Array.from({length:10},()=>range));expect(boundary.result.rows).toEqual([]);
    expect(()=>g.apply([...Array.from({length:10},()=>range),rule('null')])).toThrow(text.budget);expect(g.filter.view(g.binding)).toBe(boundary);
  });
  it('超过条件数先拒绝，不为统计区间工作量读取超限规则',()=>{
    const f=fixture(),operator=vi.fn(()=>'between'),rules=Array.from({length:33},()=>Object.defineProperty({...rule('eq')},'operator',{get:operator}));
    expect(()=>f.apply(rules)).toThrow(text.budget);expect(operator).not.toHaveBeenCalled();
  });
  it('区间两端共用字符工作预算，不能只计算下限的比较工作',()=>{
    const value='5'.repeat(4096),f=fixture('DECIMAL',Array.from({length:1000},()=>value)),before=f.filter.view(f.binding)!;
    expect(()=>f.apply(Array.from({length:3},()=>({...rule('between','0'),upper:'9'.repeat(4096)})))).toThrow(text.budget);expect(f.filter.view(f.binding)).toBe(before);
  });
  it('已应用上限冻结且排除行漂移仍撤销，恢复值不能复活原区间',()=>{
    const f=fixture('BIGINT',['1','2','3']),range={...rule('between','2'),upper:'3'},view=f.apply([range]);range.upper='99';
    expect(view.rules[0].upper).toBe('3');expect(Object.isFrozen(view.rules[0])).toBe(true);
    f.source.rows[0].k='2';expect(f.filter.view(f.binding)).toBeUndefined();f.source.rows[0].k='1';expect(()=>f.filter.apply(f.binding,view,[],'AND')).toThrow(text.stale);
  });
});

describe('多值成员按原类型和预算匹配',()=>{
  /** 每个值独立传入，绝不借CSV或SQL字符串解析生产期待。 */
  const members=(values:readonly string[],operator:'in'|'notIn'='in'):QueryResultFilterRule=>({...rule(operator),values});
  it('文本成员保留空串、换行、逗号、引号、大小写和Unicode，正反均排除NULL',()=>{
    const f=fixture('TEXT',['','a,b','a\nb',"'a'",'NULL',null,'A','é','e\u0301']),values=['','a,b','a\nb',"'a'",'NULL','e\u0301'];
    expect(f.apply([members(values)]).sourceIndices).toEqual([0,1,2,3,4,8]);expect(f.apply([members(values,'notIn')]).sourceIndices).toEqual([6,7]);
    expect(f.apply([members(values),rule('null')],'OR').sourceIndices).toEqual([0,1,2,3,4,5,8]);
  });
  it.each([
    ['BIGINT',['9007199254740992','9007199254740993',null],'9007199254740993'],
    ['BIGINT UNSIGNED',['18446744073709551614','18446744073709551615',null],'18446744073709551615'],
    ['DECIMAL',['0.12345678901234567890','0.12345678901234567891',null],'0.12345678901234567891'],
    ['DATETIME',['2026-10-20 12:00:00.000001','2026-10-20 12:00:00.000002',null],'2026-10-20 12:00:00.000002'],
    ['TIME',['-100:00:00.000001','-99:59:59.999999',null],'-99:59:59.999999'],
    ['DOUBLE',[1.5,2.5,null],'2.5'],
  ] as [string,CellValue[],string][])('%s成员按原协议类型比较并保持NULL独立',(type,values,input)=>{
    const f=fixture(type,values),inside=f.apply([members([input,input])]);expect(inside.sourceIndices).toEqual([1]);expect(inside.result.rows[0]).toBe(f.source.rows[1]);expect(f.apply([members([input],'notIn')]).sourceIndices).toEqual([0]);
  });
  it('浮点源若错误返回字符串则明确拒绝，不扩大原比较器的数值协议',()=>{
    const f=fixture('DOUBLE',['1.5',2.5]),before=f.filter.view(f.binding);expect(()=>f.apply([members(['2.5'])])).toThrow(text.value);expect(f.filter.view(f.binding)).toBe(before);
  });
  it.each([[undefined],[null],[[]],[['1',2]],[new Array(2)]] as [unknown][])('非法成员%j完整拒绝并保留上次视图',values=>{
    const f=fixture('BIGINT',['1','2']),before=f.apply([rule('eq','1')]);expect(()=>f.apply([{...members([]),values} as QueryResultFilterRule])).toThrow(text.invalid);expect(f.filter.view(f.binding)).toBe(before);
  });
  it('没有行或OR已满足也验证每个成员，不提前采用成功项',()=>{
    const f=fixture('BIGINT',['1']),before=f.filter.view(f.binding)!;expect(()=>f.apply([rule('notNull'),members(['1','坏值'])],'OR')).toThrow(text.value);expect(f.filter.view(f.binding)).toBe(before);
    const g=fixture('DECIMAL',[]);expect(()=>g.apply([members(['NaN'])])).toThrow(text.value);
  });
  it('成员访问器不执行，超128项先拒绝且不读取成员，单值不接受隐藏成员或上限',()=>{
    const f=fixture(),getter=vi.fn(()=> 'a'),values=['a'];Object.defineProperty(values,0,{get:getter});expect(()=>f.apply([members(values)])).toThrow(text.invalid);expect(getter).not.toHaveBeenCalled();
    const huge=new Array(129);Object.defineProperty(huge,0,{get:getter});expect(()=>f.apply([members(huge)])).toThrow(text.budget);expect(getter).not.toHaveBeenCalled();
    expect(()=>f.apply([{...rule('eq','a'),values:['a']}])).toThrow(text.invalid);expect(()=>f.apply([{...members(['a']),value:'隐藏单值'}])).toThrow(text.invalid);expect(()=>f.apply([{...members(['a']),upper:'隐藏上限'}])).toThrow(text.invalid);
    const raw=['a'],iterator=vi.fn(()=>{throw Error('不能读取调用方迭代器');});Object.defineProperty(raw,Symbol.iterator,{value:iterator});expect(f.apply([members(raw)]).sourceIndices).toEqual([0]);expect(iterator).not.toHaveBeenCalled();
    const before=f.filter.view(f.binding),changing=new Proxy(['a'],{getOwnPropertyDescriptor(target,key){if(key==='0')target.push('b');return Reflect.getOwnPropertyDescriptor(target,key);}});expect(()=>f.apply([members(changing)])).toThrow(text.invalid);expect(f.filter.view(f.binding)).toBe(before);
  });
  it('每成员计入原行比较及共同字符工作预算，重复和早命中不绕过上限',()=>{
    const f=fixture('BIGINT',Array.from({length:100000},()=>null)),boundary=f.apply([members(Array(20).fill('1'))]);expect(boundary.result.rows).toEqual([]);expect(()=>f.apply([members(Array(21).fill('1'))])).toThrow(text.budget);expect(f.filter.view(f.binding)).toBe(boundary);
    const value='x'.repeat(4096),g=fixture('TEXT',Array(1000).fill(value)),before=g.filter.view(g.binding)!;expect(()=>g.apply([members(Array(5).fill(value))])).toThrow(text.budget);expect(g.filter.view(g.binding)).toBe(before);
    expect(()=>g.apply([members(['x'.repeat(4097)])])).toThrow(text.budget);
  });
  it('所有成员共享输入预算，源只计一次而重复成员仍计比较工作',()=>{
    const f=fixture('TEXT',[]),values=Array(128).fill('x'.repeat(4096));expect(()=>f.apply(Array.from({length:17},()=>members(values)))).toThrow(text.budget);
  });
  it.each(['未知','GEOMETRY'])('%s只保留NULL判断，不提供列表',type=>{
    const f=fixture(type,[null]);expect(queryResultFilterOperators(f.source.columns[0])).not.toContain('in');expect(()=>f.apply([members(['x'])])).toThrow(text.invalid);
  });
  it('二进制包装不解码为文本列表；冻结独立成员副本，排除行漂移仍永久撤销',()=>{
    const bytes=fixture('BLOB',[{type:'binary',base64:'AA=='}]);expect(()=>bytes.apply([members(['AA=='])])).toThrow(text.value);
    const f=fixture('TEXT',['a','b']),values=['a'],view=f.apply([members(values)]);values[0]='b';expect(view.rules[0].values).toEqual(['a']);expect(Object.isFrozen(view.rules[0].values)).toBe(true);
    f.source.rows[1].k='a';expect(f.filter.view(f.binding)).toBeUndefined();f.source.rows[1].k='b';expect(()=>f.filter.apply(f.binding,view,[],'AND')).toThrow(text.stale);
  });
});

describe('筛选工作预算与单向租约',()=>{
  it('总条件/总单元格工作预算先拒绝，不扩大既有行列范围',()=>{
    const f=fixture();expect(()=>f.apply(Array.from({length:33},()=>rule('null')))).toThrow(text.budget);const g=fixture('TEXT',Array.from({length:100000},()=>null));expect(()=>g.apply(Array.from({length:21},()=>rule('null')))).toThrow(text.budget);g.source.rows.push({k:null,group:'A'});expect(g.filter.bind(g.source,[])).toBeUndefined();
  });
  it('所有条件共用文本/最坏包含工作预算，超限不改变原视图',()=>{
    const f=fixture('TEXT',['x'.repeat(4096)]),before=f.filter.view(f.binding)!;expect(()=>f.apply([rule('contains','x'.repeat(4097))])).toThrow(text.budget);expect(f.filter.view(f.binding)).toBe(before);const g=fixture('TEXT',Array.from({length:2500},()=> 'x'.repeat(4096)));expect(()=>g.apply([rule('eq','x')])).toThrow(text.budget);const h=fixture('TEXT',Array.from({length:4},()=> 'x'.repeat(3000)));expect(()=>h.apply([rule('contains','x'.repeat(3000))])).toThrow(text.budget);expect(queryResultFilterLimits.textWork).toBe(32*1024*1024);
  });
  it('不包含仍计入最坏包含预算，不能借否定或OR绕过上限',()=>{
    const f=fixture('TEXT',Array.from({length:4},()=> 'x'.repeat(3000))),before=f.filter.view(f.binding)!;
    expect(()=>f.apply([rule('notContains','y'.repeat(3000))])).toThrow(text.budget);expect(f.filter.view(f.binding)).toBe(before);
    expect(()=>f.apply([rule('eq','A','group'),rule('notContains','y'.repeat(3000))],'OR')).toThrow(text.budget);expect(f.filter.view(f.binding)).toBe(before);
  });
  it.each(['startsWith','notStartsWith','endsWith','notEndsWith'] as const)('%s按线性工作计费，多个条件仍共用总预算',operator=>{
    const value='x'.repeat(4096),f=fixture('TEXT',Array.from({length:2000},()=>value)),view=f.apply([rule(operator,value)]);
    expect(view.sourceIndices).toHaveLength(operator.startsWith('not')?0:2000);
    expect(()=>f.apply(Array.from({length:3},()=>rule(operator,value)))).toThrow(text.budget);expect(f.filter.view(f.binding)).toBe(view);
  });
  it('否定条件排除行的原值漂移也撤销，恢复原值不复活旧视图',()=>{
    const f=fixture('TEXT',['前缀原文','其他']),view=f.apply([rule('notStartsWith','前缀')]);expect(view.sourceIndices).toEqual([1]);
    f.source.rows[0].k='其他';expect(f.filter.view(f.binding)).toBeUndefined();f.source.rows[0].k='前缀原文';expect(()=>f.filter.apply(f.binding,view,[],'AND')).toThrow(text.stale);
  });
  it('NULL判断不扫描或复制巨大的非NULL原文，不读取getter',()=>{
    const f=fixture('未知',['x'.repeat(100000)]);expect(f.apply([rule('notNull')]).sourceIndices).toEqual([0]);const getter=vi.fn(()=>null);Object.defineProperty(f.source.rows[0],'k',{get:getter});const c=new QueryResultFilter(),b=c.bind(f.source,[])!;expect(()=>c.apply(b,c.view(b)!,[rule('null')],'AND')).toThrow(text.value);expect(getter).not.toHaveBeenCalled();
  });
  it.each(['rows','append','column','metadata','visible','value','excluded','truncated'])('%s漂移立即撤销，恢复后旧条件不能复活',mode=>{
    const f=fixture(),view=f.apply([rule('eq','a')]),row=f.source.rows[0],excluded=f.source.rows[1],column=f.source.columns[0];if(mode==='rows')f.source.rows[0]={...row};if(mode==='append')f.source.rows.push({k:'a',group:'A'});if(mode==='column')f.source.columns[0]={...column};if(mode==='metadata')column.type='JSON';if(mode==='visible')f.binding.visible.reverse();if(mode==='value')row.k='b';if(mode==='excluded')excluded.k='a';if(mode==='truncated')f.source.truncated=false;expect(f.filter.view(f.binding)).toBeUndefined();f.source.rows[0]=row;f.source.columns[0]=column;column.type='TEXT';row.k='a';excluded.k='';f.source.truncated=true;expect(()=>f.filter.apply(f.binding,view,[],'AND')).toThrow(text.stale);
  });
  it('取消/新上下文/旧视图不能覆盖新owner；条件输入对象不能串改已提交规则',()=>{
    const f=fixture(),rules=[rule('eq','a')],view=f.apply(rules);rules[0].value='b';expect(view.rules[0].value).toBe('a');f.apply([]);expect(()=>f.filter.apply(f.binding,view,rules,'AND')).toThrow(text.stale);const newer=f.filter.bind(f.source,['new'])!;expect(()=>f.filter.apply(f.binding,view,[],'AND')).toThrow();expect(f.filter.current(newer)).toBe(true);
  });
});

it('NULL条件的二进制包装原属性漂移也撤销，不解码字节或因恢复而复活',()=>{const f=fixture('BIT',[{type:'binary',base64:'AA=='}]),view=f.apply([rule('notNull')]),raw=f.source.rows[0].k as {type:'binary';base64:string};raw.base64='AQ==';expect(f.filter.view(f.binding)).toBeUndefined();raw.base64='AA==';expect(()=>f.filter.apply(f.binding,view,[],'AND')).toThrow(text.stale);});
