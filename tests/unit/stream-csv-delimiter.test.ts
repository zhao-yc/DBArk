import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';
import { afterEach, describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { createQueryStreamFile, type QueryStreamFileOptions } from '../../src/engine/queryStreamFile';
import type { QueryExportFrame } from '../../src/shared/queryStreamExport';
import type { CsvExportDelimiter } from '../../src/shared/csvExport';
import type { AtomicFileIO } from '../../src/engine/atomicFile';
import { decodeQueryCsvZip } from '../helpers/queryCsvZip';
import original from '../fixtures/stream-csv-delimiter-default-bytes.json';

type Format = 'csv' | 'csv-zip';
const encodings = ['utf8','utf16le','gb18030'] as const, formats = ['csv','csv-zip'] as const;
const directories: string[] = [];
/** 所有真实文件只位于本普通克隆的缓存；不读取应用、数据库或系统用户目录。 */
async function options(format: Format, encoding: QueryStreamFileOptions['encoding'] = 'utf8', csvDelimiter?: CsvExportDelimiter): Promise<QueryStreamFileOptions> {
  const base = join(process.cwd(), '.cache/stream-csv-delimiter/tmp'); await mkdir(base, { recursive: true }); const directory = await mkdtemp(join(base, 'case-')); directories.push(directory);
  const filePath = join(directory, 'all.' + (format === 'csv' ? 'csv' : 'zip')); await writeFile(filePath, '原文件');
  return { filePath, format, encoding, ...(csvDelimiter === undefined ? {} : { csvDelimiter }), resultSelection: format === 'csv' ? { kind: 'row-result', ordinal: 2 } : { kind: 'all' }, checkCancelled() {}, onCommitStart() {} };
}
afterEach(async () => { for (const directory of directories.splice(0)) { for (const name of await readdir(directory)) await rm(join(directory, name)); await rmdir(directory); } });
function start(resultOrdinal: number, rowResultOrdinal: number, names: string[]): Extract<QueryExportFrame, { kind: 'rows-start' }> { return { kind: 'rows-start', resultOrdinal, rowResultOrdinal, statementOrdinal: resultOrdinal, columns: names.map((name,index) => ({ position:index+1,key:'c'+index,name,exportName:name,type:'VAR_STRING' })) }; }
/** 手工固定位置帧含空行集、状态、多种类型和末尾行集，不能因单CSV选择而漏消费其它帧。 */
function frames(): QueryExportFrame[] { return [start(1,1,['空;,\t']), {kind:'rows-end',resultOrdinal:1}, {kind:'status',resultOrdinal:2,statementOrdinal:2,affectedRows:2,insertId:'18446744073709551615',warningCount:3}, start(3,2,['值,分号;制表\t','NULL','空串','斜线','字节','大数','小数','尾空']), {kind:'row',resultOrdinal:3,values:['中文;,\t"引号"\r\n次行',null,'','\\N',{type:'binary',base64:'AAH/'},'9007199254740993','0.12345678901234567890','']}, {kind:'rows-end',resultOrdinal:3,warningCount:4}, start(4,3,['尾;,\t']), {kind:'row',resultOrdinal:4,values:['末;,\t"引号"']}, {kind:'rows-end',resultOrdinal:4}]; }
// 完整手写各分隔符的标题及行预期，不用被测csvCell、join或导入器生成答案。
const expected = {
  ',': '"值,分号;制表\t",NULL,空串,斜线,字节,大数,小数,尾空\r\n"中文;,\t""引号""\r\n次行",\\N,"",\\\\N,base64:AAH/,9007199254740993,0.12345678901234567890,""\r\n',
  ';': '"值,分号;制表\t";NULL;空串;斜线;字节;大数;小数;尾空\r\n"中文;,\t""引号""\r\n次行";\\N;"";\\\\N;base64:AAH/;9007199254740993;0.12345678901234567890;""\r\n',
  '\t': '"值,分号;制表\t"\tNULL\t空串\t斜线\t字节\t大数\t小数\t尾空\r\n"中文;,\t""引号""\r\n次行"\t\\N\t""\t\\\\N\tbase64:AAH/\t9007199254740993\t0.12345678901234567890\t""\r\n',
};
const encoded = (text: string, encoding: QueryStreamFileOptions['encoding']) => iconv.encode((encoding === 'utf16le' ? '\uFEFF' : '') + text, encoding);
/** 驱动与SQL完全不参与；每帧只写一次，直接检查真实原子文件与独立ZIP目录/CRC解码。 */
async function save(input: QueryStreamFileOptions, io?: AtomicFileIO, source = frames()) { const writer = await createQueryStreamFile(input, io); try { for (const frame of source) await writer.write(frame); await writer.complete(); expect(writer.fileCommitted).toBe(true); return await readFile(input.filePath); } finally { await writer.abort(); } }
const combinations = formats.flatMap(format => encodings.flatMap(encoding => [',',';','\t'].map(delimiter => ({format,encoding,delimiter:delimiter as CsvExportDelimiter}))));

describe('完整流式CSV与CSV ZIP分隔符', () => {
  it('严格IPC只CSV/ZIP接纳三枚举和旧缺项；有效JSON/SQL先通过，再拒绝夹带及显式undefined', () => {
    const base = {sessionId:'s',taskId:'task',fileToken:'f',sql:'SELECT 1',encoding:'utf8',protocol:'text-strict'};
    for (const format of ['csv','csv-zip','json','sql']) {
      const value = {...base,format,resultSelection:format==='csv'?{kind:'row-result',ordinal:2}:{kind:'all'},...(format==='sql'?{insertTarget:{database:'db',table:'t',columns:['v']}}:{})};
      expect(validateCommand('query.exportStream',value)).toEqual(value);
      for (const csvDelimiter of [',',';','\t']) if (format==='csv'||format==='csv-zip') expect(validateCommand('query.exportStream',{...value,csvDelimiter})).toMatchObject({csvDelimiter}); else expect(()=>validateCommand('query.exportStream',{...value,csvDelimiter})).toThrow();
      for (const csvDelimiter of [undefined,null,'','|',';;','tab',1,[';']]) expect(()=>validateCommand('query.exportStream',{...value,csvDelimiter})).toThrow();
      expect(()=>validateCommand('query.exportStream',{...value,filePath:'未经授权'})).toThrow();
    }
  });

  it.each(combinations)('$format/$encoding/$delimiter 保留全部标题/字段协议和位置，ZIP清单准确记录实际delimiter', async ({format,encoding,delimiter}) => {
    const input=await options(format,encoding,delimiter), source=frames(), before=structuredClone(source), bytes=await save(input,undefined,source);
    if(format==='csv') expect(bytes).toEqual(encoded(expected[delimiter],encoding));
    else {
      const entries=decodeQueryCsvZip(bytes); expect([...entries.keys()]).toEqual(['results/rows-001.csv','results/rows-002.csv','results/rows-003.csv','manifest.json']);
      expect(entries.get('results/rows-001.csv')).toEqual(encoded('"空;,\t"\r\n',encoding)); expect(entries.get('results/rows-002.csv')).toEqual(encoded(expected[delimiter],encoding)); expect(entries.get('results/rows-003.csv')).toEqual(encoded('"尾;,\t"\r\n"末;,\t""引号"""\r\n',encoding));
      const manifest=JSON.parse(entries.get('manifest.json')!.toString('utf8')); expect(manifest).toMatchObject({format:'DBArk-query-csv-archive',version:1,encoding,csv:{delimiter,recordDelimiter:'\r\n',null:'\\N',leadingBackslash:'double',binary:'base64:',columnOrder:'position'}});
      expect(manifest.results.map((result:any)=>[result.resultOrdinal,result.kind,result.rowsWritten??null])).toEqual([[1,'rows',0],[2,'status',null],[3,'rows',1],[4,'rows',1]]); expect(manifest.results[1]).toMatchObject({affectedRows:2,insertId:'18446744073709551615',warningCount:3}); expect(manifest.results[2].warningCount).toBe(4);
      for(const result of manifest.results.filter((result:any)=>result.kind==='rows')) expect(result.bytes).toBe(entries.get(result.file)!.length);
    }
    expect(source).toEqual(before); expect(await readdir(directories.at(-1)!)).toEqual([format==='csv'?'all.csv':'all.zip']);
  });

  it.each(combinations)('$format/$encoding/$delimiter 只引用当前分隔符，其他分隔符在标题和数据中保持原文', async ({format,encoding,delimiter}) => {
    // 分开三个候选字符，防止所有样例都同时含逗号而掩盖调用链漏传参数。
    const exact = {
      ',': '"逗,号",分;号,制\t表\r\n"值,逗",值;分,值\t制\r\n',
      ';': '逗,号;"分;号";制\t表\r\n值,逗;"值;分";值\t制\r\n',
      '\t': '逗,号\t分;号\t"制\t表"\r\n值,逗\t值;分\t"值\t制"\r\n',
    };
    const input = {...await options(format,encoding,delimiter),resultSelection:format==='csv'?{kind:'row-result' as const,ordinal:1}:{kind:'all' as const}};
    const bytes = await save(input,undefined,[start(1,1,['逗,号','分;号','制\t表']),{kind:'row',resultOrdinal:1,values:['值,逗','值;分','值\t制']},{kind:'rows-end',resultOrdinal:1}]);
    expect(format==='csv'?bytes:decodeQueryCsvZip(bytes).get('results/rows-001.csv')).toEqual(encoded(exact[delimiter],encoding));
  });

  it('缺项与显式逗号均逐字匹配493dc2f修改前冻结的六个默认文件摘要', async () => {
    expect(original.baseline).toBe('493dc2f94fb3d64f4f08ae516aa9aadbf4184801');
    for(const format of formats)for(const encoding of encodings)for(const delimiter of [undefined,','] as const){const bytes=await save(await options(format,encoding,delimiter));expect(createHash('sha256').update(bytes).digest('hex')).toBe(original.hashes[`${format}/${encoding}`]);}
  });

  it.each(formats.flatMap(format=>encodings.map(encoding=>({format,encoding}))))('$format/$encoding跨64KiB缓冲及113字节短写不丢引号、换行或尾空列',async({format,encoding})=>{
    const input={...await options(format,encoding,';'),resultSelection:format==='csv'?{kind:'row-result' as const,ordinal:1}:{kind:'all' as const}}, value='中'.repeat(40000)+';"\r\n末'; let writes=0;
    const io:AtomicFileIO={open:async path=>{const file=await open(path,'wx');return{write:(bytes,at,length)=>{writes++;return file.write(bytes,at,Math.min(length,113));},sync:()=>file.sync(),close:()=>file.close()};},rename,remove:path=>rm(path,{force:true})};
    const writer=await createQueryStreamFile(input,io);try{await writer.write(start(1,1,['大;值','尾']));await writer.write({kind:'row',resultOrdinal:1,values:[value,'']});await writer.write({kind:'rows-end',resultOrdinal:1});await writer.complete();}finally{await writer.abort();}
    const bytes=await readFile(input.filePath), actual=format==='csv'?bytes:decodeQueryCsvZip(bytes).get('results/rows-001.csv'); expect(actual).toEqual(encoded('"大;值";尾\r\n"'+'中'.repeat(40000)+';""\r\n末";""\r\n',encoding));expect(writes).toBeGreaterThan(600);
  });

  it.each(formats.flatMap(format=>[';','\t'].flatMap(delimiter=>['sync','rename'].map(phase=>({format,delimiter:delimiter as CsvExportDelimiter,phase})))) )('$format/$delimiter 在$phase期取消保持原提交屏障与清理',async({format,delimiter,phase})=>{
    let cancelled=false,committed=false,enter!:()=>void,resume!:()=>void;const reached=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{resume=resolve;});
    const input={...await options(format,'utf8',delimiter),checkCancelled(){if(cancelled&&!committed)throw Error('已取消');},onCommitStart(){committed=true;}};
    const io:AtomicFileIO={open:async path=>{const file=await open(path,'wx');return{write:(bytes,at,length)=>file.write(bytes,at,length),sync:async()=>{if(phase==='sync'){enter();await gate;}await file.sync();},close:()=>file.close()};},rename:async(from,to)=>{if(phase==='rename'){enter();await gate;}await rename(from,to);},remove:path=>rm(path,{force:true})};
    const writer=await createQueryStreamFile(input,io);try{for(const frame of frames())await writer.write(frame);const finishing=writer.complete(),settled=phase==='sync'?expect(finishing).rejects.toThrow('取消'):expect(finishing).resolves.toBeUndefined();await reached;expect(await readFile(input.filePath,'utf8')).toBe('原文件');cancelled=true;resume();await settled;expect(writer.fileCommitted).toBe(phase==='rename');}finally{await writer.abort();}
    if(phase==='sync')expect(await readFile(input.filePath,'utf8')).toBe('原文件');else{const bytes=await readFile(input.filePath);expect(format==='csv'?bytes:decodeQueryCsvZip(bytes).get('results/rows-002.csv')).toEqual(encoded(expected[delimiter],'utf8'));}expect(await readdir(directories.at(-1)!)).toEqual([format==='csv'?'all.csv':'all.zip']);
  });

  it.each(['json','sql'] as const)('内部$0调用也在创建文件或进入INSERT暂存前拒绝夹带分隔符',async format=>{
    const input=await options('csv');await expect(createQueryStreamFile({...input,format,resultSelection:{kind:'all'},csvDelimiter:';'})).rejects.toThrow('CSV');expect(await readFile(input.filePath,'utf8')).toBe('原文件');expect(await readdir(directories.at(-1)!)).toEqual(['all.csv']);
  });
});
