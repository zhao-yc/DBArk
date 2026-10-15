import{parentPort}from'node:worker_threads';
import{compileSavedQueryPattern,matchSavedQueryRecord,summarizeSavedQueryRecord}from'./savedQuerySearchMatch';
let compiled:ReturnType<typeof compileSavedQueryPattern>|undefined;
/** 单线程只接收初始化、单条匹配或概要，复杂计算可由主进程终止，不接触连接凭据与文件。 */
parentPort!.on('message',(message:{kind:'initialize';input:unknown}|{kind:'record';id:string;raw:string}|{kind:'summary';id:string;raw:string;search:string})=>{try{if(message.kind==='initialize'){compiled=compileSavedQueryPattern(message.input as never);parentPort!.postMessage({ok:true});}else if(message.kind==='summary'){parentPort!.postMessage({ok:true,summary:summarizeSavedQueryRecord(message.id,message.raw,message.search)});}else{if(!compiled)throw Error('本地匹配器尚未初始化');parentPort!.postMessage({ok:true,hit:matchSavedQueryRecord(message.id,message.raw,compiled)});}}catch(error){parentPort!.postMessage({ok:false,error:error instanceof Error?error.message:'保存查询匹配失败'});}});
