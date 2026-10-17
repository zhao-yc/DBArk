import {createHash} from 'node:crypto';
import {structureDocumentOf,sameStructureFragment} from './structureDefinition';
import {parseTableColumnDefinition,tableDefinitionTokens} from './tableColumnDefinition';
import {readTableDefaultEncodingDefinition,tableDefaultEncodingColumnReasons} from './tableDefaultEncodingSql';
import {tableCommentHasEngineOptions} from '../shared/tableComment';
import {validateTableEncodingPair,sameTableEncodingPair,type TableEncodingPair} from '../shared/tableDefaultEncoding';
import type {TableColumnDefinition,TableColumnDefinitionDocument,DefinitionRange} from '../shared/tableColumnPatches';
import type {ColumnCollationFacts} from './tableColumnCollationRead';

/** 纯范围候选不包含可执行ALTER；Root补齐物理身份/算法/外部可见性后才可由既有Tasks组装执行计划。 */
export interface ColumnCollationDefinitionPlan {
  readonly kind:'candidate-only';readonly columnRef:string;readonly columnName:string;
  readonly before:TableEncodingPair;readonly next:TableEncodingPair;
  readonly definition:string;readonly edit:Readonly<{range:DefinitionRange;value:string}>;
  readonly originalDigest:string;
  readonly preserved:Readonly<{columns:readonly string[];constraints:readonly string[];head:string;tail:string}>;
  readonly execution:'blocked';
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** 源码、稳定引用和实际目录必须指向同一目标；本方法不把私有准备facts当写入授权。 */
function documentOf(facts:ColumnCollationFacts):TableColumnDefinitionDocument{
  if(facts.kind!=='column-collation-preparation-v1'||facts.base.context.dialect!=='mysql'||facts.base.serverVersion!=='8.4.11'||facts.base.source!==facts.indexes.source||facts.indexes.model.definition.source!==facts.base.source)throw Error('列排序规则准备快照不一致');
  const raw=parseTableColumnDefinition(facts.base.source,facts.base.context),document=structureDocumentOf(facts.base);
  if(document.table!==facts.target.table||document.database!==undefined&&document.database!==facts.target.database||!facts.base.columnExtras||facts.base.columnExtras.length!==document.columns.length)throw Error('列排序规则目标或EXTRA目录不完整');
  if(facts.base.encodings.length!==raw.columns.length||facts.base.nullability.length!==raw.columns.length||raw.columns.some((column,index)=>facts.base.encodings[index].name!==column.name||facts.base.nullability[index][0]!==column.name||facts.base.columnExtras![index][0]!==column.name||column.nullable!==undefined&&column.nullable!==facts.base.nullability[index][1]))throw Error('列排序规则原定义与列目录顺序或可空性不一致');
  return document;
}

/** 候选名称只按真实完整目录的唯一配对判断，不用排序规则前缀猜字符集。 */
function pairInCatalog(facts:ColumnCollationFacts,pair:TableEncodingPair):TableEncodingPair{
  const next=validateTableEncodingPair(pair),catalog=facts.catalog;
  if(!catalog.candidates.length||catalog.candidates.length>8192||catalog.bytes>2*1024*1024||catalog.warnings.length||catalog.digest!==digest([catalog.candidates,catalog.warnings]))throw Error('列排序规则真实候选不完整或摘要不一致');
  const matches=catalog.candidates.filter(candidate=>candidate.collation===next.collation);
  if(matches.length!==1||!sameTableEncodingPair(matches[0],next))throw Error('排序规则不是实际目录唯一配对');return next;
}

/** 验证已读取的列/索引/FK范围；外部依赖与TABLE_ID/算法仍由固定execution阻断门另行保留。 */
function columnOf(facts:ColumnCollationFacts,document:TableColumnDefinitionDocument,columnRef:string):{column:TableColumnDefinition;pair:TableEncodingPair}{
  const name=facts.references.columns.get(columnRef),column=name?document.columnsByName.get(name):undefined,trusted=facts.indexes.model.columns.get(columnRef),deps=facts.indexes.model.dependencies;
  if(!column||!trusted||trusted.name!==column.name||trusted.nullable!==column.nullable||[...facts.references.columns.values()].filter(value=>value===name).length!==1)throw Error('目标稳定列引用或可空目录不明确');
  if(!/^[A-Za-z0-9_]+$/.test(facts.target.database)||!/^[A-Za-z0-9_]+$/.test(facts.target.table)||facts.indexes.options?.engine!=='InnoDB'||!facts.directAlterProven)throw Error('当前目标引擎、名称或直接ALTER权限未证明');
  if(deps.incomingCoverage.kind!=='complete'||!deps.outgoingComplete||deps.partition.kind!=='none'||deps.hiddenDependencies.length)throw Error('索引/FK/隐藏或分区依赖目录不完整');
  if(deps.foreignKeys.some(key=>key.targetColumnRefs.includes(columnRef)))throw Error('目标列涉及入向或出向外键');
  for(const index of facts.indexes.model.indexes.values()){
    if(index.generated!==false||!index.definition||index.parsed.opaqueReasons.length||index.parsed.parts.some(part=>part.expressionSql!==undefined||part.opaqueReasons.length))throw Error('整表存在未知或表达式索引');
    if(index.definition.keyParts.some(part=>part.columnRef===columnRef))throw Error('目标列涉及索引');
  }
  if(readTableDefaultEncodingDefinition(document.source,document.context).reasons.length||tableDefaultEncodingColumnReasons(facts.base).length||tableDefinitionTokens(document.source,document.context).some(token=>token.kind==='executable'))throw Error('表定义含未知尾部、编码或可执行片段');
  for(const item of document.items){
    if(item.kind==='constraint'&&tableDefinitionTokens(item.raw,document.context).some(token=>token.kind==='word'&&token.value.toUpperCase()==='CHECK'))throw Error('整表CHECK依赖尚不支持');
    if(item.kind==='column'&&(item.attributes.some(attribute=>['generated','check','opaque'].includes(attribute.kind))||['expression','opaque'].includes(item.default.kind)||item.default.kind==='literal'&&item.default.introducer!==undefined))throw Error('整表生成或默认表达式依赖尚不支持');
  }
  const tail=tableDefinitionTokens(document.tail.raw,document.context);
  if(tail.some((token,index)=>token.kind==='word'&&token.value.toUpperCase()==='COMMENT'&&tableCommentHasEngineOptions(tail[index+1]?.value==='='?tail[index+2]?.value??'':tail[index+1]?.value??'')))throw Error('表注释含引擎物理参数');
  const type=/^(CHAR|VARCHAR)\s*\(\s*([1-9]\d{0,4})\s*\)$/i.exec(column.type.raw),length=Number(type?.[2]);
  if(!type||length>(type[1].toUpperCase()==='CHAR'?255:65535)||trusted.dataType.toUpperCase()!==type[1].toUpperCase()||trusted.characterMaxLength!==String(length)||!sameStructureFragment(trusted.columnType,column.type.raw,document.context)||trusted.generated||trusted.hidden||facts.base.columnExtras!.some(([key,extra])=>key===column.name&&extra!=='')||column.attributes.some(attribute=>!['nullable','default','comment','charset','collation'].includes(attribute.kind)))throw Error('目标只支持目录一致的普通CHAR/VARCHAR');
  if(!['none','null'].includes(column.default.kind)&&!(column.default.kind==='literal'&&column.default.valueType==='text'&&column.default.introducer===undefined))throw Error('目标默认值不属于普通文本范围');
  const encodings=facts.base.encodings.filter(item=>item.name===column.name),encoding=encodings[0];
  if(encodings.length!==1||!encoding.charset||!encoding.collation||trusted.charset!==encoding.charset||trusted.collation!==encoding.collation)throw Error('目标有效编码不能交叉证明');
  return{column,pair:pairInCatalog(facts,{charset:encoding.charset,collation:encoding.collation})};
}

/** 按解析器确认的范围移除目标编码，仅用于专用后核；旁列绝不使用此豁免。 */
function withoutEncoding(column:TableColumnDefinition):string{
  let raw=column.raw;for(const attribute of column.attributes.filter(item=>['charset','collation'].includes(item.kind)).sort((a,b)=>b.range.start-a.range.start))raw=raw.slice(0,attribute.range.start-column.range.start)+' '+raw.slice(attribute.range.end-column.range.start);return raw;
}

/** 后核索引忽略因目标片段长度变化产生的绝对偏移，完整索引词法、引用及能力仍逐项相同。 */
function indexEvidence(facts:ColumnCollationFacts):unknown{
  return[...facts.indexes.model.indexes].map(([ref,index])=>[ref,index.definition,index.visible,index.generated,tableDefinitionTokens(index.parsed.rawSql,facts.base.context).map(token=>[token.kind,token.kind==='word'?token.value.toUpperCase():token.value])]);
}

/** 只改独立COLLATE范围或在CHARSET/type后插入；保留原NULL/default/comment、旁列、约束及整个表尾。 */
export function buildColumnCollationDefinition(facts:ColumnCollationFacts,columnRef:string,nextPair:TableEncodingPair):ColumnCollationDefinitionPlan{
  const document=documentOf(facts),{column,pair}=columnOf(facts,document,columnRef),next=pairInCatalog(facts,nextPair);
  if(pair.charset!==next.charset)throw Error('首片不支持跨字符集修改');if(sameTableEncodingPair(pair,next))throw Error('列排序规则没有变化');
  const existing=column.attributes.find(attribute=>attribute.kind==='collation'),anchor=column.attributes.find(attribute=>attribute.kind==='charset')?.range.end??column.type.range.end;
  const range=existing?{...existing.range}:{start:anchor,end:anchor},value=(existing?'':' ')+'COLLATE '+next.collation;
  const definition=column.raw.slice(0,range.start-column.range.start)+value+column.raw.slice(range.end-column.range.start);
  const modified=document.source.slice(0,column.range.start)+definition+document.source.slice(column.range.end),parsed=parseTableColumnDefinition(modified,document.context),changed=parsed.columns[column.ordinal];
  if(parsed.columns.length!==document.columns.length||changed.name!==column.name||!sameStructureFragment(withoutEncoding(column),withoutEncoding(changed),document.context))throw Error('候选范围改变了目标的非编码定义');
  return{kind:'candidate-only',columnRef,columnName:column.name,before:pair,next,definition,edit:{range,value},originalDigest:digest([facts.target,facts.base,facts.catalog.digest]),preserved:{columns:document.columns.filter(item=>item!==column).map(item=>item.raw),constraints:document.items.filter(item=>item.kind==='constraint').map(item=>item.raw),head:document.head.raw,tail:document.tail.raw},execution:'blocked'};
}

/** 专用后核只报告词法/目录范围匹配；物理ID、算法、外部依赖未证时绝不返回definitionVerified=true。 */
export function verifyColumnCollationChange(before:ColumnCollationFacts,after:ColumnCollationFacts,plan:ColumnCollationDefinitionPlan):{definitionVerified:false;structuralMatch:boolean;reasons:string[]}{
  try{
    const old=documentOf(before),now=documentOf(after),expected=buildColumnCollationDefinition(before,plan.columnRef,plan.next);
    if(JSON.stringify(expected)!==JSON.stringify(plan))throw Error('计划与原快照不一致');
    const oldTarget=old.columnsByName.get(plan.columnName)!,target=now.columnsByName.get(plan.columnName);
    if(!target||before.base.identity!==after.base.identity||before.base.normalizedMode!==after.base.originalMode||after.base.normalizedMode!==before.base.normalizedMode||JSON.stringify(before.target)!==JSON.stringify(after.target)||JSON.stringify(old.context)!==JSON.stringify(now.context)||JSON.stringify(before.base.tableEncoding)!==JSON.stringify(after.base.tableEncoding)||JSON.stringify(before.base.nullability)!==JSON.stringify(after.base.nullability)||JSON.stringify(before.base.columnExtras)!==JSON.stringify(after.base.columnExtras)||JSON.stringify(old.columns.map(item=>item.name))!==JSON.stringify(now.columns.map(item=>item.name)))throw Error('后核身份、模式或列目录变化');
    for(const column of old.columns){const current=now.columnsByName.get(column.name)!;if(!sameStructureFragment(column===oldTarget?withoutEncoding(column):column.raw,column===oldTarget?withoutEncoding(current):current.raw,old.context))throw Error('后核目标其它属性或旁列变化');}
    const encodings=after.base.encodings.map(item=>item.name===plan.columnName?{...item,charset:plan.before.charset,collation:plan.before.collation}:item);
    const effective=after.base.encodings.find(item=>item.name===plan.columnName);if(effective?.charset!==plan.before.charset||effective.collation!==plan.next.collation||JSON.stringify(encodings)!==JSON.stringify(before.base.encodings))throw Error('后核有效编码或旁列编码不符');
    pairInCatalog(after,plan.next);
    const trusted=[...after.indexes.model.columns].map(([ref,column])=>[ref,ref===plan.columnRef?{...column,collation:plan.before.collation}:column]);
    if(tableDefaultEncodingColumnReasons(after.base).length||!after.directAlterProven||JSON.stringify([...before.indexes.model.columns])!==JSON.stringify(trusted)||JSON.stringify(before.indexes.options)!==JSON.stringify(after.indexes.options)||JSON.stringify([...before.references.columns,...before.references.indexes])!==JSON.stringify([...after.references.columns,...after.references.indexes]))throw Error('后核可信列、权限或稳定引用变化');
    if(!sameStructureFragment(old.head.raw,now.head.raw,old.context)||!sameStructureFragment(old.tail.raw,now.tail.raw,old.context)||!sameStructureFragment(plan.preserved.constraints.join(','),now.items.filter(item=>item.kind==='constraint').map(item=>item.raw).join(','),old.context)||before.catalog.digest!==after.catalog.digest||before.indexes.dependencyDigest!==after.indexes.dependencyDigest||JSON.stringify(indexEvidence(before))!==JSON.stringify(indexEvidence(after))||JSON.stringify(before.indexes.model.dependencies)!==JSON.stringify(after.indexes.model.dependencies))throw Error('后核表尾、约束、索引或依赖变化');
    return{definitionVerified:false,structuralMatch:true,reasons:[...after.execution.reasons]};
  }catch{return{definitionVerified:false,structuralMatch:false,reasons:['结构范围后核未通过','table-id-algorithm-unverified','external-dependencies-and-visibility-unverified']};}
}
