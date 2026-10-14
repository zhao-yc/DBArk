import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ColumnInfo,TableInfo} from '../../src/shared/contracts';
import type {DraftRow} from '../../src/renderer/dataChanges';
import {beginRecordDraft,type RecordContext} from '../../src/renderer/recordViews';
import {parseJsonLexicalTree} from '../../src/renderer/jsonLexicalTree';
import type {ProjectionIdentity} from '../../src/renderer/recordProjections';
import {beginRecordJsonStructureInput,changeRecordJsonStructureInput,type RecordStructureKind,type RecordJsonStructureInput} from '../../src/renderer/recordJsonStructureInput';
import {RecordJsonStructureEditor} from '../../src/renderer/components/RecordJsonStructureEditor';

/** 使用真实输入模型准备显示契约；静态组件检查不冒充浏览器布局或生命周期验收。 */
function input(kind:RecordStructureKind,key='doc'){
  const source=' {"n":9007199254740993,"n":-0,"list":[1,2]}\n',data=Object.fromEntries([['id','1'],[key,source]]);
  const row:DraftRow={id:'uuid',data,original:{...data},inserted:false,deleted:false};const columns:ColumnInfo[]=['id',key].map(name=>({name,type:'text',nullable:true,defaultValue:null,extra:'',comment:'',generated:false}));
  const info:TableInfo={database:'库',name:'表',columns,indexes:[],foreignKeys:[],primaryKey:['id'],editableKey:['id'],engine:'InnoDB',objectKind:'table',ddl:''};const context:RecordContext={target:{connectionId:'连接',database:'库',table:'表'},connectionVersion:1,generation:1,loaded:true,stale:false,busy:false,info},draft=beginRecordDraft(row,context);
  const document=parseJsonLexicalTree(source);if(document.status!=='ready')throw Error(document.reason);
  const identity:ProjectionIdentity={target:draft.target,metadata:draft.metadata,rowId:row.id,data,original:row.original,connectionVersion:1,generation:1,inserted:false,deleted:false};
  const segments=kind==='append-member'?[]:kind==='insert-element'||kind==='move-element'?[{kind:'member' as const,memberIndex:2,key:'list'}]:[{kind:'member' as const,memberIndex:1,key:'n'}];
  return beginRecordJsonStructureInput({rows:[row],draft,context,columnName:key,document,selection:{row,identity,columnName:key,document,segments}},kind);
}
/** 组件没有第二套数据真值，按钮回调由实际控制器承接；此处只检查可访问文案与原文属性。 */
function render(value:RecordJsonStructureInput,reason=''){return renderToStaticMarkup(<RecordJsonStructureEditor input={value} reason={reason} onChange={()=>{}} onClose={()=>{}}/>);}

describe('结构编辑组件候选的静态输入契约',()=>{
  it('改名显示原始转义token，路径和原值仍为只读文本',()=>{const html=render(input('rename'));expect(html).toContain('重命名 JSON 成员');expect(html).toContain('成员名称 JSON 字符串');expect(html).toContain('&quot;n&quot;');expect(html).toContain('原始值与结构路径');expect(html).toContain('&quot;memberIndex&quot;:1');expect(html.match(/<textarea\b/g)).toHaveLength(3);});
  it('移除条目没有可编辑值控件，描述仍明确需要本页预览提交',()=>{const html=render(input('remove'));expect(html).toContain('移除 JSON 条目');expect(html).toContain('数据修改预览提交');const tags=html.match(/<textarea\b[^>]*>/g)??[];expect(tags).toHaveLength(2);expect(tags.every(value=>/readonly=""/i.test(value)),tags.join(" ")).toBe(true);expect(html).not.toContain('成员名称 JSON 字符串');});
  it('追加成员分别显示名称和值，精确默认JSON null保持文字',()=>{const html=render(input('append-member'));expect(html).toContain('追加 JSON 成员');expect(html).toContain('成员名称 JSON 字符串');expect(html).toContain('新 JSON 值');expect(html).toContain('>null</textarea>');});
  it('插入和移动下标使用原始文本输入而非浏览器数值归一化',()=>{const insert=changeRecordJsonStructureInput(input('insert-element'),{kind:'insert-element',indexText:'01',valueToken:'9007199254740993'}),html=render(insert);expect(html).toContain('插入下标（从 0 开始）');expect(html).toContain('value="01"');expect(html).toContain('9007199254740993');expect(html).not.toContain('type="number"');const move=render(input('move-element'));expect(move).toContain('原下标（从 0 开始）');expect(move).toContain('目标下标（从 0 开始）');});
  it('未完成JSON名称不在显示时解析或清除',()=>{const changed=changeRecordJsonStructureInput(input('rename'),{kind:'rename',keyToken:'"未结束'});expect(render(changed)).toContain('&quot;未结束</textarea>');expect(changed.action).toEqual({kind:'rename',keyToken:'"未结束'});});
  it.each(['rename','remove','append-member','insert-element','move-element'] as const)('只读原因阻止%s的全部原文输入',kind=>{const html=render(input(kind),'当前结构已失效'),tags=[...(html.match(/<textarea\b[^>]*>/g)??[]),...(html.match(/<input\b[^>]*>/g)??[])];expect(tags.every(value=>/readonly=""/i.test(value)),tags.join(" ")).toBe(true);expect(html).toContain('当前结构已失效');});
  it('真实列名始终以普通文本输出，HTML片段不会成为元素',()=>{const html=render(input('rename','<img src=x onerror=alert(1)>'));expect(html).toContain('&lt;img');expect(html).not.toContain('<img');});
});
