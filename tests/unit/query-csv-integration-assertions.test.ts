import { crc32 } from 'node:zlib';
import iconv from 'iconv-lite';
import { expect, it } from 'vitest';
import { assertQcsvCsv, assertQcsvOutput } from '../helpers/queryCsvIntegrationAssertions';
import { qcsvCases, qcsvEmptyHeader, qcsvHeaders, type QcsvCase } from '../helpers/queryCsvIntegration';

const simple = {
  default: '"逗,号",分;号,制\t表\r\n"值,逗",值;分,值\t制\r\n\\N,"",\\\\N\r\n',
  semicolon: '逗,号;"分;号";制\t表\r\n值,逗;"值;分";值\t制\r\n\\N;"";\\\\N\r\n',
  tab: '逗,号\t分;号\t"制\t表"\r\n值,逗\t值;分\t"值\t制"\r\n\\N\t""\t\\\\N\r\n',
};
const headers = ['逗,号','分;号','制\t表'], fields = [['值,逗','值;分','值\t制'],['\\N','','\\\\N']];
const encode = (text: string, scenario: QcsvCase) => iconv.encode((scenario.encoding === 'utf16le' ? '\uFEFF' : '') + text, scenario.encoding);

it.each(qcsvCases.filter(value => value.format === 'csv'))('$id手写CSV预期独立通过，改字节/分隔符/字段顺序必须失败', scenario => {
  const bytes = encode(simple[scenario.separator], scenario); expect(() => assertQcsvCsv(bytes, scenario, headers, fields)).not.toThrow();
  const corrupted = Buffer.from(bytes); corrupted[corrupted.length - 1] ^= 1; expect(() => assertQcsvCsv(corrupted, scenario, headers, fields)).toThrow();
  expect(() => assertQcsvCsv(bytes, scenario, [...headers].reverse(), fields)).toThrow();
  expect(() => assertQcsvCsv(bytes, { ...scenario, delimiter: scenario.delimiter === ';' ? ',' : ';' }, headers, fields)).toThrow();
});

const allHeaders = {
  default: '"无符号,大数",有符号;大数,精确\t小数,微秒日期,微秒时间,可空,空串,首斜线,"标点,;\t""\r\n",二进制,JSON大整数\r\n',
  semicolon: '无符号,大数;"有符号;大数";精确\t小数;微秒日期;微秒时间;可空;空串;首斜线;"标点,;\t""\r\n";二进制;JSON大整数\r\n',
  tab: '无符号,大数\t有符号;大数\t"精确\t小数"\t微秒日期\t微秒时间\t可空\t空串\t首斜线\t"标点,;\t""\r\n"\t二进制\tJSON大整数\r\n',
};

/** 仅按ZIP64标准字段手工组装RAM夹具，CRC取Node独立实现；不调用产品ZIP写入器。 */
function zip(entries: [string, Buffer][]) {
  const local: Buffer[] = [], directory: Buffer[] = []; let offset = 0;
  for (const [name, bytes] of entries) {
    const label = Buffer.from(name), header = Buffer.alloc(30), descriptor = Buffer.alloc(24), central = Buffer.alloc(46), extra = Buffer.alloc(28);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(45,4); header.writeUInt16LE(0x0808,6); header.writeUInt16LE(label.length,26);
    descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc32(bytes),4); descriptor.writeBigUInt64LE(BigInt(bytes.length),8); descriptor.writeBigUInt64LE(BigInt(bytes.length),16);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0808,8); central.writeUInt32LE(crc32(bytes),16); central.writeUInt16LE(label.length,28); central.writeUInt16LE(28,30);
    extra.writeUInt16LE(1); extra.writeUInt16LE(24,2); extra.writeBigUInt64LE(BigInt(bytes.length),4); extra.writeBigUInt64LE(BigInt(bytes.length),12); extra.writeBigUInt64LE(BigInt(offset),20);
    local.push(header,label,bytes,descriptor); directory.push(central,label,extra); offset += header.length + label.length + bytes.length + descriptor.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(98);
  end.writeUInt32LE(0x06064b50); end.writeBigUInt64LE(44n,4); end.writeBigUInt64LE(BigInt(entries.length),24); end.writeBigUInt64LE(BigInt(entries.length),32); end.writeBigUInt64LE(BigInt(central.length),40); end.writeBigUInt64LE(BigInt(offset),48);
  end.writeUInt32LE(0x07064b50,56); end.writeBigUInt64LE(BigInt(offset + central.length),64); end.writeUInt32LE(1,72); end.writeUInt32LE(0x06054b50,76);
  return Buffer.concat([...local,central,end]);
}

