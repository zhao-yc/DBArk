import {createHash} from 'node:crypto';
import {readStructureDefinition,assertStructureDefinitionUnchanged,structureTaskQuery,type StructureDefinitionRead,type StructureTaskContext} from './structureDefinition';
import {readIndexStructure,indexReferenceNames,assertIndexStructureUnchanged,type IndexStructureRead,type IndexReferenceNames} from './tableIndexRead';
import {readTableDefaultEncodingCatalog} from './tableDefaultEncodingCatalog';
import {readTableDefaultEncodingAlter} from './tableDefaultEncodingPrivileges';
import type {TableColumnPatchTarget} from '../shared/tableColumnPatches';
import {assertColumnCollationRuntimeFacts} from './tableColumnCollationInput';

/** 私有准备证据，不属于IPC或写入授权；TABLE_ID/算法与外部依赖读取未完成前始终阻断执行。 */
export interface ColumnCollationFacts {
  readonly kind:'column-collation-preparation-v1';
  readonly target:Readonly<TableColumnPatchTarget>;
  /** 保留调用方初次读取的原模式，不能被同一已规范会话的第二次读取覆盖。 */
  readonly base:StructureDefinitionRead;
  readonly references:IndexReferenceNames;
  readonly indexes:IndexStructureRead;
  readonly catalog:Awaited<ReturnType<typeof readTableDefaultEncodingCatalog>>;
  /** 仅证明直接ALTER，不冒充完整外部目录可见性或角色展开证明。 */
  readonly directAlterProven:boolean;
  readonly bytes:number;
  readonly execution:Readonly<{kind:'blocked';reasons:readonly ['table-id-algorithm-unverified','external-dependencies-and-visibility-unverified']}>;
}
export type ColumnCollationReadResult={status:'preparation';facts:ColumnCollationFacts}|{status:'unavailable';reason:'unsupported-version'|'catalog-permission';execution:'blocked'};
const maximumBytes=16*1024*1024;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item instanceof Map?[...item]:item)).digest('hex');

/** 只降级可识别的目录权限不足；取消、断线、认证、未知SQL/预算及资源错误继续上抛。 */
function permissionUnavailable(context:StructureTaskContext,error:unknown):boolean{
  context.checkCancelled();
  if(context.managed.broken||context.managed.signal?.aborted)throw error;
  const detail=error as {errno?:unknown;fatal?:unknown}|null;
  return detail?.fatal!==true&&[1142,1143,1227].includes(detail?.errno as number);
}

/** 同一原会话已经规范模式；仅比较副本适配这一事实，不修改全局unchanged语义或覆盖原快照。 */
function assertNormalizedRead(base:StructureDefinitionRead,read:StructureDefinitionRead):void{
  assertStructureDefinitionUnchanged({...base,originalMode:base.normalizedMode},read);
  if(base.serverVersion!==read.serverVersion||JSON.stringify(base.context)!==JSON.stringify(read.context)||JSON.stringify(base.columnExtras)!==JSON.stringify(read.columnExtras))throw Error('列排序规则原始结构上下文已变化');
}

/** 所有列引用必须覆盖原完整快照；索引引用后续用真实reader产生的稳定映射重读。 */
function assertReferences(base:StructureDefinitionRead,refs:IndexReferenceNames):void{
  const names=base.encodings.map(column=>column.name),values=[...refs.columns.values()];
  if(values.length!==names.length||new Set(values).size!==values.length||names.some(name=>!values.includes(name))||[...refs.columns.keys()].some(ref=>!ref))throw Error('列排序规则稳定列引用未覆盖完整结构');
}

/** 只收集可复用的真实目录准备证据，不提供占位可写入口；调用方须持有读取base的同一规范结构context。 */
export async function readColumnCollationFacts(context:StructureTaskContext,target:TableColumnPatchTarget,base:StructureDefinitionRead,refs:IndexReferenceNames):Promise<ColumnCollationReadResult>{
  context.checkCancelled();
  if(context.managed.status.dialect!=='mysql'||context.managed.status.version!=='8.4.11'||base.context.dialect!=='mysql'||base.serverVersion!=='8.4.11')return{status:'unavailable',reason:'unsupported-version',execution:'blocked'};
  assertReferences(base,refs);
  try{
    const versions=(await structureTaskQuery<{version:string}[]>(context,'SELECT VERSION() AS version')).rows;
    if(versions.length!==1||versions[0].version!=='8.4.11')return{status:'unavailable',reason:'unsupported-version',execution:'blocked'};
    const before=await readIndexStructure(context,target,refs);assertNormalizedRead(base,before);
    const catalog=await readTableDefaultEncodingCatalog(context),directAlterProven=await readTableDefaultEncodingAlter(context,target,base.context);
    // 完整索引/FK再读使用同一组实际引用；不能因为随机ref或外部入向FK变化得到假稳定摘要。
    const references=indexReferenceNames(before),after=await readIndexStructure(context,target,references);assertIndexStructureUnchanged(before,after);
    const finalCatalog=await readTableDefaultEncodingCatalog(context);
    if(catalog.digest!==finalCatalog.digest||hash(catalog.candidates)!==hash(finalCatalog.candidates))throw Error('列排序规则真实候选目录在读取期间变化');
    const final=await readStructureDefinition(context,target,false);assertNormalizedRead(base,final);
    context.checkCancelled();
    const bytes=before.bytes*2+Buffer.byteLength(base.source)*3+catalog.bytes*2+Buffer.byteLength(JSON.stringify([...references.columns,...references.indexes]))*2+32768;
    if(!Number.isSafeInteger(bytes)||bytes>maximumBytes)throw Error('列排序规则私有准备证据超过16 MiB预算');
    const facts:ColumnCollationFacts={kind:'column-collation-preparation-v1',target:{...target},base,references,indexes:before,catalog,directAlterProven,bytes,execution:{kind:'blocked',reasons:['table-id-algorithm-unverified','external-dependencies-and-visibility-unverified']}};
    assertColumnCollationRuntimeFacts(facts);return{status:'preparation',facts};
  }catch(error){if(permissionUnavailable(context,error))return{status:'unavailable',reason:'catalog-permission',execution:'blocked'};throw error;}
}

/** 独立新会话重核仍比较原模式、完整定义、全部稳定索引/FK和候选，不接受客户端布尔代替事实。 */
export function assertColumnCollationUnchanged(before:ColumnCollationFacts,after:ColumnCollationFacts):void{
  assertColumnCollationRuntimeFacts(before);assertColumnCollationRuntimeFacts(after);
  assertStructureDefinitionUnchanged(before.base,after.base);
  assertIndexStructureUnchanged(before.indexes,after.indexes);
  if(hash([before.target,before.references,before.catalog,before.directAlterProven,before.execution,before.base.serverVersion,before.base.context,before.base.columnExtras])!==hash([after.target,after.references,after.catalog,after.directAlterProven,after.execution,after.base.serverVersion,after.base.context,after.base.columnExtras]))throw Error('列排序规则候选、权限或稳定引用已变化；未发送DDL');
  assertColumnCollationRuntimeFacts(before);assertColumnCollationRuntimeFacts(after);
}
