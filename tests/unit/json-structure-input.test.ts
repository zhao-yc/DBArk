import {describe,expect,it} from 'vitest';
import {parseJsonLexicalTree,type LexicalPathSegment,type ReadyLexicalDocument} from '../../src/renderer/jsonLexicalTree';
import {applyJsonStructureAction,beginJsonStructureSelection,type JsonStructureAction} from '../../src/renderer/jsonStructureInput';

/** 只接受真实词法解析器生成的冻结树，不伪造跨度或预算。 */
function ready(source:string):ReadyLexicalDocument{const parsed=parseJsonLexicalTree(source);if(parsed.status!=='ready')throw Error(parsed.reason);return parsed;}
const member=(memberIndex:number,key:string):LexicalPathSegment=>({kind:'member',memberIndex,key});
const element=(index:number):LexicalPathSegment=>({kind:'element',index});
/** 结构候选仅返回新文档，原文、路径及节点均须保持原对象不变。 */
function apply(source:string,path:readonly LexicalPathSegment[],action:JsonStructureAction){const document=ready(source),selection=beginJsonStructureSelection(document,path),next=applyJsonStructureAction(selection,document,action);expect(document.text).toBe(source);expect(Object.isFrozen(document)).toBe(true);return next.text;}

describe('JSON结构候选：精确成员与元素操作',()=>{
  const object='{ "a":1,  "b":2,\n "c":3 }';
  it.each([[0,'a','{ "b":2,\n "c":3 }'],[1,'b','{ "a":1,  "c":3 }'],[2,'c','{ "a":1,  "b":2 }']] as const)('删除对象第%s项精确处理分隔符', (index,key,expected)=>{expect(apply(object,[member(index,key)],{kind:'remove'})).toBe(expected);});
  it('唯一成员删除仍保留容器内前后空白',()=>{expect(apply(' { "a":1 }\n',[member(0,'a')],{kind:'remove'})).toBe(' {  }\n');});
  it.each([[0,'[ 2 , 3 ]'],[1,'[ 1 , 3 ]'],[2,'[ 1 , 2 ]']] as const)('删除数组第%s项不重写其它token',(index,expected)=>{expect(apply('[ 1 , 2 , 3 ]',[element(index)],{kind:'remove'})).toBe(expected);});
  it('唯一数组项与嵌套字符串的逗号不混淆',()=>{expect(apply('[ "a,b:c\\\"" ]',[element(0)],{kind:'remove'})).toBe('[  ]');expect(apply('{"list":[{"x":1,"x":2},"a,b"]}',[member(0,'list'),element(0),member(1,'x')],{kind:'remove'})).toBe('{"list":[{"x":1},"a,b"]}');});
  it('同名成员删除只作用于指定序号',()=>{expect(apply('{"n":9007199254740993,"n":-0,"n":1e999}',[member(1,'n')],{kind:'remove'})).toBe('{"n":9007199254740993,"n":1e999}');});
  it.each(['"__proto__"','"constructor"','"名 字"','"a\\u002eb"','"a/b~"'])('改名使用原始字符串token %s',keyToken=>{expect(apply(' {"old" : 9007199254740993,"old":-0}\n',[member(0,'old')],{kind:'rename',keyToken})).toBe(' {'+keyToken+' : 9007199254740993,"old":-0}\n');});
  it('改名成重复名称仍保留成员序号和两个独立值',()=>{expect(apply('{"a":1,"b":2}',[member(1,'b')],{kind:'rename',keyToken:'"a"'})).toBe('{"a":1,"a":2}');});
  it.each(['1','null','{}','["x"]','"未结束'])('非法key %s整体拒绝',keyToken=>{const document=ready('{"a":1}');expect(()=>applyJsonStructureAction(beginJsonStructureSelection(document,[member(0,'a')]),document,{kind:'rename',keyToken})).toThrow('成员名称');expect(document.text).toBe('{"a":1}');});
  it.each([['{   }','{"x":1   }'],[' { "a":1 \n} ',' { "a":1,"x":1 \n} ']] as const)('对象追加保留原闭括号前空白 %s',(source,expected)=>{expect(apply(source,[],{kind:'append-member',keyToken:'"x"',valueToken:'1'})).toBe(expected);});
  it('追加重复成员、对象和精确大数均不经过对象枚举或Number转换',()=>{expect(apply('{"n":-0}',[],{kind:'append-member',keyToken:'"n"',valueToken:'{"x":9007199254740993,"x":1e999}'})).toBe('{"n":-0,"n":{"x":9007199254740993,"x":1e999}}');});
  it.each([[0,'[ 9,1 , 2 , 3 ]'],[1,'[ 1 , 9,2 , 3 ]'],[3,'[ 1 , 2 , 3,9 ]']] as const)('数组指定下标%s插入只加必要逗号',(index,expected)=>{expect(apply('[ 1 , 2 , 3 ]',[],{kind:'insert-element',index,valueToken:'9'})).toBe(expected);});
  it('空数组保留原空白，嵌套数组只修改所选容器',()=>{expect(apply('[ \n]',[],{kind:'insert-element',index:0,valueToken:'null'})).toBe('[null \n]');expect(apply('{"a":[1],"b":[2]}',[member(0,'a')],{kind:'insert-element',index:1,valueToken:'"中文"'})).toBe('{"a":[1,"中文"],"b":[2]}');});
  it.each([[2,0,'[ 3 , 1 , 2 ]'],[0,2,'[ 2 , 3 , 1 ]'],[1,0,'[ 2 , 1 , 3 ]'],[1,2,'[ 1 , 3 , 2 ]']] as const)('数组从%s移动至%s保持空白槽位',(from,to,expected)=>{expect(apply('[ 1 , 2 , 3 ]',[],{kind:'move-element',from,to})).toBe(expected);});
  it('移动完整嵌套值仍保留数字原文和重复键',()=>{expect(apply('[9007199254740993, {"n":-0,"n":1e999}, "a,b"]',[],{kind:'move-element',from:1,to:0})).toBe('[{"n":-0,"n":1e999}, 9007199254740993, "a,b"]');});
  it.each([-1,1.5,NaN,Infinity,9007199254740992])('非法数组下标%s不能插入或移动',index=>{const document=ready('[1,2]'),selection=beginJsonStructureSelection(document,[]);expect(()=>applyJsonStructureAction(selection,document,{kind:'insert-element',index,valueToken:'0'})).toThrow('下标');expect(()=>applyJsonStructureAction(selection,document,{kind:'move-element',from:index,to:0})).toThrow('下标');expect(()=>applyJsonStructureAction(selection,document,{kind:'move-element',from:0,to:index})).toThrow('下标');});
  it('超出尾部及空数组移动均拒绝',()=>{expect(()=>apply('[1]',[],{kind:'insert-element',index:2,valueToken:'2'})).toThrow('下标');expect(()=>apply('[1]',[],{kind:'move-element',from:0,to:1})).toThrow('下标');expect(()=>apply('[]',[],{kind:'move-element',from:0,to:0})).toThrow('下标');});
  it.each(['{','1,2','undefined','"未结束'])('非法新增value %s不部分合并',valueToken=>{expect(()=>apply('{"a":1}',[],{kind:'append-member',keyToken:'"b"',valueToken})).toThrow('新值');expect(()=>apply('[1]',[],{kind:'insert-element',index:1,valueToken})).toThrow('新值');});
  it('根不能删除改名，容器种类和元素改名均严格校验',()=>{expect(()=>apply('1',[],{kind:'remove'})).toThrow('根值');expect(()=>apply('{}',[],{kind:'rename',keyToken:'"x"'})).toThrow('根值');expect(()=>apply('[]',[],{kind:'append-member',keyToken:'"x"',valueToken:'1'})).toThrow('不是对象');expect(()=>apply('{}',[],{kind:'insert-element',index:0,valueToken:'1'})).toThrow('不是数组');expect(()=>apply('[1]',[element(0)],{kind:'rename',keyToken:'"x"'})).toThrow('父容器');});
  it('同位置移动及完全相同key token不制造新文档',()=>{const document=ready('{"a":[1]}'),array=beginJsonStructureSelection(document,[member(0,'a')]);expect(applyJsonStructureAction(array,document,{kind:'move-element',from:0,to:0})).toBe(document);const key=beginJsonStructureSelection(document,[member(0,'a')]);expect(applyJsonStructureAction(key,document,{kind:'rename',keyToken:'"a"'})).toBe(document);});
  it('相同内容的新文档不能冒充当前冻结快照',()=>{const document=ready('{"a":1}'),selection=beginJsonStructureSelection(document,[member(0,'a')]);expect(()=>applyJsonStructureAction(selection,ready(document.text),{kind:'remove'})).toThrow('身份');});
});

