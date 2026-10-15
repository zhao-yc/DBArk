import {createReadStream} from 'node:fs';
import {mkdir,open,stat,writeFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {parse} from 'csv-parse';
import {parser} from 'stream-json';
import {pick} from 'stream-json/filters/Pick';
import {streamArray} from 'stream-json/streamers/StreamArray';
import type {RowDataPacket} from 'mysql2/promise';
import type {TaskEvent} from '../../src/shared/contracts';
import {queryStreamExportLimits} from '../../src/shared/queryStreamExport';
import {test,expect,page,desktop,dataDir,pageErrors} from './desktop-fixture';
import {enabled,isolatedDatabase,openDatabaseQuery,writeSql} from './live-helpers';

// 必须显式启用百万行；不把凭据、实际文件数据或逐行事件写入轨迹。
test.use({trace:'off'});
type Latest=Pick<TaskEvent,'taskId'|'status'|'queryExport'>;
type MeasuredWindow=Window&{__millionExport?:{latest?:Latest;events:number}};
const amount='12345678901234567890.123456789012',base=9007199254740992n;
const query=()=>page.locator('.query-tab:visible');

/** 独立流式解析真实文件，每次只校验一行；不读取整文件、不积累百万行数组。 */
async function inspectFile(path:string,format:'csv'|'json'){
  const output=format==='json'?streamArray():parse({columns:true});let rows=0,sum=0,first='',last='';
  const inspect=(async()=>{for await(const entry of output){const row=(format==='json'?entry.value:entry) as Record<string,unknown>;rows++;const id=String(row.id);
    if(id!==String(rows)||row.label!==`第${rows}行🚀`||row.amount!==amount||row.large_id!==(base+BigInt(rows)).toString())throw Error('百万行'+format+'第'+rows+'行的顺序、Unicode或精度不符');
    if(rows===1){first=id;if(Object.keys(row).join(',')!=='id,label,amount,large_id')throw Error('完整文件列映射不符');}last=id;sum+=rows;
  }})();
  await Promise.all([format==='json'?pipeline(createReadStream(path),parser(),pick({filter:'results.0.rows'}),output):pipeline(createReadStream(path),output),inspect]);
  expect(rows).toBe(1000000);expect(sum).toBe(500000500000);expect(first).toBe('1');expect(last).toBe('1000000');
  const bytes=(await stat(path)).size;
  if(format==='json'){const file=await open(path,'r');try{const head=Buffer.alloc(160),tail=Buffer.alloc(160);await file.read(head,0,head.length,0);await file.read(tail,0,tail.length,bytes-tail.length);expect(head.toString()).toContain('"format":"DBArk-query-results","version":1');expect(tail.toString()).toContain('"rowsWritten":1000000');}finally{await file.close();}}
  return{format,rows,sum,first,last,bytes};
}

test('百万行真实SQL导出CSV和JSON，逐行精度正确且预览与待写队列有界',async({},info)=>{
  test.skip(!enabled||process.env.DBARK_TEST_MILLION!=='1','仅在已核对200隔离实例显式启用百万行');test.setTimeout(600000);
  await isolatedDatabase(async({observer,database})=>{
    await observer.query('CREATE TABLE `'+database+'`.million_export(id INT PRIMARY KEY,label VARCHAR(64),amount DECIMAL(40,12),large_id BIGINT) ENGINE=InnoDB');
    const digits='(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)',id='(1+d0.n+10*d1.n+100*d2.n+1000*d3.n+10000*d4.n+100000*d5.n)';
    // 固定小定义和服务器内造数；客户端仅接收状态包，不向驱动传入百万行数组。
    await observer.query({sql:'INSERT INTO `'+database+'`.million_export SELECT '+id+",CONCAT('第',"+id+",'行🚀'),CAST('"+amount+"' AS DECIMAL(40,12)),9007199254740992+"+id+' FROM '+Array.from({length:6},(_,i)=>digits+' d'+i).join(' CROSS JOIN '),timeout:120000});
    const[counts]=await observer.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM `'+database+'`.million_export');expect(Number(counts[0].n)).toBe(1000000);
    await openDatabaseQuery(database);await query().getByLabel('查询结果行数上限',{exact:true}).fill('2');await writeSql('SELECT id,label,amount,large_id FROM million_export ORDER BY id');
    // 只保留最新进度摘要，不在验收自身积累数据批次或全部事件。
    await page.evaluate(()=>{const state=window as MeasuredWindow;state.__millionExport={events:0};window.dbark.onTask(event=>{if(event.queryExport){state.__millionExport!.latest={taskId:event.taskId,status:event.status,queryExport:event.queryExport};state.__millionExport!.events++;}});});
    const directory=join(dataDir,'million-export');await mkdir(directory);const measurements=[];
    for(const format of ['csv','json'] as const){
      const target=join(directory,'all-million.'+format);await desktop.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=(async()=>({canceled:false,filePath})) as typeof dialog.showSaveDialog;},target);
      const before=await page.evaluate(async()=>(await window.dbark.invoke('tasks.list',{})).map(task=>task.id));await query().getByRole('button',{name:'新执行并完整导出',exact:true}).click();const modal=page.getByRole('dialog',{name:'完整流式导出（新执行 SQL）',exact:true});
      await modal.getByRole('combobox',{name:'完整文件格式',exact:true}).selectOption(format);await modal.locator('.file-picker').click();await expect(modal.locator('.file-picker')).toContainText(basename(target));await modal.getByRole('checkbox',{name:'我确认这是一次新的 SQL 执行，写入不能由取消文件导出撤销',exact:true}).check();await modal.getByRole('button',{name:'确认新执行并导出',exact:true}).click();
      let taskId='';await expect.poll(async()=>{const tasks=await page.evaluate(async ids=>(await window.dbark.invoke('tasks.list',{})).filter(task=>!ids.includes(task.id)&&task.kind==='query.exportStream'),before);if(tasks.length===1)taskId=tasks[0].id;return tasks.length;}).toBe(1);
      await expect.poll(()=>page.evaluate(async id=>(await window.dbark.invoke('tasks.list',{})).find(task=>task.id===id)?.status,taskId),{timeout:240000}).toBe('completed');await expect(modal.locator('.success-box')).toContainText('完整文件已提交');await expect(modal.locator('.error-box')).toHaveCount(0);
      const observed=await page.evaluate(()=>(window as MeasuredWindow).__millionExport);expect(observed?.latest).toMatchObject({taskId,status:'completed',queryExport:{statementsCompleted:1,rowsWritten:1000000,fileCommitted:true}});const progress=observed!.latest!.queryExport!;
      expect(progress.peakBufferedRows).toBeLessThanOrEqual(queryStreamExportLimits.queueRows);expect(progress.peakBufferedBytes).toBeLessThanOrEqual(queryStreamExportLimits.queueBytes);
      measurements.push({...await inspectFile(target,format),peakBufferedRows:progress.peakBufferedRows,peakBufferedBytes:progress.peakBufferedBytes,events:observed!.events});
      await modal.getByRole('button',{name:'关闭',exact:true}).click();await expect(modal).toBeHidden();await expect(query().locator('.tab-status')).toContainText('200');await expect(query().locator('.tab-status')).toContainText('已达到结果上限');expect(await query().locator('.result-body [role="row"]').count()).toBeLessThan(80);
    }
    expect(pageErrors).toEqual([]);const path=info.outputPath('million-export-measurements.json');await writeFile(path,JSON.stringify({scope:'真实同会话SQL导出；两份文件独立流式逐行检查，不以预览替代完整文件',measurements},null,2));await info.attach('百万行完整导出规模记录',{path,contentType:'application/json'});await page.screenshot({path:info.outputPath('million-export-bounded-preview.png')});
  },info);
});

// 0.17原246项之外的独立补充；声明阶段双门跳过，先于自动桌面夹具。
test.describe('Q05百万行CSV ZIP正式UI补充',()=>{
  test.skip(!enabled||process.env.DBARK_Q05_MILLION_ARCHIVE_UI!=='1','仅由ROOT显式启用200及百万行ZIP正式UI补充');
  test.beforeAll(async()=>{const{checkMillionUiPrerequisites}=await import('./query-csv-million-ui-helpers');await checkMillionUiPrerequisites();});
  test('Q05-MILLION-CSV-ZIP-UI：低普通上限下真实新执行导出全部行集，ID与一次执行及清理证据一致',async({},info)=>{
    test.setTimeout(600000);
    const{runMillionArchiveUi}=await import('./query-csv-million-ui-helpers');await runMillionArchiveUi(info);
  });
});
