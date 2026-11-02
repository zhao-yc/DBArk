import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TableValueOptionsDialog,type TableValueOptionsServices} from '../../../src/renderer/components/TableValueOptionsDialog';
import type {TableInfo} from '../../../src/shared/contracts';
import type {TableValueOptionsInput} from '../../../src/shared/tableValueOptions';
import type {TableValueOptionsConditions} from '../../../src/renderer/tableValueOptionsUi';
import {tableValueOptionsZh as text} from '../../../src/renderer/locales/tableValueOptions.zh-CN';
import '../../../src/renderer/styles.css';

const source:TableInfo={database:'合成统计库',name:'subject',objectKind:'table',engine:'InnoDB',ddl:'CREATE TABLE subject(status VARCHAR(64))',columns:[{name:'status',type:'VARCHAR(64)',nullable:true,defaultValue:null,generated:false,extra:'',comment:''}],indexes:[],foreignKeys:[],primaryKey:[],editableKey:[]};
const target={connectionId:'offline-frequency',database:source.database,table:source.name},conditions:TableValueOptionsConditions={filters:[{column:'status',operator:'!=',value:'old',enabled:false}],filterMode:'all'};
const reads:TableValueOptionsInput[]=[],proposals:TableValueOptionsConditions[]=[],denied:string[]=[],cleanup:string[]=[];let activity=0;
const originalDraft=Object.freeze({value:'DO_NOT_CHANGE_LOCAL_DRAFT'}), originalConditions=JSON.stringify(conditions);
Object.defineProperty(window,'dbark',{value:{invoke:async(command:string)=>{denied.push(command);throw Error('组件专项不提供真实IPC');}}});
/** 仅数据库输入为合成端口；真实Dialog、排序身份校验、确认、筛选合并和父目标守卫全部运行。 */
const services:TableValueOptionsServices={read:async input=>{
  if(input.connectionId!==target.connectionId||input.database!==source.database||input.table!==source.name||input.column!=='status'||input.searchPattern||JSON.stringify(input.filters)!==JSON.stringify(conditions.filters))throw Error('组件来源变化');
  reads.push(structuredClone(input));
  const values=[{value:null,count:'2'},{value:'a_rare',count:'1'},{value:'m_warm',count:'9'},{value:'z_hot',count:'100'}];
  if(input.order&&input.order!=='value')values.sort((left,right)=>(BigInt(left.count)<BigInt(right.count)?-1:1)*(input.order==='count-asc'?1:-1));
  return{source:structuredClone(source),sourceDigest:'a'.repeat(64),column:'status',...(input.order===undefined?{}:{order:input.order}),values,truncated:false,warnings:['本例为合成服务，真实后端另行验收。']};
},cancel:async()=>{throw Error('本例没有取消场景');}};
/** 只读审计端口；测试不能通过它设置模型、调用业务或改写返回结果。 */
Object.defineProperty(window,'__valueFrequencyEvidence',{value:()=>structuredClone({reads,proposals,denied,cleanup,activity,draft:originalDraft,conditionsUnchanged:JSON.stringify(conditions)===originalConditions})});
/** 宿主只提供打开、主题及明确接纳筛选的入口，不替代Dialog内部任何动作。 */
function Fixture(){const[open,setOpen]=useState(false),[light,setLight]=useState(false);return <main style={{padding:24}}><h1>服务器不同值次数排序</h1><button onClick={()=>setOpen(true)}>{text.open}</button><button onClick={()=>{setLight(!light);document.documentElement.dataset.theme=light?'dark':'light';}}>切换主题</button>{open&&<TableValueOptionsDialog target={target} source={source} column="status" conditions={conditions} services={services} isCurrent={()=>JSON.stringify(conditions)===originalConditions} onApply={value=>{proposals.push(structuredClone(value));return true;}} onClose={()=>setOpen(false)} onCleanupError={value=>cleanup.push(value)} onActivity={delta=>{activity+=delta;}}/>}</main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
