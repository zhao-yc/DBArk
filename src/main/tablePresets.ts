import type { TableInfo } from '../shared/contracts';
import { randomUUID } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import { tablePresetApplySchema, validateTablePresetColumns, type TablePresetConfiguration, type TablePresetSelect, type TablePresetSnapshot, type TablePresetStoredSnapshot, type TablePresetTarget } from '../shared/tablePresets';

interface Port {
  selected(input:TablePresetSelect):TablePresetConfiguration;
  assertCurrent():void;
  metadata(input:{connectionId:string;database:string;table:string;taskId:string}):Promise<TableInfo>;
}
/** 真实Main来源在每个await前后复核；元数据只读，缺字段或连接修订变化整份拒绝。 */
export async function applyTablePreset(raw:unknown,port:Port):Promise<TablePresetConfiguration> {
  const {taskId,...input}=tablePresetApplySchema.parse(raw),target={connectionId:input.connectionId,database:input.database,table:input.table};
  port.assertCurrent();port.selected(input);
  const info=await port.metadata({...target,taskId});port.assertCurrent();
  if(info.database!==target.database||info.name!==target.table)throw Error('方案目标表已变化，整份方案未应用');
  return validateTablePresetColumns(port.selected(input),info.columns.map(column=>column.name));
}

/** 来源令牌只在Main内存持有真实文档捕获，绑定准确库表及连接来源；list不访问worker。 */
export class TablePresetSources {
  private readonly tokens=new Map<string,{owner:ColumnsInvocation;target:string;source:string;expires:number}>();
  /** 仅注入原Main捕获门，构造本身不接触worker或连接。 */
  constructor(private owner:{assert(invocation?:ColumnsInvocation):void;same(left:ColumnsInvocation,right:ColumnsInvocation):boolean}){}
  /** 数组编码精确保留名称分隔符及大小写，不拼接有歧义的字符串主键。 */
  private target(value:TablePresetTarget):string{return JSON.stringify([value.connectionId,value.database,value.table]);}
  issue(invocation:ColumnsInvocation|undefined,target:TablePresetTarget,snapshot:TablePresetStoredSnapshot):TablePresetSnapshot {
    this.owner.assert(invocation);
    for(const [key,value]of this.tokens)if(value.expires<=Date.now())this.tokens.delete(key);
    if(this.tokens.size>=256)this.tokens.delete(this.tokens.keys().next().value!);
    const token=randomUUID();this.tokens.set(token,{owner:invocation!,target:this.target(target),source:JSON.stringify(snapshot.source),expires:Date.now()+600000});
    return {...snapshot,bindingToken:token};
  }
  assert(invocation:ColumnsInvocation|undefined,input:TablePresetSelect|{bindingToken:string;source:unknown;connectionId:string;database:string;table:string}):void {
    this.owner.assert(invocation);const bound=this.tokens.get(input.bindingToken);
    if(!bound||bound.expires<=Date.now()||bound.target!==this.target(input)||bound.source!==JSON.stringify(input.source)||!this.owner.same(bound.owner,invocation!))throw Error('方案请求来源、文档或连接已变化，请刷新方案');
  }
  /** 导航、崩溃和销毁撤销原文档全部来源，恢复同URL也不能复活。 */
  invalidate():void {this.tokens.clear();}
}
