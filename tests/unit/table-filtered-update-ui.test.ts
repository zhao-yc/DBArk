import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { TableFilteredUpdateIntent, tableFilteredUpdateColumns, tableFilteredUpdateValue, checkTableFilteredUpdateApplied, checkTableFilteredUpdatePreview, mergeTableFilteredUpdateProgress, tableFilteredUpdateInputDigest, tableFilteredUpdateCommitted } from '../../src/renderer/tableFilteredUpdateUi';
import { tableFilteredUpdateLimits, type TableFilteredUpdateProgress } from '../../src/shared/tableFilteredUpdate';

function source():TableInfo{return{database:'库`名',name:'表.名',objectKind:'table',engine:'InnoDB',columns:[['id','BIGINT'],['body','TEXT'],['payload','BLOB'],['amount','DECIMAL(30,12)'],['j','JSON'],['g','INT']].map(([name,type])=>({name,type,nullable:name!=='id',generated:name==='g',defaultValue:null,extra:name==='g'?'STORED GENERATED':'',comment:''})),primaryKey:['id'],editableKey:['id'],indexes:[{name:'PRIMARY',unique:true,columns:['id']}],foreignKeys:[],ddl:'完整结构'};}
function intent(guard=()=>true){const info=source();return new TableFilteredUpdateIntent({connectionId:'c',database:info.database,table:info.name},info,{filters:[{column:'body',operator:'=',value:'A'},{column:'body',operator:'=',value:'B'},{column:'amount',operator:'>=',value:'9007199254740993.123456789012',enabled:false}],filterMode:'all',filterGroup:{mode:'all',children:[{mode:'any',children:[0,1]},2]},sort:[{column:'amount',direction:'DESC'},{column:'id',direction:'ASC'}]},['page1'],guard);}
function progress(overrides:Partial<TableFilteredUpdateProgress>={}):TableFilteredUpdateProgress{return{phase:'updating',rows:0,totalRows:512,snapshotBytes:100,dmlMayHaveBeenSent:false,commitMayHaveBeenSent:false,commitAcknowledged:false,rollbackAcknowledged:false,transactionProtected:true,outcome:'not-sent',...overrides};}
describe('服务器全部筛选行填充范围与回执',()=>{
  it('整组复制后修改不污染来源；保持精确文本、NULL、BLOB、全部范围及顺序',async()=>{
    const lease=intent(),drafts=[{column:'amount',input:{mode:'text' as const,text:'9007199254740993.123456789012'}},{column:'body',input:{mode:'null' as const,text:'忽略'}},{column:'payload',input:{mode:'binary' as const,text:'0x00ff'}}],input=lease.inputs(drafts,randomUUID());
    expect(input).toMatchObject({assignments:[{column:'amount',value:'9007199254740993.123456789012'},{column:'body',value:null},{column:'payload',value:{type:'binary',base64:'AP8='}}],filters:lease.scope.filters,filterGroup:lease.scope.filterGroup,sort:lease.scope.sort});
    expect(Object.hasOwn(input,'column')).toBe(false);drafts[0].input.text='改动副本';expect('assignments' in input&&input.assignments[0].value).toBe('9007199254740993.123456789012');
    const tuples=[['amount','9007199254740993.123456789012'],['body',null],['payload',{type:'binary',base64:'AP8='}]];
    expect(await tableFilteredUpdateInputDigest(input)).toBe(createHash('sha256').update(JSON.stringify(tuples)).digest('hex'));
    const single=lease.inputs([drafts[0]],randomUUID());expect(Object.hasOwn(single,'assignments')).toBe(false);expect(await tableFilteredUpdateInputDigest(single)).toBe(createHash('sha256').update(JSON.stringify(['amount','改动副本'])).digest('hex'));
  });
  it('重复字段、后续非法字段及整组预算超限同步拒绝，不能只留下前缀',()=>{
    const lease=intent(),valid={column:'body',input:{mode:'text' as const,text:'前项有效'}};
    for(const drafts of [[valid,valid],[valid,{column:'g',input:{mode:'text' as const,text:'1'}}],[valid,{column:'j',input:{mode:'json' as const,text:'{'}}],[]])expect(()=>lease.inputs(drafts,randomUUID())).toThrow();
    const value='x'.repeat(Math.floor(tableFilteredUpdateLimits.rowBytes/3)+1);
    expect(()=>lease.inputs(['body','amount','j'].map(column=>({column,input:{mode:'text' as const,text:value}})),randomUUID())).toThrow();
  });
  it('整组回证必须有序全列、原digest和原目标，提交子集/旧首列/重排均拒绝',async()=>{
    const lease=intent(),input=lease.inputs([{column:'body',input:{mode:'null',text:''}},{column:'payload',input:{mode:'binary',text:'0x00ff'}}],randomUUID()),digest=await tableFilteredUpdateInputDigest(input),preview={previewToken:randomUUID(),target:lease.target,columns:['body','payload'],rows:512,shownRows:1,sql:'UPDATE sample;',sampleOmitted:true,expiresAt:new Date(Date.now()+60000).toISOString(),definitionDigest:'a'.repeat(64),assignmentDigest:digest,timeZone:'SYSTEM',warnings:[]};
    expect(checkTableFilteredUpdatePreview(preview,input,digest)).toEqual(preview);
    for(const changed of [{...preview,columns:['body']},{...preview,columns:['payload','body']},{...preview,assignmentDigest:'b'.repeat(64)},{...preview,target:{...lease.target,connectionId:'其它'}}])expect(()=>checkTableFilteredUpdatePreview(changed,input,digest)).toThrow();
    expect(()=>checkTableFilteredUpdatePreview(preview,input)).toThrow();
    const output=tableFilteredUpdateCommitted(preview);expect(output).toMatchObject({columns:['body','payload'],rows:512});expect(checkTableFilteredUpdateApplied(output,preview)).toEqual(output);
    for(const changed of [{...output,columns:['body']},{...output,columns:['payload','body']},{target:lease.target,column:'body',rows:512,outcome:'committed',commitAcknowledged:true}])expect(()=>checkTableFilteredUpdateApplied(changed,preview)).toThrow();
  });
  it('复制完整嵌套OR/停用位/多排序，精确值不转number；不含页码、OFFSET或本地行',()=>{const lease=intent(),input=lease.input('amount',{mode:'text',text:'9007199254740993.123456789012'},randomUUID());expect(input.value).toBe('9007199254740993.123456789012');expect(input.filterGroup).toEqual(lease.scope.filterGroup);expect(input.filters[2].enabled).toBe(false);expect(input.sort).toEqual([{column:'amount',direction:'DESC'},{column:'id',direction:'ASC'}]);expect(Object.keys(input).sort()).toEqual(['column','connectionId','database','filterGroup','filterMode','filters','metadataKey','sort','table','taskId','value']);expect(Object.isFrozen(lease.scope.filters[0])).toBe(true);});
  it('父scope A→B→A永久失效，guard变化和异常同样拒绝旧请求',()=>{const lease=intent();lease.observe(['page2']);lease.observe(['page1']);expect(lease.current()).toBe(false);expect(()=>lease.input('body',{mode:'text',text:'x'},randomUUID())).toThrow();let okay=true;const another=intent(()=>okay);okay=false;expect(another.current()).toBe(false);okay=true;expect(another.current()).toBe(false);expect(intent(()=>{throw Error('守卫失效');}).current()).toBe(false);});
  it('仅普通InnoDB可靠键对象有候选，键/自增/生成列不能填充',()=>{const info=source();info.columns.push({...info.columns[1],name:'auto',extra:'auto_increment'});expect(tableFilteredUpdateColumns(info).map(column=>column.name)).toEqual(['body','payload','amount','j']);for(const changed of [{...info,objectKind:'view' as const},{...info,engine:'MyISAM'},{...info,editableKey:[]}])expect(tableFilteredUpdateColumns(changed)).toEqual([]);for(const key of ['id','g','auto'])expect(()=>tableFilteredUpdateValue(info,key,{mode:'text',text:'1'})).toThrow();});
  it('NULL、空字节、JSON词法保持原类型；DEFAULT/坏Hex/非法JSON整次拒绝',()=>{const info=source();expect(tableFilteredUpdateValue(info,'payload',{mode:'binary',text:'0x'})).toEqual({type:'binary',base64:''});expect(tableFilteredUpdateValue(info,'payload',{mode:'null',text:''})).toBeNull();expect(tableFilteredUpdateValue(info,'j',{mode:'json',text:'{"n":9007199254740993}'})).toBe('{"n":9007199254740993}');for(const input of [{mode:'default' as const,text:''},{mode:'binary' as const,text:'0x0'},{mode:'json' as const,text:'{'}])expect(()=>tableFilteredUpdateValue(info,'body',input)).toThrow();});
  it('准确预览与提交逐字段回证，不接受另一目标/字段/行数，有限样本明确省略',()=>{const lease=intent(),input=lease.input('body',{mode:'text',text:'x'},randomUUID()),preview={previewToken:randomUUID(),target:lease.target,column:'body',rows:512,shownRows:1,sql:'UPDATE sample;',sampleOmitted:true,expiresAt:new Date(Date.now()+60000).toISOString(),definitionDigest:'a'.repeat(64),assignmentDigest:'b'.repeat(64),timeZone:'SYSTEM',warnings:[]};expect(checkTableFilteredUpdatePreview(preview,input)).toEqual(preview);for(const changed of [{...preview,column:'j'},{...preview,target:{...lease.target,table:'其它'}},{...preview,sampleOmitted:false}])expect(()=>checkTableFilteredUpdatePreview(changed,input)).toThrow();const output={target:lease.target,column:'body',rows:512,outcome:'committed',commitAcknowledged:true};expect(checkTableFilteredUpdateApplied(output,preview)).toEqual(output);expect(()=>checkTableFilteredUpdateApplied({...output,rows:1},preview)).toThrow();});
  it('COMMIT发送与准确全量ACK单调保留；不完整ACK、回滚与其它进度不伪造已提交',()=>{const before=mergeTableFilteredUpdateProgress(undefined,progress({phase:'committing',rows:512,commitMayHaveBeenSent:true,dmlMayHaveBeenSent:true,outcome:'unknown'}),512)!;const old=mergeTableFilteredUpdateProgress(before,progress(),512)!;expect(old.commitMayHaveBeenSent).toBe(true);expect(old.outcome).toBe('unknown');expect(mergeTableFilteredUpdateProgress(old,progress({commitAcknowledged:true,commitMayHaveBeenSent:true,rows:1,outcome:'committed'}),512)).toBe(old);const ack=mergeTableFilteredUpdateProgress(old,progress({phase:'finished',rows:512,commitMayHaveBeenSent:true,commitAcknowledged:true,outcome:'committed'}),512)!;expect(ack.commitAcknowledged).toBe(true);expect(mergeTableFilteredUpdateProgress(ack,progress(),512)!.outcome).toBe('committed');expect(mergeTableFilteredUpdateProgress(undefined,progress({rollbackAcknowledged:true,transactionProtected:true,outcome:'rolled-back'}),512)!.outcome).toBe('rolled-back');});
  it('真实修改后失保护永久保持unknown，回滚ACK及迟到旧true不能追认已回滚', () => {
    const active = mergeTableFilteredUpdateProgress(undefined, progress({ dmlMayHaveBeenSent: true, outcome: 'unknown' }), 512)!;
    const lost = mergeTableFilteredUpdateProgress(active, progress({ phase: 'rolling-back', dmlMayHaveBeenSent: true, transactionProtected: false, rollbackAcknowledged: true, outcome: 'unknown' }), 512)!;
    expect(lost.transactionProtected).toBe(false); expect(lost.rollbackAcknowledged).toBe(true); expect(lost.outcome).toBe('unknown');
    const late = mergeTableFilteredUpdateProgress(lost, progress({ dmlMayHaveBeenSent: true, transactionProtected: true, rollbackAcknowledged: true, outcome: 'rolled-back' }), 512)!;
    expect(late.transactionProtected).toBe(false); expect(late.outcome).toBe('unknown');
    const prepare = mergeTableFilteredUpdateProgress(late, progress({ phase: 'preparing', dmlMayHaveBeenSent: false, transactionProtected: false, outcome: 'not-sent' }), 512)!;
    expect(prepare.transactionProtected).toBe(false); expect(prepare.dmlMayHaveBeenSent).toBe(true); expect(prepare.outcome).toBe('unknown');
  });
  it('初始及迟到prepare未发送DML的false不抹真实保护，正常受保护回滚仍可确认', () => {
    const initial = mergeTableFilteredUpdateProgress(undefined, progress({ phase: 'preparing', dmlMayHaveBeenSent: false, transactionProtected: false }), 512)!;
    expect(initial.transactionProtected).toBe(false);
    const active = mergeTableFilteredUpdateProgress(initial, progress({ dmlMayHaveBeenSent: true, transactionProtected: true, outcome: 'unknown' }), 512)!;
    const late = mergeTableFilteredUpdateProgress(active, progress({ phase: 'preparing', dmlMayHaveBeenSent: false, transactionProtected: false, outcome: 'not-sent' }), 512)!;
    expect(late.transactionProtected).toBe(true); expect(late.dmlMayHaveBeenSent).toBe(true); expect(late.outcome).toBe('unknown');
    const rollback = mergeTableFilteredUpdateProgress(late, progress({ phase: 'finished', dmlMayHaveBeenSent: true, transactionProtected: true, rollbackAcknowledged: true, outcome: 'rolled-back' }), 512)!;
    expect(rollback.transactionProtected).toBe(true); expect(rollback.outcome).toBe('rolled-back');
  });
  it('Main形状真实完整COMMIT ACK优先于失保护及迟到失败，不恢复失保护标志', () => {
    const lost = mergeTableFilteredUpdateProgress(undefined, progress({ dmlMayHaveBeenSent: true, transactionProtected: false, rollbackAcknowledged: true, outcome: 'unknown' }), 512)!;
    const committed = mergeTableFilteredUpdateProgress(lost, progress({ phase: 'finished', rows: 512, dmlMayHaveBeenSent: true, transactionProtected: false, commitMayHaveBeenSent: true, commitAcknowledged: true, outcome: 'committed' }), 512)!;
    expect(committed.commitAcknowledged).toBe(true); expect(committed.outcome).toBe('committed'); expect(committed.transactionProtected).toBe(false);
    const late = mergeTableFilteredUpdateProgress(committed, progress({ rows: 0, dmlMayHaveBeenSent: true, transactionProtected: false, rollbackAcknowledged: true, outcome: 'unknown' }), 512)!;
    expect(late.commitAcknowledged).toBe(true); expect(late.outcome).toBe('committed'); expect(late.rows).toBe(512); expect(late.totalRows).toBe(512); expect(late.transactionProtected).toBe(false);
  });
});
