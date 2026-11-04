import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteTableEditLimits, type SqliteTableEditPreviewInput, type SqliteTableEditOutcome } from '../shared/sqliteTableEdit';
import type { SqliteTableQuery } from './sqliteTableBrowser';
import type { SqliteTableEditor } from './sqliteTableEditor';
import { sqliteEditWorkspaceZh as text } from './locales/sqliteEditWorkspace.zh-CN';
export interface SqliteEditBatch { input: Omit<SqliteTableEditPreviewInput, 'taskId'>; current(): boolean; }
interface Entry { editor: SqliteTableEditor; page: SqliteTablePage; key: string; signature: string; }
interface Ports { now(): number; changed(): void; forgotten(page: SqliteTablePage): void; }
/** 同一已应用查询的有界原页账本；不接管数据库任务，不用页行号跨快照查找记录。 */
export class SqliteEditWorkspace {
  private entries = new Map<string, Entry>();
  private query?: SqliteTableQuery; private queryKey = ''; private scopeKey = ''; private dead = false;
  private selected?: SqliteTableEditor;
  unknown = false;
  constructor(private readonly ports: Ports) {}
  private key(page: Pick<SqliteTablePage, 'offset' | 'limit'>): string { return page.offset + ':' + page.limit; }
  /** 只比目标和编辑元数据；原行大值仍由各准确Editor持有，不为切页序列化大BLOB。 */
  private signature(page: SqliteTablePage): string { const edit = page.edit; return JSON.stringify([page.target, page.schemaKey, page.offset, page.limit, page.columns, page.relation ?? null, edit?.kind === 'editable' ? [edit.snapshotId,edit.expiresAt,edit.columns,edit.locator] : null]); }
  private scope(page: SqliteTablePage): string { const edit=page.edit;return JSON.stringify([page.target,page.schemaKey,page.columns,page.relation??null,edit?.kind==='editable'?[edit.columns,edit.locator]:null]); }
  /** 查询对象和实际内容都固定；观察漂移后相同对象恢复也不能复活旧账本。 */
  current(query = this.query): boolean {
    if(this.dead)return false;
    try { if(this.query && (query!==this.query||JSON.stringify(query)!==this.queryKey))this.dead=true;for(const entry of this.entries.values())if(entry.editor.page!==entry.page||this.signature(entry.page)!==entry.signature)this.dead=true; } catch {this.dead=true;}
    return !this.dead;
  }
  get pages(): readonly SqliteTableEditor[] { return [...this.entries.values()].map(entry=>entry.editor); }
  has(editor: SqliteTableEditor): boolean { return [...this.entries.values()].some(entry=>entry.editor===editor); }
  isActive(editor: SqliteTableEditor): boolean { return this.selected===editor&&this.has(editor); }
  get dirty(): boolean { return this.unknown||this.pages.some(editor=>editor.dirty); }
  get protected(): boolean { return this.dirty||this.pages.some(editor=>editor.view.undo||editor.view.redo); }
  get busy(): boolean { return this.pages.some(editor=>editor.busy); }
  get changes(): number { return this.pages.reduce((sum,editor)=>sum+editor.changes.length,0); }
  /** 只淘汰离开后无需保留的干净页，不丢输入、修改或撤销／重做历史，不静默丢弃用户历史。 */
  private disposable(entry: Entry): boolean { const view=entry.editor.view;return !entry.editor.dirty&&!entry.editor.busy&&!view.undo&&!view.redo; }
  capacity(query: SqliteTableQuery, leaving?: SqliteTableEditor): void { if(!this.current(query)||this.unknown)throw Error(this.unknown?text.unknown:text.stale);if(this.entries.size>=sqliteTableEditLimits.pages&&![...this.entries.values()].some(entry=>this.disposable(entry)||entry.editor===leaving&&!entry.editor.changes.length&&!entry.editor.busy&&!entry.editor.view.undo&&!entry.editor.view.redo&&!entry.editor.view.unknown))throw Error(text.limit); }
  /** 已采用页只在元数据相容时登记；后端保有真实文件与schema_version的最终裁决。 */
  add(editor: SqliteTableEditor,query: SqliteTableQuery): void {
    const page=editor.page;if(page.edit?.kind!=='editable'||!this.current(this.query?query:undefined)||this.unknown||this.entries.has(this.key(page)))throw Error(text.stale);
    const scope=this.scope(page);if(this.query&&(query!==this.query||scope!==this.scopeKey))throw Error(text.stale);
    if(this.entries.size>=sqliteTableEditLimits.pages){const unused=[...this.entries.values()].find(entry=>this.disposable(entry));if(!unused)throw Error(text.limit);this.entries.delete(unused.key);unused.editor.dispose();this.ports.forgotten(unused.page);}
    if(!this.query){this.query=query;this.queryKey=JSON.stringify(query);this.scopeKey=scope;}
    this.entries.set(this.key(page),{editor,page,key:this.key(page),signature:this.signature(page)});this.select(editor);
  }
  /** 返回准确缓存页，不按相同offset重新生成Editor或原值；失效页明确拒绝重新编辑。 */
  cached(offset:number,query:SqliteTableQuery):SqliteTableEditor|undefined {if(!this.current(query)||this.unknown)throw Error(this.unknown?text.unknown:text.stale);const editor=this.entries.get(offset+':'+query.limit)?.editor;if(editor){editor.observe();if(!editor.view.valid||editor.view.unknown)throw Error(text.stale);}return editor;}
  select(editor:SqliteTableEditor):void{if(!this.has(editor))throw Error(text.stale);this.selected=editor;this.ports.changed();}
  /** 逐页观察连接／结构墓碑，后台页变化也更新标签dirty与预览资格。 */
  observe():void{this.current();for(const editor of this.pages)editor.observe();}
  /** 聚合全部dirty页；每条原row仍属自己的snapshot，旧回包须核准确页集合和各页rows数组。 */
  batch(actor:SqliteTableEditor):SqliteEditBatch|undefined {
    this.observe();if(!this.isActive(actor)||!this.current()||this.unknown||this.pages.some(editor=>editor.hasInput||editor.busy||(editor===actor||editor.changes.length>0)&&(!editor.view.valid||editor.view.unknown)))throw Error(text.stale);
    const captured=this.pages.map(editor=>({editor,rows:editor.view.rows,signature:this.signature(editor.page),required:editor===actor||editor.changes.length>0})),groups=captured.filter(item=>item.editor.changes.length).map(item=>({snapshotId:item.editor.page.edit!.kind==='editable'?item.editor.page.edit!.snapshotId:'',changes:item.editor.changes}));
    if(!groups.length)return;
    const [primary,...additionalPages]=groups;
    return{input:{...primary,...(additionalPages.length?{additionalPages}:{})},current:()=>this.current()&&!this.unknown&&this.isActive(actor)&&captured.length===this.entries.size&&captured.every(item=>this.has(item.editor)&&(!item.required||item.editor.view.valid&&!item.editor.view.unknown)&&item.editor.view.rows===item.rows&&this.signature(item.editor.page)===item.signature&&(!item.required||item.editor.page.edit?.kind==='editable'&&this.ports.now()<Date.parse(item.editor.page.edit.expiresAt)))};
  }
  /** 任何已发送未知结果锁住全组，不能切换到另一页重试相同草稿。 */
  settled(actor:SqliteTableEditor,outcome:SqliteTableEditOutcome['outcome']):void{if(this.has(actor)&&outcome==='unknown'){this.unknown=true;this.ports.changed();}}
  /** 明确放弃一个准确原页；输入、预览或在途事务存在时不允许拆组，未知结果不能借移页解锁。 */
  discardPage(editor: SqliteTableEditor): boolean {
    const entry = [...this.entries.values()].find(item => item.editor === editor);
    if (!entry || this.unknown || this.pages.some(item => item.busy || item.hasInput || item.view.preview || item.view.unknown)) return false;
    this.entries.delete(entry.key);
    if (this.selected === editor) this.selected = undefined;
    editor.dispose(); this.ports.forgotten(entry.page);
    // 最后一页明确放弃后允许建立全新来源；有剩余页时保持旧账本及失效墓碑。
    if (!this.entries.size) { this.query = undefined; this.queryKey = ''; this.scopeKey = ''; this.dead = false; }
    this.ports.changed(); return true;
  }
  /** 明确放弃／成功提交／卸载才释放所有已采用页，各Editor自行等待准确在途终态。 */
  clear(notify=true):void{const entries=[...this.entries.values()];this.entries.clear();this.selected=undefined;this.query=undefined;this.queryKey='';this.scopeKey='';this.dead=false;this.unknown=false;for(const entry of entries){entry.editor.dispose();this.ports.forgotten(entry.page);}if(notify)this.ports.changed();}
}
