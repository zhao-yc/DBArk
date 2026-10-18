import { describe, expect, it } from 'vitest';
import { QueryInsertFile } from '../../src/engine/queryInsertFile';
import type { QueryExportFrame } from '../../src/shared/queryStreamExport';
import { queryInsertTargetSchema } from '../../src/shared/queryInsertExport';

/** RAM协议帧使用有区别的真实类型，不能用全字符串元数据掩盖精度错误。 */
function start(types: string[]): Extract<QueryExportFrame,{kind:'rows-start'}> {
  return {kind:'rows-start',resultOrdinal:1,statementOrdinal:1,rowResultOrdinal:1,columns:types.map((type,index)=>({position:index+1,key:`c${index}`,name:'同名',exportName:`列${index}`,type}))};
}
const row = (values: unknown[]) => ({kind:'row',resultOrdinal:1,values} as QueryExportFrame);
const end = {kind:'rows-end',resultOrdinal:1} as const;
function consumer(types: string[]) {
  const chunks:string[]=[];
  const writer=new QueryInsertFile({database:'库`名',table:'表.名',columns:types.map((_,index)=>`字段${index}`)},async sql=>{chunks.push(sql);});
  return {writer,chunks,begin:()=>writer.consume(start(types))};
}

describe('完整INSERT严格逐帧消费者',()=>{
  it('NULL、空串、NUL、补充平面Unicode、反斜线和BLOB逐字节保持，目标只来自显式映射',async()=>{
    const h=consumer(['NULL','VAR_STRING','VAR_STRING','BLOB']);await h.begin();
    const source="引号'\\\0😊";
    await h.writer.consume(row([null,'',source,{type:'binary',base64:'AAH/'}]));await h.writer.consume(end);
    expect(h.chunks).toEqual([`INSERT INTO \`库\`\`名\`.\`表.名\` (\`字段0\`, \`字段1\`, \`字段2\`, \`字段3\`) VALUES (NULL, _utf8mb4 X'', _utf8mb4 X'${Buffer.from(source).toString('hex')}', X'0001ff');\n`]);
    expect(h.writer.complete()).toMatchObject({shownRows:1,totalRows:1});expect(h.writer.complete().sql).toContain(h.chunks[0]);
  });
  it('BIGINT、DECIMAL与微秒时间保留原字符串；IEEE浮点不误用安全整数限制',async()=>{
    const h=consumer(['LONGLONG','NEWDECIMAL','DATETIME','TIME','DOUBLE','LONG']);await h.begin();
    const values=['18446744073709551615','-000.12345678901234567890','0000-00-00 00:00:00.000001','-838:59:59.000001',1e30,2147483647];
    await h.writer.consume(row(values));await h.writer.consume(end);
    for(const value of values.slice(0,4))expect(h.chunks[0]).toContain(`_utf8mb4 X'${Buffer.from(value as string).toString('hex')}'`);
    expect(h.chunks[0]).toContain(', 1e+30, 2147483647);');
  });
  it.each([
    ['LONGLONG',9007199254740992],['NEWDECIMAL',0.1],['LONG',9007199254740992],['DOUBLE',-0],['DOUBLE',Infinity],
    ['VAR_STRING','\uD800'],['VAR_STRING',true],['DATETIME','2026-01-02T03:04:05Z'],['NEWDECIMAL','1e3'],
    ['BIT',{type:'binary',base64:'YR=='}],['VAR_STRING',undefined],
  ])('拒绝不可恢复的%s值，不调用文件写入',async(type,value)=>{
    const h=consumer([type as string]);await h.begin();await expect(h.writer.consume(row([value]))).rejects.toThrow('不能可靠表示');expect(h.chunks).toEqual([]);
  });
  it('未知或几何协议列即使空集也失败；列数和后续结果不符不能发布部分文件',async()=>{
    for(const type of ['GEOMETRY','VECTOR','未知']){const h=consumer([type]);await expect(h.begin()).rejects.toThrow('不能可靠表示');expect(h.chunks).toEqual([]);}
    const h=consumer(['LONG']);await expect(h.writer.consume(start(['LONG','LONG']))).rejects.toThrow('不匹配');await h.begin();await h.writer.consume(row([1]));await h.writer.consume(end);
    await expect(h.writer.consume({...start(['LONG']),resultOrdinal:2,rowResultOrdinal:2})).rejects.toThrow('不匹配');
    await expect(h.writer.consume({kind:'status',resultOrdinal:2,statementOrdinal:2,affectedRows:1,insertId:'0',warningCount:0})).rejects.toThrow('不匹配');
  });
  it('零行仍要求唯一列头与结束；没有行集不能伪称完整成功',async()=>{
    const h=consumer(['LONG']);expect(()=>h.writer.complete()).toThrow('完整结束');await h.begin();expect(()=>h.writer.complete()).toThrow('完整结束');await h.writer.consume(end);expect(h.writer.complete()).toMatchObject({shownRows:0,totalRows:0});
  });
  it('文件写入未返回前消费不完成，失败保持同一错误且不续写或自行重试',async()=>{
    let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});let writes=0,returned=false;
    const writer=new QueryInsertFile({database:'d',table:'t',columns:['x']},async()=>{writes++;await pending;});await writer.consume(start(['LONG']));
    const consuming=writer.consume(row([1])).then(()=>{returned=true;});await Promise.resolve();expect(returned).toBe(false);expect(writes).toBe(1);release();await consuming;
    const failure=Error('磁盘写入失败'),broken=new QueryInsertFile({database:'d',table:'t',columns:['x']},async()=>{throw failure;});await broken.consume(start(['LONG']));await expect(broken.consume(row([1]))).rejects.toBe(failure);
  });
  it('样例最多20行，完整文件消费者仍逐行收到全部1001行',async()=>{
    let rows=0;const writer=new QueryInsertFile({database:'d',table:'t',columns:['x']},async()=>{rows++;});await writer.consume(start(['LONG']));
    for(let i=0;i<1001;i++)await writer.consume(row([i]));await writer.consume(end);expect(rows).toBe(1001);const sample=writer.complete();expect(sample.shownRows).toBe(20);expect(sample.totalRows).toBe(1001);expect((sample.sql.match(/INSERT INTO/g)||[]).length).toBe(20);
  });
  it('在构造十六进制正文前拒绝超限字段和输出行',async()=>{
    const h=consumer(['VAR_STRING']);await h.begin();await expect(h.writer.consume(row(['x'.repeat(8*1024*1024+1)]))).rejects.toThrow();
    await expect(h.writer.consume(row(['x'.repeat(8*1024*1024)]))).rejects.toThrow('16MiB');expect(h.chunks).toEqual([]);
  });
  it('目标映射保守验证重复、名称及完整显式字段，不接收来源SQL或额外属性',()=>{
    const target={database:'d',table:'t',columns:['a']};expect(queryInsertTargetSchema.safeParse(target).success).toBe(true);
    for(const value of [{...target,columns:['A','a']},{...target,columns:[]},{...target,database:'d\\x'},{...target,columns:['x ']},{...target,sql:'SELECT 1'}])expect(queryInsertTargetSchema.safeParse(value).success).toBe(false);
  });
});
