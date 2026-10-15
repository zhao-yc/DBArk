import{parentPort}from'node:worker_threads';
import{compileSavedQueryPattern,matchSavedQueryRecord}from'./savedQuerySearchMatch';
let compiled:ReturnType<typeof compileSavedQueryPattern>|undefined;
/** 单线程只接收初始化或单条记录，复杂正则可由主进程定时终止，不接触连接凭据与文件。 */
parentPort!.on('message',(message:{kind:'initialize';input:unknown}|{kind:'record';id:string;raw:string})=>{try{if(message.kind==='initialize'){compiled=compileSavedQueryPattern(message.input as never);parentPort!.postMessage({ok:true});}else{if(!compiled)throw Error('本地匹配器尚未初始化');parentPort!.postMessage({ok:true,hit:matchSavedQueryRecord(message.id,message.raw,compiled)});}}catch(error){parentPort!.postMessage({ok:false,error:error instanceof Error?error.message:'保存查询匹配失败'});}});
