import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { AtomicFile, type AtomicFileIO } from '../engine/atomicFile';
import { connectionImportApplySchema, connectionImportReviewSchema, connectionReplacementAcknowledgements, connectionTransferDocumentSchema, connectionTransferLimits, exportConnectionProfile, importConnectionProfile, importReplacementProfile, type ConnectionImportApply, type ConnectionImportDecision, type ConnectionImportPreview, type ConnectionImportResult, type ConnectionImportReview, type ConnectionImportReviewInput, type ExportedConnectionProfile } from '../shared/connectionTransfer';
import { connectionReplacementText as messages } from '../shared/connectionTransferMessages';
import type { ConnectionProfile } from '../shared/contracts';
import type { ConnectionImportStorageOptions, LocalStore } from './storage';

interface Review { token: string; decisions: ConnectionImportDecision[]; replacements: ConnectionImportStorageOptions['replacements']; }
interface Snapshot { expires: number; revision: number; profiles: ExportedConnectionProfile[]; review?: Review; }
export interface ConnectionReplacementGuard { replace<T>(targets: readonly ConnectionProfile[], expectedRevision: number, commit: () => T): Promise<T>; }

/** 只按公开服务器路由提示潜在重复；匹配从不用于覆盖或复用已有身份。 */
function target(profile: ExportedConnectionProfile): string | undefined {
  // 文件名提示不能证明两个本机文件是同一目标，SQLite只按ID或显示名称提示重复。
  if (profile.dialect === 'sqlite') return undefined;
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
  constructor(private readonly store: Pick<LocalStore, 'connections' | 'connectionRevision' | 'importConnections'>, private readonly now = Date.now, private readonly io?: AtomicFileIO, private readonly replacementGuard?: ConnectionReplacementGuard) {}

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
      warnings: profile.dialect === 'sqlite' ? ['数据库文件只保留文件名提示，必须重新选择本机SQLite文件并保存后才能连接'] : ['不包含数据库密码、SSH 密码或私钥口令；导入后请核对目标并补充认证', ...(importConnectionProfile(profile, '').pendingFiles?.length ? ['认证文件仅有文件名提示，必须重新选择本机文件并保存后才能连接'] : [])],
      matches: stored.flatMap(existing => { const reasons: ('id' | 'name' | 'target')[] = []; if (existing.id === profile.id) reasons.push('id'); if (existing.name === profile.name) reasons.push('name'); if (target(profile) !== undefined && target(existing) === target(profile)) reasons.push('target'); return reasons.length ? [{ id: existing.id, name: existing.name, reasons }] : []; }),
    })) };
  }

  /** 决策按不可变源顺序规范化，拒绝跨行偷换、重复源和一批多源复用同一目标。 */
  private decisions(snapshot: Snapshot, input: ConnectionImportDecision[]): ConnectionImportDecision[] {
    const decisions = new Map(input.map(item => [item.sourceId, item]));
    const targetIds = input.flatMap(item => item.action === 'replace' ? [item.targetId] : []);
    if (decisions.size !== input.length || decisions.size !== snapshot.profiles.length || snapshot.profiles.some(profile => !decisions.has(profile.id)) || new Set(targetIds).size !== targetIds.length) throw new Error(messages.decision);
    return snapshot.profiles.map(profile => structuredClone(decisions.get(profile.id)!));
  }

  /** 二次预览绑定源→目标配对和旧概要；任何重新审阅都会先撤销旧确认，不延长原十分钟期限。 */
  review(input: ConnectionImportReviewInput): ConnectionImportReview {
    const snapshot = this.previews.get(input.previewToken);
    if (!snapshot || snapshot.expires <= this.now()) throw new Error(messages.review);
    snapshot.review = undefined;
    const parsed = connectionImportReviewSchema.parse(input);
    if (snapshot.revision !== this.store.connectionRevision()) throw new Error(messages.changed);
    const decisions = this.decisions(snapshot, parsed.decisions), stored = new Map(this.store.connections().map(profile => [profile.id, exportConnectionProfile(profile)]));
    const replacements = decisions.flatMap(decision => {
      if (decision.action !== 'replace') return [];
      const previous = stored.get(decision.targetId); if (!previous) throw new Error(messages.missing);
      if ((snapshot.profiles.find(profile => profile.id === decision.sourceId)?.dialect === 'sqlite') !== (previous.dialect === 'sqlite')) throw new Error('不能将已有连接替换为其他数据库类型，请另建连接');
      return [{ sourceId: decision.sourceId, targetId: decision.targetId, previous: structuredClone(previous) }];
    });
    if (!replacements.length) throw new Error(messages.decision);
    const token = randomUUID(); snapshot.review = { token, decisions, replacements };
    return structuredClone({ confirmationToken: token, expiresAt: new Date(snapshot.expires).toISOString(), entries: snapshot.profiles.map((profile, index) => ({ sourceId: profile.id, action: decisions[index].action, profile, ...(replacements.find(item => item.sourceId === profile.id) ? { previous: replacements.find(item => item.sourceId === profile.id)!.previous } : {}) })) });
  }

  /** 选择改变或关闭窗口后撤销指定确认；迟到的释放不能撤销随后生成的新确认。 */
  releaseReview(input: { previewToken: string; confirmationToken: string }): void {
    const snapshot = this.previews.get(input.previewToken);
    if (snapshot?.review?.token === input.confirmationToken) snapshot.review = undefined;
  }

  /** 首次确认尝试即消费整个预览；规范、风险、并发或磁盘失败均不得复用或自动重试。 */
  private prepareApply(input: ConnectionImportApply) {
    const snapshot = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!snapshot || snapshot.expires <= this.now()) throw new Error('导入预览已失效，请重新选择文件并预览');
    const parsed = connectionImportApplySchema.parse(input);
    if (snapshot.revision !== this.store.connectionRevision()) throw new Error(messages.changed);
    const decisions = this.decisions(snapshot, parsed.decisions), replacements = decisions.filter(item => item.action === 'replace');
    if (replacements.length) {
      if (!snapshot.review || snapshot.review.token !== parsed.confirmationToken || JSON.stringify(snapshot.review.decisions) !== JSON.stringify(decisions)) throw new Error(messages.review);
      const acknowledged = parsed.acknowledgements ?? [];
      if (acknowledged.length !== connectionReplacementAcknowledgements.length || new Set(acknowledged).size !== acknowledged.length || connectionReplacementAcknowledgements.some(id => !acknowledged.includes(id))) throw new Error(messages.acknowledgements);
    } else if (parsed.confirmationToken || parsed.acknowledgements?.length) throw new Error(messages.review);
    const bound = replacements.length ? snapshot.review!.replacements : [], selected = snapshot.profiles.filter((_, index) => decisions[index].action !== 'skip');
    const targets = replacements.map(decision => importReplacementProfile(snapshot.profiles.find(profile => profile.id === decision.sourceId)!, bound.find(item => item.sourceId === decision.sourceId)!.previous));
    return { targets, revision: snapshot.revision, commit: (): ConnectionImportResult => {
      if (snapshot.expires <= this.now()) throw new Error(messages.review);
      if (snapshot.revision !== this.store.connectionRevision()) throw new Error(messages.changed);
      const connections = selected.length ? this.store.importConnections(selected, parsed.allowIncomplete === true, { expectedRevision: snapshot.revision, replacements: bound }) : [];
      return { connections: this.store.connections(), added: connections.length - replacements.length, skipped: snapshot.profiles.length - connections.length, ...(replacements.length ? { replaced: replacements.length, replacementIds: targets.map(profile => profile.id) } : {}) };
    } };
  }

  /** 原新增/跳过同步入口保持；没有主进程活动屏障时任何替换都拒绝。 */
  apply(input: ConnectionImportApply): ConnectionImportResult {
    const prepared = this.prepareApply(input);
    if (prepared.targets.length) throw new Error(messages.unavailable);
    return prepared.commit();
  }

  /** 公开主进程处理器使用本入口；全部目标检查成功后才同步执行一批SQLite事务。 */
  async applyBatch(input: ConnectionImportApply): Promise<ConnectionImportResult> {
    const prepared = this.prepareApply(input);
    if (!prepared.targets.length) return prepared.commit();
    if (!this.replacementGuard) throw new Error(messages.unavailable);
    return this.replacementGuard.replace(prepared.targets, prepared.revision, prepared.commit);
  }
}
