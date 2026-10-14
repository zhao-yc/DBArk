import type {FieldPacket} from 'mysql2';
import {execute,type ManagedConnection} from './connection';
import type {StructureTaskContext} from './structureDefinition';
/** 元数据取消必须等待真实回调或连接终态，不能将普通execute的早期Abort拒绝当作服务器结束。 */
export function completionQuery<T>(managed:ManagedConnection,control:Pick<StructureTaskContext,'checkCancelled'|'commandStarted'>,sql:string,values:(string|number)[]):Promise<{rows:T;fields:FieldPacket[]}>{
  control.checkCancelled();if(managed.signal?.aborted)return Promise.reject(Error('补全元数据读取已取消'));
  return new Promise((resolve,reject)=>{
    const terminal=control.commandStarted();let settled=false;
    /** 仅第一个实际终态释放命令编号，晚到回调不会再次结束或返回目录。 */
    function finish(error:unknown,value?:{rows:T;fields:FieldPacket[]}){if(settled)return;settled=true;managed.connection.removeListener('error',failed);managed.connection.removeListener('end',ended);managed.signal?.removeEventListener('abort',aborted);terminal();error?reject(error):resolve(value!);}
    function failed(error:Error){finish(error);}
    function ended(){finish(Error('补全元数据连接在读取完成前断开'));}
    function aborted(){finish(Error('补全元数据连接已在取消收尾阶段终止'));}
    managed.connection.once('error',failed);managed.connection.once('end',ended);managed.signal?.addEventListener('abort',aborted,{once:true});
    // 任务控制器在KILL与命令回调结束后才abort；控制失败的本地abort仍会保留失败结果。
    // 仅屏蔽execute自身提前拒绝，继续使用真实同一驱动连接和预处理协议。
    const callbackManaged=managed.signal?{...managed,signal:undefined}:managed;
    try{void execute<T>(callbackManaged,sql,values).then(value=>finish(null,value),error=>finish(error));}catch(error){finish(error);}
  });
}
