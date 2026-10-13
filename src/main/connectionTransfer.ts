import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { AtomicFile, type AtomicFileIO } from '../engine/atomicFile';
import { connectionImportApplySchema, connectionTransferDocumentSchema, connectionTransferLimits, exportConnectionProfile, importConnectionProfile, type ConnectionImportApply, type ConnectionImportPreview, type ConnectionImportResult, type ExportedConnectionProfile } from '../shared/connectionTransfer';
import type { LocalStore } from './storage';

interface Snapshot { expires: number; revision: number; profiles: ExportedConnectionProfile[]; }

/** 只按公开服务器路由提示潜在重复；匹配从不用于覆盖或复用已有身份。 */
function target(profile: ExportedConnectionProfile): string {
  return JSON.stringify([profile.dialect, profile.host, profile.port, profile.user, profile.database ?? '', profile.ssh?.enabled ?? false, profile.ssh?.host ?? '', profile.ssh?.port ?? 22, profile.ssh?.user ?? '']);
}

/** 有界读取同一个已打开文件句柄，文件在读取中增长也不能绕过预算。 */
async function readDocument(path: string) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > connectionTransferLimits.fileBytes) throw new Error('连接配置必须是至多 2 MiB 的普通 UTF-8 JSON 文件');
    const parts: Buffer[] = []; let bytes = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, connectionTransferLimits.fileBytes + 1 - bytes));
      const result = await file.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
      if (bytes > connectionTransferLimits.fileBytes) throw new Error('连接配置超过 2 MiB 上限');
      parts.push(buffer.subarray(0, result.bytesRead));
    }
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
    catch { throw new Error('连接配置必须是有效 UTF-8 JSON 文件'); }
    const result = connectionTransferDocumentSchema.safeParse(parsed);
    // 不回显未知字段或值，避免错误信息复制恶意文件中的秘密。
    if (!result.success) throw new Error('连接配置格式无效：只支持版本 1、至多 500 条无秘密概要，禁止未知字段、路径和重复源 ID');
    return result.data;
  } finally { await file.close(); }
}

/** 小型配置交换完全离线；确认只使用主进程保存的不可变快照。 */
export class ConnectionTransfer {
  private readonly previews = new Map<string, Snapshot>();
  /** 时钟和文件 IO 可注入，以真实文件及存储验证过期、短写和磁盘失败。 */
  constructor(private readonly store: Pick<LocalStore, 'connections' | 'connectionRevision' | 'importConnections'>, private readonly now = Date.now, private readonly io?: AtomicFileIO) {}

  /** 导出只读取概要白名单，既不解密秘密，也不建立数据库连接。 */
  async exportFile(path: string, connectionIds: string[]): Promise<{ count: number }> {
    if (!connectionIds.length || connectionIds.length > connectionTransferLimits.connections || new Set(connectionIds).size !== connectionIds.length) throw new Error('请选择 1 至 500 个不同连接');
    const stored = new Map(this.store.connections().map(profile => [profile.id, profile]));
    const profiles = connectionIds.map(id => { const profile = stored.get(id); if (!profile) throw new Error('选择的连接已不存在，请重新选择'); return exportConnectionProfile(profile); });
    const content = JSON.stringify({ format: 'DBArk-connections', version: 1, connections: profiles }, null, 2) + '\n';
    if (Buffer.byteLength(content, 'utf8') > connectionTransferLimits.fileBytes) throw new Error('连接配置超过 2 MiB 上限');
    const writer = await AtomicFile.create(path, 'utf8', () => {}, () => {}, this.io, connectionTransferLimits.fileBytes);
    try { await writer.write(content); await writer.commit(); } finally { await writer.dispose(); }
    return { count: profiles.length };
  }

  /** 读取后生成十分钟快照；文件后续修改不影响已显示内容，连接变更则必须重新预览。 */
  async preview(path: string): Promise<ConnectionImportPreview> {
    const document = await readDocument(path), now = this.now();
    for (const [token, snapshot] of this.previews) if (snapshot.expires <= now) this.previews.delete(token);
    if (this.previews.size >= connectionTransferLimits.previews) this.previews.delete(this.previews.keys().next().value!);
    const stored = this.store.connections().map(exportConnectionProfile);
    const token = randomUUID(), expires = now + connectionTransferLimits.previewLifetimeMs;
    this.previews.set(token, { expires, revision: this.store.connectionRevision(), profiles: structuredClone(document.connections) });
    return { previewToken: token, expiresAt: new Date(expires).toISOString(), entries: document.connections.map(profile => ({
      sourceId: profile.id, profile,
      warnings: ['不包含数据库密码、SSH 密码或私钥口令；导入后请核对目标并补充认证', ...(importConnectionProfile(profile, '').pendingFiles?.length ? ['认证文件仅有文件名提示，必须重新选择本机文件并保存后才能连接'] : [])],
      matches: stored.flatMap(existing => { const reasons: ('id' | 'name' | 'target')[] = []; if (existing.id === profile.id) reasons.push('id'); if (existing.name === profile.name) reasons.push('name'); if (target(existing) === target(profile)) reasons.push('target'); return reasons.length ? [{ id: existing.id, name: existing.name, reasons }] : []; }),
    })) };
  }

  /** 令牌在第一次确认尝试时消费，失败也不能重试或重放；所有新增一次事务提交。 */
  apply(input: ConnectionImportApply): ConnectionImportResult {
    const snapshot = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!snapshot || snapshot.expires <= this.now()) throw new Error('导入预览已失效，请重新选择文件并预览');
    const parsed = connectionImportApplySchema.parse(input);
    if (snapshot.revision !== this.store.connectionRevision()) throw new Error('连接配置已变化，请重新预览并确认导入');
    const decisions = new Map(parsed.decisions.map(item => [item.sourceId, item.action]));
    if (decisions.size !== parsed.decisions.length || decisions.size !== snapshot.profiles.length || snapshot.profiles.some(profile => !decisions.has(profile.id))) throw new Error('必须为每个源连接选择一次新增或跳过');
    const selected = snapshot.profiles.filter(profile => decisions.get(profile.id) === 'add');
    const connections = selected.length ? this.store.importConnections(selected, parsed.allowIncomplete === true) : [];
    return { connections: this.store.connections(), added: connections.length, skipped: snapshot.profiles.length - connections.length };
  }
}
