import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { AtomicFile, type AtomicFileIO } from '../engine/atomicFile';
import type { LocalStore } from './storage';
import type { SqlSnippet } from '../shared/contracts';
import { decodeSnippetTransfer, encodeSnippetTransfer, previewSnippetTransfer, snippetTransferLimits as limits, snippetTransferSchemas, snippetTransferZh as text, type SnippetTransferDecision, type SnippetTransferPreview, type SnippetTransferEntry, type SnippetTransferResult } from '../shared/snippetTransfer';

export interface SnippetTransferOwner { document: object; assertCurrent(): void; }
interface ReadHandle { stat(): Promise<Stats>; read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>; close(): Promise<void>; }
interface Operation { cancelled: boolean; committing: boolean; revision: number; }
interface Preview { id: string; expires: number; revision: number; entries: SnippetTransferEntry[]; }
interface Scope { owner: SnippetTransferOwner; operation?: Operation; preview?: Preview; }
export interface SnippetTransferPorts { choose(mode: 'import' | 'export'): Promise<string | undefined>; read?(path: string): Promise<ReadHandle>; io?: AtomicFileIO; }

/** 仅原生文件对话框授权路径；Main快照与文档归属共同约束一次确认，完全不接数据库broker。 */
export class SnippetTransfers {
  private readonly scopes = new Map<string, Scope>();
  /** 注入实际用户存储、文件对话框和时钟，不授予渲染进程直接文件路径。 */
  constructor(private readonly store: Pick<LocalStore, 'snippets' | 'snippetRevision' | 'applySnippetBatch'>, private readonly ports: SnippetTransferPorts, private readonly now = Date.now) {}
  /** 新能力只归属当前Main文档，先淘汰失效文档并限制总数量。 */
  open(owner: SnippetTransferOwner): { scopeId: string } {
    owner.assertCurrent();
    for (const [id, scope] of this.scopes) try { scope.owner.assertCurrent(); } catch { this.scopes.delete(id); }
    if (this.scopes.size >= limits.sessions) throw Error(text.busy);
    const scopeId = randomUUID(); this.scopes.set(scopeId, { owner }); return { scopeId };
  }
  /** 只认Main保存的文档对象；客户端UUID不能授予另一个窗口或文档的预览。 */
  private scope(id: string, owner: SnippetTransferOwner): Scope {
    owner.assertCurrent(); const scope = this.scopes.get(id);
    if (!scope || scope.owner.document !== owner.document) throw Error(text.stale);
    scope.owner.assertCurrent(); return scope;
  }
  /** 取消仅在发布前生效；已跨提交点的普通取消必须等待原操作返回。 */
  cancel(id: string, owner: SnippetTransferOwner, close = false): { cancelled: boolean } {
    const scope = this.scope(id, owner);
    if (scope.operation?.committing && !close) return { cancelled: false };
    if (scope.operation) scope.operation.cancelled = true;
    scope.preview = undefined; if (close) this.scopes.delete(id); return { cancelled: true };
  }
  /** 一个能力同时只允许一次文件操作，新操作消费旧预览。 */
  private start(scope: Scope): Operation {
    if (scope.operation) throw Error(text.busy);
    scope.preview = undefined; const operation = { cancelled: false, committing: false, revision: this.store.snippetRevision() }; scope.operation = operation; return operation;
  }
  /** 每次await两侧检查同一scope、操作及库修订；取消/重载/并发修改后不复活。 */
  private guard(id: string, scope: Scope, op: Operation) {
    scope.owner.assertCurrent();
    if (this.scopes.get(id) !== scope || scope.operation !== op || op.cancelled || this.store.snippetRevision() !== op.revision) throw Error(text.stale);
  }
  /** 同一真实句柄限量读取并复核前后身份，预览只留Main内存。 */
  async preview(id: string, owner: SnippetTransferOwner): Promise<SnippetTransferPreview | null> {
    const scope = this.scope(id, owner), op = this.start(scope), guard = () => this.guard(id, scope, op);
    try {
      guard(); const path = await this.ports.choose('import'); guard(); if (!path) return null;
      const handle = await (this.ports.read ?? (path => open(path, 'r')))(path); let failure: unknown;
      let items: SqlSnippet[];
      try {
        guard(); const before = await handle.stat(); guard();
        if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > limits.bytes) throw Error(text.invalid);
        const chunks: Buffer[] = []; let total = 0;
        for (;;) {
          const buffer = Buffer.alloc(Math.min(65536, limits.bytes + 1 - total)); guard();
          const read = await handle.read(buffer, 0, buffer.length, total); guard();
          if (!Number.isSafeInteger(read.bytesRead) || read.bytesRead < 0 || read.bytesRead > buffer.length) throw Error(text.invalid);
          if (!read.bytesRead) break; total += read.bytesRead; if (total > limits.bytes) throw Error(text.invalid); chunks.push(buffer.subarray(0, read.bytesRead));
        }
        const after = await handle.stat(); guard();
        if (total !== before.size || !after.isFile() || ['size', 'dev', 'ino', 'mtimeMs', 'ctimeMs'].some(key => before[key as keyof Stats] !== after[key as keyof Stats])) throw Error(text.stale);
        items = decodeSnippetTransfer(Buffer.concat(chunks));
      } catch (reason) { failure = reason; throw reason; }
      finally { try { await handle.close(); } catch (closing) { throw failure === undefined ? closing : new AggregateError([failure, closing], text.stale, { cause: failure }); } }
      guard(); const preview = { id: randomUUID(), expires: this.now() + limits.lifetime, revision: op.revision, entries: previewSnippetTransfer(this.store.snippets(), items!) };
      scope.preview = structuredClone(preview); return { previewId: preview.id, expiresAt: preview.expires, entries: structuredClone(preview.entries) };
    } finally { if (scope.operation === op) scope.operation = undefined; }
  }
  /** 原子暂存后才发布完整JSON；关闭和清理错误必须保留原始结局。 */
  async export(id: string, owner: SnippetTransferOwner): Promise<{ count: number } | null> {
    const scope = this.scope(id, owner), op = this.start(scope), guard = () => this.guard(id, scope, op);
    try {
      const items = this.store.snippets(); if (!items.length) throw Error(text.empty); const content = encodeSnippetTransfer(items);
      guard(); const path = await this.ports.choose('export'); guard(); if (!path) return null;
      const writer = await AtomicFile.create(path, 'utf8', guard, () => { guard(); op.committing = true; }, this.ports.io, limits.bytes, undefined, true); let failure: unknown;
      try { await writer.write(content); await writer.prepare(true); await writer.commit(); }
      catch (reason) { failure = reason; throw reason; }
      finally { try { await writer.dispose(); } catch (closing) { throw failure === undefined ? closing : new AggregateError([failure, closing], text.stale, { cause: failure }); } }
      return { count: items.length };
    } finally { if (scope.operation === op) scope.operation = undefined; }
  }
  /** 首次合法确认即消费快照；失败不保留可重放令牌，SQL数据从不取客户端回传正文。 */
  apply(id: string, owner: SnippetTransferOwner, previewId: string, decisions: SnippetTransferDecision[]): SnippetTransferResult {
    const scope = this.scope(id, owner), preview = scope.preview; scope.preview = undefined;
    if (scope.operation || !preview || preview.id !== previewId || preview.expires <= this.now() || preview.revision !== this.store.snippetRevision()) throw Error(text.stale);
    const input = snippetTransferSchemas['snippets.transferApply'].parse({ scopeId: id, previewId, decisions });
    const map = new Map(input.decisions.map(d => [d.id, d.action]));
    if (map.size !== preview.entries.length || map.size !== decisions.length || preview.entries.some(e => !map.has(e.snippet.id))) throw Error(text.stale);
    const changed: SqlSnippet[] = []; let added = 0, replaced = 0;
    for (const entry of preview.entries) {
      const action = map.get(entry.snippet.id)!; if (action === 'skip') continue;
      if (entry.status !== action) throw Error(text.stale);
      changed.push(entry.snippet); if (action === 'add') added++; else replaced++;
    }
    scope.owner.assertCurrent();
    this.store.applySnippetBatch(changed, preview.revision, () => { scope.owner.assertCurrent(); if (this.scopes.get(id) !== scope || preview.expires <= this.now()) throw Error(text.stale); });
    return { items: this.store.snippets(), added, replaced, skipped: preview.entries.length - changed.length };
  }
}