/** 标题和清单期望均手写，数据文件为空只用于检验验证器护栏，不当作实库样本。 */
function fixture(scenario: QcsvCase, change?: (manifest: any, entries: [string, Buffer][]) => void) {
  const empty = encode('"空行集,;\t""\r\n"\r\n',scenario), rows = encode(allHeaders[scenario.separator],scenario);
  const types = ['LONGLONG','LONGLONG','NEWDECIMAL','DATETIME','TIME','BLOB','BLOB','BLOB','BLOB','BLOB','JSON'];
  const columns = (names: readonly string[], types: string[]) => names.map((name,index) => ({position:index+1,name,exportName:name,type:types[index]}));
  const manifest = { format:'DBArk-query-csv-archive',version:1,encoding:scenario.encoding,csv:{delimiter:scenario.delimiter,recordDelimiter:'\r\n',null:'\\N',leadingBackslash:'double',binary:'base64:',header:'exportName',columnOrder:'position'},results:[
    {kind:'rows',resultOrdinal:1,statementOrdinal:1,rowResultOrdinal:1,file:'results/rows-001.csv',columns:columns([qcsvEmptyHeader],['LONG']),rowsWritten:0,bytes:empty.length},
    {kind:'status',resultOrdinal:2,statementOrdinal:2,affectedRows:0,insertId:'0',warningCount:0},
    {kind:'rows',resultOrdinal:3,statementOrdinal:3,rowResultOrdinal:2,file:'results/rows-002.csv',columns:columns(qcsvHeaders,types),rowsWritten:0,bytes:rows.length},
  ] };
  const entries: [string,Buffer][] = [['results/rows-001.csv',empty],['results/rows-002.csv',rows]];
  change?.(manifest,entries); entries.push(['manifest.json',Buffer.from(JSON.stringify(manifest)+'\n')]); return zip(entries);
}

it.each(qcsvCases.filter(value => value.format === 'csv-zip'))('$id独立ZIP64/CRC及全部标题、manifest字节核验器通过手写夹具', scenario => {
  expect(assertQcsvOutput(fixture(scenario),scenario,[]).entries).toBe(3);
});

it.each(['delimiter','encoding','ordinal','position','type','bytes','warning','extra','duplicate','crc'] as const)('ZIP%s篡改必须拒绝，不把CRC/清单错误作为成功', mode => {
  const scenario = qcsvCases.find(value => value.id === 'csv-zip/utf8/default')!;
  const bytes = fixture(scenario,(manifest,entries)=>{
    if(mode==='delimiter')manifest.csv.delimiter=';'; if(mode==='encoding')manifest.encoding='utf16le'; if(mode==='ordinal')manifest.results[2].rowResultOrdinal=1; if(mode==='position')manifest.results[2].columns[0].position=2; if(mode==='type')manifest.results[2].columns[0].type='DOUBLE'; if(mode==='bytes')manifest.results[0].bytes++; if(mode==='warning')manifest.results[2].warningCount=1;
    if(mode==='extra')entries.push(['results/rows-003.csv',Buffer.from('未知')]); if(mode==='duplicate')entries.push(entries[0]);
  });
  if(mode==='crc')bytes[30+Buffer.byteLength('results/rows-001.csv')]^=1;
  expect(()=>assertQcsvOutput(bytes,scenario,[])).toThrow();
});
