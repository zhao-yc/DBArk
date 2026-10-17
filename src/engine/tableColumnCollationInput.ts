import {types} from 'node:util';
import {validateTableEncodingPair,type TableEncodingPair} from '../shared/tableDefaultEncoding';
import {tableColumnPatchLimits} from '../shared/tableColumnPatches';

const blockedReasons=Object.freeze(['table-id-algorithm-unverified','external-dependencies-and-visibility-unverified'] as const);
/** 阻断原因由本核心持有，输出独立副本，不从可变facts转发授权或丢失的原因。 */
export function columnCollationBlockedReasons():string[]{return[...blockedReasons];}

/** 先拒绝Proxy，再检查普通对象；反射之前不读取调用方属性或触发访问器。 */
function record(value:unknown):object{
  if(!value||typeof value!=='object'||types.isProxy(value))throw Error('列排序规则只接受普通数据对象');
  const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)throw Error('列排序规则不接受自定义原型');return value;
}
/** 必须是自有、可枚举数据字段；缺失与getter/setter不属于已知证据。 */
function data(value:unknown,key:string):unknown{
  const descriptor=Object.getOwnPropertyDescriptor(record(value),key);
  if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))throw Error('列排序规则证据字段缺失或不是数据属性');return descriptor.value;
}

/** 下一配对恰为两个有界字符串；原对象的getter、toJSON、额外字段和Proxy都不会执行。 */
export function copyColumnCollationPair(input:unknown):TableEncodingPair{
  const value=record(input),keys=Reflect.ownKeys(value);
  if(keys.length!==2||!keys.includes('charset')||!keys.includes('collation'))throw Error('列排序规则配对只接受charset和collation');
  const charset=data(value,'charset'),collation=data(value,'collation');
  if(typeof charset!=='string'||typeof collation!=='string'||charset.length>64||collation.length>255)throw Error('列排序规则配对名称无效');
  return validateTableEncodingPair({charset,collation});
}

/** v1准备事实必须保留固定blocked门；未知枚举、缺失/额外原因或访问器一律拒绝。 */
export function assertColumnCollationExecution(value:unknown):void{
  const gate=data(value,'execution'),keys=Reflect.ownKeys(record(gate));
  if(keys.length!==2||!keys.includes('kind')||!keys.includes('reasons')||data(gate,'kind')!=='blocked')throw Error('列排序规则执行门不是固定阻断状态');
  const reasons=data(gate,'reasons');
  if(!reasons||typeof reasons!=='object'||types.isProxy(reasons)||!Array.isArray(reasons)||Object.getPrototypeOf(reasons)!==Array.prototype)throw Error('列排序规则阻断原因必须完整保留');
  const length=Object.getOwnPropertyDescriptor(reasons,'length')?.value;
  if(length!==2||Reflect.ownKeys(reasons).length!==3)throw Error('列排序规则阻断原因不完整');
  for(let index=0;index<2;index++){const item=Object.getOwnPropertyDescriptor(reasons,String(index));if(!item?.enumerable||!Object.hasOwn(item,'value')||item.value!==blockedReasons[index])throw Error('列排序规则强制阻断原因不符');}
}

/** TS类型不替代运行时证据：权限/出向完整性只接受布尔，所有可信列标记必须明确存在。 */
export function assertColumnCollationRuntimeFacts(value:unknown):void{
  if(data(value,'kind')!=='column-collation-preparation-v1')throw Error('列排序规则准备事实版本未知');
  assertColumnCollationExecution(value);
  if(typeof data(value,'directAlterProven')!=='boolean')throw Error('列排序规则直接ALTER证明必须是布尔');
  const model=data(data(value,'indexes'),'model'),dependencies=data(model,'dependencies');
  if(typeof data(dependencies,'outgoingComplete')!=='boolean')throw Error('列排序规则出向依赖完整性必须是布尔');
  const columns=data(model,'columns');
  if(!columns||typeof columns!=='object'||types.isProxy(columns)||!types.isMap(columns))throw Error('列排序规则可信列目录必须是原生Map');
  const size=Object.getOwnPropertyDescriptor(Map.prototype,'size')!.get!.call(columns);
  if(size<1||size>tableColumnPatchLimits.columns)throw Error('列排序规则可信列目录数量超出预算');
  for(const column of Map.prototype.values.call(columns))for(const flag of ['generated','hidden','nullable'])if(typeof data(column,flag)!=='boolean')throw Error('列排序规则可信列标记必须明确为布尔');
}
