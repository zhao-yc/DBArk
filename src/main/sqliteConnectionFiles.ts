import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import type { ConnectionProfile, FileChoice, SqliteConnectionProfile } from '../shared/contracts';

interface Grant<Owner> { owner: Owner; connectionId: string; path: string; device: bigint; inode: bigint; expires: number; revokedConnections: Set<string>; }
const stale = 'SQLite文件选择已失效或尚未授权，请通过文件选择器重新选择';

/** Main原生选择只授予准确文档的现存文件；持久配置不能借导入值或复制路径产生新授权。 */
export class SqliteConnectionFiles<Owner> {
  private readonly grants = new Map<string, Grant<Owner>>();
  constructor(private readonly owner: { assert(value: Owner): void; same(left: Owner, right: Owner): boolean }) {}

  /** 只读取本机文件身份，不解析库内容；真正打开数据库仍在独立utility内执行。 */
  private file(path: string) {
    try {
      if (!isAbsolute(path) || path.includes('\0')) throw Error(stale);
      const canonical = realpathSync(path), stat = statSync(canonical, { bigint: true });
      if (!stat.isFile()) throw Error(stale);
      return { path: canonical, device: stat.dev, inode: stat.ino };
    } catch { throw Error(stale); }
  }

  /** 对话框返回后先核原文档再登记；文件名只是展示，token不提供给通用files.path。 */
  register(owner: Owner, path: string, connectionId: string): FileChoice {
    this.owner.assert(owner);
    if (typeof connectionId !== 'string' || !connectionId || connectionId.length > 200) throw Error(stale);
    for (const [token, grant] of this.grants) {
      try { this.owner.assert(grant.owner); if (grant.expires <= Date.now()) this.grants.delete(token); }
      catch { this.grants.delete(token); }
    }
    if (this.grants.size >= 64) throw Error('SQLite文件选择已达上限，请关闭旧窗口后重新选择');
    const file = this.file(path), token = randomUUID();
    this.grants.set(token, { ...file, owner, connectionId, expires: Date.now() + 10 * 60 * 1000, revokedConnections: new Set() });
    return { token, name: basename(file.path) };
  }

  /** 测试可复用同一未过期选择，保存前及异步屏障后都重新核对原文档和实际文件身份。 */
  confirm(input: SqliteConnectionProfile, previous: ConnectionProfile | undefined, owner: Owner): SqliteConnectionProfile {
    this.owner.assert(owner);
    if (previous && previous.id !== input.id) throw Error(stale);
    const next = structuredClone(input), prior = previous?.dialect === 'sqlite' ? previous : undefined;
    const token = next.sqlite.fileToken; delete next.sqlite.fileToken;
    if (token !== undefined) {
      const grant = this.grants.get(token);
      if (!grant || grant.connectionId !== input.id || grant.expires <= Date.now() || grant.revokedConnections.has(input.id) || !this.owner.same(owner, grant.owner)) throw Error(stale);
      this.owner.assert(grant.owner);
      const current = this.file(grant.path);
      if (current.path !== grant.path || current.device !== grant.device || current.inode !== grant.inode || input.sqlite.filePath !== undefined && input.sqlite.filePath !== current.path) throw Error(stale);
      return { ...next, pendingFiles: undefined, sqlite: { ...next.sqlite, filePath: current.path, fileName: basename(current.path) } };
    }
    // 新配置/导入缺项永远不能仅靠填写路径或删pending标记变成已授权。
    const pending = !!(next.pendingFiles?.length || prior?.pendingFiles?.length);
    if (!pending && prior?.sqlite.filePath && (next.sqlite.filePath === undefined || next.sqlite.filePath === prior.sqlite.filePath)) {
      const current = this.file(prior.sqlite.filePath);
      if (current.path !== prior.sqlite.filePath) throw Error(stale);
      return { ...next, pendingFiles: undefined, sqlite: { ...next.sqlite, filePath: current.path, fileName: basename(current.path) } };
    }
    if (next.sqlite.filePath !== undefined) throw Error(stale);
    return { ...next, sqlite: { ...next.sqlite, filePath: undefined }, pendingFiles: ['sqliteDatabase'] };
  }

  /** 受控配置替换撤销目标对旧选择的使用，不能借替换前的令牌清掉待选文件标记。 */
  revokeConnections(ids: readonly string[]): void { for (const grant of this.grants.values()) for (const id of ids) grant.revokedConnections.add(id); }
  /** 只在原窗口退出时清空；导航换代由真实文档比较立即失效。 */
  clear(): void { this.grants.clear(); }
}
