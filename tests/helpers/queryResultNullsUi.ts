import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';

// 一次常量SELECT，不读表或存储函数；每列明确类型，包含NULL、空串和高精度原值。
export const queryResultNullsSql="SELECT CAST('1' AS CHAR) AS id,CAST(NULL AS CHAR) AS text_value,CAST('18446744073709551615' AS UNSIGNED) AS big_value,CAST('0.12345678901234567890' AS DECIMAL(30,20)) AS exact_value,CAST(NULL AS DATETIME(6)) AS moment_value,CAST(NULL AS TIME(6)) AS duration_value,CAST(NULL AS CHAR) AS group_value,X'00ff' AS bytes UNION ALL SELECT CAST('2' AS CHAR),'',NULL,NULL,CAST('2026-10-21 12:00:00.000001' AS DATETIME(6)),CAST('-100:00:00.000001' AS TIME(6)),'A',NULL UNION ALL SELECT CAST('3' AS CHAR),'NULL',CAST('9007199254740993' AS UNSIGNED),CAST('1.00000000000000000001' AS DECIMAL(30,20)),CAST('2026-10-21 12:00:00.000002' AS DATETIME(6)),CAST('-99:59:59.999999' AS TIME(6)),NULL,X'' ORDER BY id";
export const queryResultNullsHeaders=['id','text_value','big_value','exact_value','moment_value','duration_value','group_value','bytes'];

/** 人工固定最终原行1/3，不用产品排序、投影或导出器生成期待。 */
export function verifyQueryResultNullsFile(format:'csv'|'json',bytes:Buffer):void{
  if(bytes.length>32768)throw Error('NULL排序常量输出超出预算');
  if(format==='csv')assert.deepEqual(parse(bytes,{encoding:'utf8',bom:true,columns:false,cast:false}),[
    queryResultNullsHeaders,
    ['1','\\N','18446744073709551615','0.12345678901234567890','\\N','\\N','\\N','base64:AP8='],
    ['3','NULL','9007199254740993','1.00000000000000000001','2026-10-21 12:00:00.000002','-99:59:59.999999','\\N','base64:'],
  ]);
  else{
    const rows=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    assert.deepEqual(rows,[
      {id:'1',text_value:null,big_value:'18446744073709551615',exact_value:'0.12345678901234567890',moment_value:null,duration_value:null,group_value:null,bytes:{type:'binary',base64:'AP8='}},
      {id:'3',text_value:'NULL',big_value:'9007199254740993',exact_value:'1.00000000000000000001',moment_value:'2026-10-21 12:00:00.000002',duration_value:'-99:59:59.999999',group_value:null,bytes:{type:'binary',base64:''}},
    ]);
    for(const row of rows)assert.deepEqual(Object.keys(row),queryResultNullsHeaders);
  }
}

/** 合成事件只检查页内DataTransfer，不能算系统剪贴板或真实复制按钮通过。 */
export function verifyQueryResultNullsCopy(value:unknown):void{
  const record=value as {prevented?:boolean;typed?:string;text?:string};assert.equal(record?.prevented,true);
  assert.deepEqual(JSON.parse(record.typed??''),{version:1,rows:[
    ['1',null,'18446744073709551615','0.12345678901234567890',null,null,null,{type:'binary',base64:'AP8='}],
    ['3','NULL','9007199254740993','1.00000000000000000001','2026-10-21 12:00:00.000002','-99:59:59.999999',null,{type:'binary',base64:''}],
  ]});
  assert.equal(record.text,'1\tNULL\t18446744073709551615\t0.12345678901234567890\tNULL\tNULL\tNULL\t0x00ff\n3\tNULL\t9007199254740993\t1.00000000000000000001\t2026-10-21 12:00:00.000002\t-99:59:59.999999\tNULL\t0x');
}
