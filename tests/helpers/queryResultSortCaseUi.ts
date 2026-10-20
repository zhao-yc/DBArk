import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';

// 独立常量SELECT保留七个不同原值；Unicode使用明确UTF-8字节，不读表或写入资源。
// 夹具各分支文本明确使用同一字符集及排序规则，避免UNION先失败；本地比较器和原文期待不变。
export const queryResultSortCaseSql="SELECT CONVERT('1' USING utf8mb4) COLLATE utf8mb4_bin AS id,CONVERT('a' USING utf8mb4) COLLATE utf8mb4_bin AS text_value,CAST('18446744073709551615' AS UNSIGNED) AS big_value,CAST('0.12345678901234567890' AS DECIMAL(30,20)) AS exact_value,CAST(NULL AS DATETIME(6)) AS moment_value,CAST(NULL AS TIME(6)) AS duration_value,CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_bin AS group_value,X'00ff' AS bytes UNION ALL SELECT CONVERT('2' USING utf8mb4) COLLATE utf8mb4_bin,CONVERT('B' USING utf8mb4) COLLATE utf8mb4_bin,NULL,NULL,CAST('2026-10-21 12:00:00.000001' AS DATETIME(6)),CAST('-100:00:00.000001' AS TIME(6)),CONVERT('A' USING utf8mb4) COLLATE utf8mb4_bin,NULL UNION ALL SELECT CONVERT('3' USING utf8mb4) COLLATE utf8mb4_bin,CONVERT('A' USING utf8mb4) COLLATE utf8mb4_bin,CAST('9007199254740993' AS UNSIGNED),CAST('1.00000000000000000001' AS DECIMAL(30,20)),CAST('2026-10-21 12:00:00.000002' AS DATETIME(6)),CAST('-99:59:59.999999' AS TIME(6)),CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_bin,X'' UNION ALL SELECT CONVERT('4' USING utf8mb4) COLLATE utf8mb4_bin,CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_bin,CAST('2' AS UNSIGNED),NULL,NULL,NULL,CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_bin,NULL UNION ALL SELECT CONVERT('5' USING utf8mb4) COLLATE utf8mb4_bin,CONVERT('' USING utf8mb4) COLLATE utf8mb4_bin,CAST('0' AS UNSIGNED),NULL,NULL,NULL,CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_bin,NULL UNION ALL SELECT CONVERT('6' USING utf8mb4) COLLATE utf8mb4_bin,CONVERT(X'c4b0' USING utf8mb4) COLLATE utf8mb4_bin,CAST('18446744073709551615' AS UNSIGNED),CAST('0.12345678901234567891' AS DECIMAL(30,20)),NULL,NULL,CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_bin,X'01' UNION ALL SELECT CONVERT('7' USING utf8mb4) COLLATE utf8mb4_bin,CONVERT(X'69cc87' USING utf8mb4) COLLATE utf8mb4_bin,CAST('9007199254740993' AS UNSIGNED),CAST('0.12345678901234567890' AS DECIMAL(30,20)),NULL,NULL,CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_bin,NULL ORDER BY id";
export const queryResultSortCaseHeaders=['id','text_value','big_value','exact_value','moment_value','duration_value','group_value','bytes'];

/** 固定原行1/3/6/7，分别验证大小写与两个映射后相同的Unicode原文；不借用产品比较器。 */
export function verifyQueryResultSortCaseFile(format:'csv'|'json',bytes:Buffer):void{
  if(bytes.length>32768)throw Error('大小写排序常量输出超出预算');
  if(format==='csv')assert.deepEqual(parse(bytes,{encoding:'utf8',bom:true,columns:false,cast:false}),[
    queryResultSortCaseHeaders,
    ['1','a','18446744073709551615','0.12345678901234567890','\\N','\\N','\\N','base64:AP8='],
    ['3','A','9007199254740993','1.00000000000000000001','2026-10-21 12:00:00.000002','-99:59:59.999999','\\N','base64:'],
    ['6','İ','18446744073709551615','0.12345678901234567891','\\N','\\N','\\N','base64:AQ=='],
    ['7','i\u0307','9007199254740993','0.12345678901234567890','\\N','\\N','\\N','\\N'],
  ]);
  else{
    const rows=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    assert.deepEqual(rows,[
      {id:'1',text_value:'a',big_value:'18446744073709551615',exact_value:'0.12345678901234567890',moment_value:null,duration_value:null,group_value:null,bytes:{type:'binary',base64:'AP8='}},
      {id:'3',text_value:'A',big_value:'9007199254740993',exact_value:'1.00000000000000000001',moment_value:'2026-10-21 12:00:00.000002',duration_value:'-99:59:59.999999',group_value:null,bytes:{type:'binary',base64:''}},
      {id:'6',text_value:'İ',big_value:'18446744073709551615',exact_value:'0.12345678901234567891',moment_value:null,duration_value:null,group_value:null,bytes:{type:'binary',base64:'AQ=='}},
      {id:'7',text_value:'i\u0307',big_value:'9007199254740993',exact_value:'0.12345678901234567890',moment_value:null,duration_value:null,group_value:null,bytes:null},
    ]);
    for(const row of rows)assert.deepEqual(Object.keys(row),queryResultSortCaseHeaders);
  }
}

/** 页内合成copy不读写系统剪贴板；手写原文期待不从已排序数据生成。 */
export function verifyQueryResultSortCaseCopy(value:unknown):void{
  const record=value as {prevented?:boolean;typed?:string;text?:string};assert.equal(record?.prevented,true);
  assert.deepEqual(JSON.parse(record.typed??''),{version:1,rows:[
    ['1','a','18446744073709551615','0.12345678901234567890',null,null,null,{type:'binary',base64:'AP8='}],
    ['3','A','9007199254740993','1.00000000000000000001','2026-10-21 12:00:00.000002','-99:59:59.999999',null,{type:'binary',base64:''}],
    ['6','İ','18446744073709551615','0.12345678901234567891',null,null,null,{type:'binary',base64:'AQ=='}],
    ['7','i\u0307','9007199254740993','0.12345678901234567890',null,null,null,null],
  ]});
  assert.equal(record.text,'1\ta\t18446744073709551615\t0.12345678901234567890\tNULL\tNULL\tNULL\t0x00ff\n3\tA\t9007199254740993\t1.00000000000000000001\t2026-10-21 12:00:00.000002\t-99:59:59.999999\tNULL\t0x\n6\tİ\t18446744073709551615\t0.12345678901234567891\tNULL\tNULL\tNULL\t0x01\n7\ti\u0307\t9007199254740993\t0.12345678901234567890\tNULL\tNULL\tNULL\tNULL');
}
