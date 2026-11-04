import { expect, it } from 'vitest';
import { beginSqliteJsonFieldInput, changeSqliteJsonFieldInput, applySqliteJsonFieldInput } from '../../src/renderer/sqliteJsonFieldInput';
import { parseJsonLexicalTree, type LexicalPathSegment } from '../../src/renderer/jsonLexicalTree';
import type { SqliteEditColumn, SqliteOriginalValue } from '../../src/shared/sqliteTableEdit';
import { sqliteRecordTreeZh as text } from '../../src/renderer/locales/sqliteRecordTree.zh-CN';
import type { RecordStructureKind } from '../../src/renderer/recordJsonStructureInput';

/** 同一TEXT保留重复名、超过JS安全整数、负零、指数、转义名称及外部空白。 */
function fixture(source = ' {"n":9007199254740993,"n":-0,"list":[1e999,2],"\\u005f_proto__":{"x":1}}\r\n', generated = false) {
  const value: SqliteOriginalValue = { kind:'text',value:source }, column: SqliteEditColumn = { name:'__proto__',declaredType:'JSON',generated,nullable:true,hasDefault:false }, document=parseJsonLexicalTree(source);
  if(document.status!=='ready')throw Error(document.reason);
  const member=(memberIndex:number,key:string):LexicalPathSegment=>({kind:'member',memberIndex,key});
  return {value,column,document,member,begin:(segments:readonly LexicalPathSegment[]=[],kind?:RecordStructureKind)=>beginSqliteJsonFieldInput(column,value,document,segments,kind)};
}
it('仅替换准确重复成员的词法token，精确数值、外部原文与其他字段保持',()=>{
 const f=fixture(), input=f.begin([f.member(1,'n')]), changed=changeSqliteJsonFieldInput(input,'9223372036854775808'), out=applySqliteJsonFieldInput(changed,f.value);
 expect(out).toEqual({kind:'text',value:f.value.value.replace('"n":-0','"n":9223372036854775808')});expect(f.value.value).toContain('"n":-0');
 expect(applySqliteJsonFieldInput(changeSqliteJsonFieldInput(f.begin(),'null'),f.value)).toEqual({kind:'text',value:' null\r\n'});
});
it.each(['rename','remove','append-member','move-member','insert-element','move-element'] as const)('%s复用原跨度模型并保持TEXT存储',kind=>{
 const f=fixture(), path=kind==='rename'||kind==='remove'?[f.member(1,'n')]:kind==='insert-element'||kind==='move-element'?[f.member(2,'list')]:[];
 const input=f.begin(path,kind), action=kind==='rename'?{kind,keyToken:'"\\u006e"'}:kind==='remove'?{kind}:kind==='append-member'?{kind,keyToken:'"n"',valueToken:'900719925474099312345'}:kind==='move-member'?{kind,fromText:'2',toText:'1'}:kind==='insert-element'?{kind,indexText:'1',valueToken:'-0'}:{kind,fromText:'0',toText:'1'};
 const out=applySqliteJsonFieldInput(changeSqliteJsonFieldInput(input,action),f.value);expect(out.kind).toBe('text');if(out.kind==='null')throw Error('不应转为SQL NULL');expect(out.value.startsWith(' ')).toBe(true);expect(out.value.endsWith('\r\n')).toBe(true);expect(out.value).toContain('9007199254740993');expect(out.value).toContain('1e999');
 if(kind==='rename')expect(out.value).toContain('"\\u006e":-0');if(kind==='append-member')expect(out.value).toContain('"n":900719925474099312345');if(kind==='move-member')expect(out.value.indexOf('"n":-0')).toBeLessThan(out.value.indexOf('"n":9007199254740993'));if(kind==='insert-element')expect(out.value).toContain('[1e999,-0,2]');if(kind==='move-element')expect(out.value).toContain('[2,1e999]');
});
it('同值新字段、错误文档或生成列不能接管旧路径',()=>{
 const f=fixture(),input=f.begin();expect(()=>applySqliteJsonFieldInput(input,{...f.value})).toThrow(text.stale);expect(()=>beginSqliteJsonFieldInput(f.column,f.value,{...f.document,text:'null'},[])).toThrow(text.stale);expect(()=>fixture('null',true).begin()).toThrow(text.readonly);expect(()=>beginSqliteJsonFieldInput(f.column,{kind:'null'},f.document,[])).toThrow(text.stale);
});
it('非法原文保留输入，但不能发布部分字段；字段长度在完整合并后重新核验',()=>{
 const f=fixture(),input=f.begin([f.member(1,'n')]);const bad=changeSqliteJsonFieldInput(input,'{');expect(bad.base.value.text).toBe('{');expect(()=>applySqliteJsonFieldInput(bad,f.value)).toThrow();expect(f.value.value).toContain('"n":-0');
 const large=fixture('{"x":"'+'a'.repeat(65510)+'","n":1}'), growth=changeSqliteJsonFieldInput(large.begin([large.member(1,'n')]),'"'+'b'.repeat(40)+'"');expect(()=>applySqliteJsonFieldInput(growth,large.value)).toThrow(text.limited);
 expect(()=>fixture('"'+'a'.repeat(65535)+'"').begin()).toThrow(text.readonly);
});
it.each(['01','1e1','-1',' 1','1.0','9007199254740993'])('结构下标%s不被归一化，原输入仍保留',position=>{
 const f=fixture(),input=f.begin([f.member(2,'list')],'insert-element'),next=changeSqliteJsonFieldInput(input,{kind:'insert-element',indexText:position,valueToken:'null'});expect(()=>applySqliteJsonFieldInput(next,f.value)).toThrow();expect(next.action).toMatchObject({indexText:position});
});
it('根移除／错误操作种类及超UTF8原文均拒绝，空对象和数组入口分别限定',()=>{
 const f=fixture();expect(()=>f.begin([],'remove')).toThrow();expect(()=>fixture('{}').begin([],'move-member')).toThrow();expect(()=>fixture('[]').begin([],'move-element')).toThrow();expect(()=>f.begin([f.member(1,'n')],'append-member')).toThrow();
 expect(()=>changeSqliteJsonFieldInput(f.begin([],'append-member'),{kind:'remove'})).toThrow();expect(()=>changeSqliteJsonFieldInput(f.begin(), '中'.repeat(90000))).toThrow();expect(()=>changeSqliteJsonFieldInput(f.begin([],'append-member'),{kind:'append-member',keyToken:'"x"',valueToken:'中'.repeat(90000)})).toThrow();
});