describe('JSON结构候选：完整合并预算',()=>{
  it('数组和对象追加均不放宽2048条目限制',()=>{expect(()=>apply(JSON.stringify(Array(2048).fill(0)),[],{kind:'insert-element',index:2048,valueToken:'0'})).toThrow('完整JSON');const object='{'+Array.from({length:2048},(_,index)=>JSON.stringify(String(index))+':0').join(',')+'}';expect(()=>apply(object,[],{kind:'append-member',keyToken:'"x"',valueToken:'0'})).toThrow('完整JSON');});
  it('局部合法的新容器不能绕过合并后64层深度',()=>{const source='['.repeat(63)+'0'+']'.repeat(63),path=Array.from({length:62},()=>element(0));expect(()=>apply(source,path,{kind:'insert-element',index:1,valueToken:'[0]'})).toThrow('完整JSON');});
  it('组合总节点超过8192时不返回部分文档',()=>{const source='['+Array(4).fill('['+Array(2046).fill('0').join(',')+']').join(',')+']';expect(ready(source).nodes).toHaveLength(8189);expect(()=>apply(source,[],{kind:'insert-element',index:4,valueToken:'[0,0,0]'})).toThrow('完整JSON');});
  it('ASCII文本预算在拼接前拒绝，原大文档仍保持',()=>{const source='['+Array(4).fill('"'+'x'.repeat(65530)+'"').join(',')+']';expect(()=>apply(source,[],{kind:'insert-element',index:4,valueToken:'"'+'y'.repeat(20)+'"'})).toThrow('文本预算');});
  it('UTF8超过预算时即使UTF16未满仍拒绝',()=>{const source='['+Array(4).fill('"'+'中'.repeat(20000)+'"').join(',')+']';expect(()=>apply(source,[],{kind:'insert-element',index:4,valueToken:'"'+'文'.repeat(8000)+'"'})).toThrow('文本预算');});
});
