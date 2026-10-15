import type {AppSettings} from '../shared/contracts';
import type {ConnectionSelection} from './connectionChanges';

/** 搜索优先采用活动标签的真实默认库；无库和未知状态不能借用旧树节点或配置库。 */
export function structureSearchContext(selection:ConnectionSelection|undefined,active:AppSettings['tabs'][number]|undefined,firstConnectionId:string):ConnectionSelection{
  if(active){
    if(active.kind==='table')return{connectionId:active.connectionId,database:active.database};
    const context=active.databaseContext;
    if(context?.state==='unknown')return{connectionId:active.connectionId};
    if(context?.state==='known')return{connectionId:active.connectionId,database:context.database??undefined};
    return{connectionId:active.connectionId,database:active.database};
  }
  return selection?{connectionId:selection.connectionId,database:selection.database}:{connectionId:firstConnectionId};
}
