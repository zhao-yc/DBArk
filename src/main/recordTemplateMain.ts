import { randomUUID } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { LocalStore } from './storage';
import { recordTemplateTargetSchema, recordTemplateSaveSchema, recordTemplateSelectSchema, recordTemplateRenameSchema, type RecordTemplateTarget, type RecordTemplateStored, type RecordTemplateSnapshot, type RecordTemplateContent } from '../shared/recordTemplates';

export type RecordTemplateCommand = 'list' | 'save' | 'rename' | 'delete' | 'read';
interface Ports {
  store: Pick<LocalStore, 'recordTemplates' | 'saveRecordTemplate' | 'renameRecordTemplate' | 'deleteRecordTemplate' | 'readRecordTemplate'>;
  assert(owner?: ColumnsInvocation): void; same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  available(connectionId: string): void; shuttingDown(): boolean;
}

/** 只授权本机模板读写，令牌绑定真实主文档、准确目标、原连接概要及单调期限。 */
export class RecordTemplateMain {
  private tokens = new Map<string, { owner: ColumnsInvocation; target: string; source: string; expires: number }>();
  private last = -Infinity;
  constructor(private readonly ports: Ports, private readonly clock = () => performance.now()) {}
  /** 时钟异常先撤销全部来源，不能通过墙钟回退延长旧模板令牌。 */
  private now(): number {
    const value = this.clock(); if (!Number.isFinite(value) || value < this.last) { this.tokens.clear(); throw Error('记录模板来源期限失效，请刷新'); }
    this.last = value; return value;
  }
  /** 每次读写与发布都重新检查原文档、退出状态和连接配置占用。 */
  private check(owner: ColumnsInvocation | undefined, target: RecordTemplateTarget): asserts owner is ColumnsInvocation {
    this.ports.assert(owner); if (!owner || this.ports.shuttingDown()) throw Error('原窗口已失效或客户端正在退出'); this.ports.available(target.connectionId);
  }
  /** 概要签发不附带真实值，来源有界且不刷新已签发令牌的有效期。 */
  private issue(owner: ColumnsInvocation, snapshot: RecordTemplateStored): RecordTemplateSnapshot {
    const now = this.now(); for (const [id, token] of this.tokens) if (token.expires <= now) this.tokens.delete(id);
    if (this.tokens.size >= 256) this.tokens.delete(this.tokens.keys().next().value!);
    const bindingToken = randomUUID(); this.tokens.set(bindingToken, { owner, target: JSON.stringify(snapshot.target), source: JSON.stringify(snapshot.source), expires: now + 600000 });
    return { ...snapshot, bindingToken };
  }
  /** 来源令牌不能由同数字ID、同URL后继文档或另一张表冒领。 */
  private bound(owner: ColumnsInvocation, input: RecordTemplateTarget & { source: unknown; bindingToken: string }): void {
    const token = this.tokens.get(input.bindingToken), target = { connectionId: input.connectionId, database: input.database, table: input.table };
    if (!token || token.expires <= this.now() || token.target !== JSON.stringify(target) || token.source !== JSON.stringify(input.source) || !this.ports.same(token.owner, owner)) throw Error('记录模板来源或目标已变化，请刷新');
  }
  /** 原存储事务在落盘前后核归属；IPC发布再次核CAS，已保存但发布失败须刷新核对。 */
  execute(command: RecordTemplateCommand, raw: unknown, owner?: ColumnsInvocation): { value: RecordTemplateSnapshot | RecordTemplateContent; publish(): void } {
    const input = command === 'list' ? recordTemplateTargetSchema.parse(raw) : command === 'save' ? recordTemplateSaveSchema.parse(raw) : command === 'rename' ? recordTemplateRenameSchema.parse(raw) : recordTemplateSelectSchema.parse(raw);
    const target = recordTemplateTargetSchema.parse({ connectionId: input.connectionId, database: input.database, table: input.table }); this.check(owner, target);
    const assertCurrent = () => { this.check(owner, target); if (command !== 'list') this.bound(owner, input as Parameters<RecordTemplateMain['bound']>[1]); };
    assertCurrent(); let saved = false, snapshot: RecordTemplateStored;
    if (command === 'save') { snapshot = this.ports.store.saveRecordTemplate(input, assertCurrent); saved = true; }
    else if (command === 'rename') { snapshot = this.ports.store.renameRecordTemplate(input, assertCurrent); saved = true; }
    else if (command === 'delete') { snapshot = this.ports.store.deleteRecordTemplate(input, assertCurrent); saved = true; }
    else snapshot = this.ports.store.recordTemplates(target);
    let value: RecordTemplateSnapshot | RecordTemplateContent;
    try { value = command === 'read' ? this.ports.store.readRecordTemplate(input) : this.issue(owner, snapshot); }
    catch (error) { if (saved) throw Error('本机记录模板已保存，但来源签发失败；请刷新核对，不要自动重试'); throw error; }
    return { value, publish: () => {
      try {
        assertCurrent(); const current = this.ports.store.recordTemplates(target);
        if (current.revision !== snapshot.revision || JSON.stringify(current.source) !== JSON.stringify(snapshot.source)) throw Error('记录模板状态已变化，请刷新');
        if (command === 'read') this.ports.store.readRecordTemplate(input);
      } catch (error) {
        if ('bindingToken' in value) this.tokens.delete(value.bindingToken);
        if (saved) throw Error('本机记录模板已保存，但原页面或状态已变化；请刷新核对，不要自动重试');
        throw error;
      }
    } };
  }
}
