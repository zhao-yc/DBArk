import type { SqliteTableDraftDocument, SqliteDraftRestored } from '../../src/shared/sqliteTableDraft';
import { sqliteDraftChanges } from '../../src/shared/sqliteTableDraft';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
/** 纯RAM两组typed旧值，不代替实际worker核验；每组独享准确新snapshot和row0。 */
export function sqliteDraftWorkspaceFixture() {
  const columns = [{ name:'id',declaredType:'INTEGER',generated:false,nullable:false,hasDefault:false },{name:'note',declaredType:'TEXT',generated:false,nullable:true,hasDefault:true}];
  const document: SqliteTableDraftDocument = { kind:'tabrelio.sqlite-table-draft',version:2,endpointKey:'a'.repeat(64),target:{connectionId:'c',database:'main',table:'subject'},fileKey:'b'.repeat(64),schemaKey:'c'.repeat(64),schemaVersion:'1',columns,locator:{kind:'rowid',rowid:'rowid',columns:[],collations:['BINARY']},changes:[
    {kind:'update',before:[{kind:'integer',value:'9223372036854775807'},{kind:'text',value:'原一\0🚢'}],key:[{kind:'integer',value:'1'}],values:[{column:'note',value:{kind:'text',value:'第一组新值'}}]},
    {kind:'update',before:[{kind:'integer',value:'2'},{kind:'text',value:'原二'}],key:[{kind:'integer',value:'2'}],values:[{column:'note',value:{kind:'text',value:'第二组新值'}}]},
  ],workspace:{activeOffset:20,pages:[{offset:0,limit:10,changes:1},{offset:20,limit:10,changes:1}]}};
  function group(index:number) {
    const change=document.changes[index];if(change.kind==='insert')throw Error('夹具需要完整旧行');
    const page:SqliteTablePage={target:{...document.target,kind:'table'},schemaKey:document.schemaKey,columns,offset:index===0?0:20,limit:10,hasMore:false,storageTypes:['it'],edit:{kind:'editable',snapshotId:'new-'+index,expiresAt:new Date(Date.now()+600000).toISOString(),columns,rows:[structuredClone(change.before)],locator:{kind:'rowid',columns:[]}},result:{columns:columns.map((c,i)=>({key:'c'+i,name:c.name,type:'SQLITE'})),rows:[{c0:index===0?'9223372036854775807':'2',c1:index===0?'原一\0🚢':'原二'}],elapsedMs:0,truncated:false,statement:''}};
    return{page,changes:sqliteDraftChanges({...document,changes:[change]})};
  }
  const value:SqliteDraftRestored={...group(1),additionalPages:[group(0)]};return{document,value};
}
