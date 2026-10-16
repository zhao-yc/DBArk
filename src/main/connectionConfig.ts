import { randomUUID } from 'node:crypto';
import type { ConnectionProfile } from '../shared/contracts';
import { connectionTransportChanged } from '../shared/connectionProfile';
import type { LocalStore } from './storage';
import type { EngineBroker } from './broker';
import { connectionReplacementText } from '../shared/connectionTransferMessages';

/** 敏感配置先检查执行进程再落盘；检查期间禁止新请求读取旧配置建立连接。 */
export class ConnectionConfigManager {
  private readonly saving = new Set<string>();
  /** 依赖只取保存所需方法，便于独立验证进程检查与磁盘提交之间的并发边界。 */
  constructor(private readonly store: Pick<LocalStore, 'connections' | 'resolveConnection' | 'saveConnection' | 'connectionRevision' | 'settings'>, private readonly broker: Pick<EngineBroker, 'request'>, private readonly replacementRuntime?: { assertIdle(ids: readonly string[]): void; revokeFiles(ids: readonly string[]): void }) {}

  /** 主进程所有指定连接的请求在解析凭据前调用，避免检查完成后旧值再次进入引擎。 */
  assertAvailable(id?: string): void { if (id && this.saving.has(id)) throw new Error('连接配置正在保存，请稍后重试当前操作'); }

  /** 整批先同步占住所有目标，再查真实引擎；期间其它修改/请求不能解析旧凭据。 */
  async replace<T>(targets: readonly ConnectionProfile[], expectedRevision: number, commit: () => T): Promise<T> {
    const ids = targets.map(profile => profile.id);
    if (!this.replacementRuntime || !ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error(connectionReplacementText.unavailable);
    for (const id of ids) this.assertAvailable(id);
    for (const id of ids) this.saving.add(id);
    /** 检查主进程已持有的标签/会话事实及单调修订，不使用renderer的busy布尔。 */
    const assertCurrent = () => {
      if (this.store.connectionRevision() !== expectedRevision) throw new Error(connectionReplacementText.changed);
      if (this.store.settings().tabs.some(tab => ids.includes(tab.connectionId))) throw new Error(connectionReplacementText.active);
      this.replacementRuntime!.assertIdle(ids);
    };
    try {
      assertCurrent();
      for (const profile of targets) {
        // 不调用resolveConnection：旧秘密无论能否解密都不发送给新端点；强制走原缓存/租约失效屏障。
        await this.broker.request('__connections.prepareSave', { id: profile.id, profile, transportChanged: true });
        assertCurrent();
      }
      const result = commit();
      this.replacementRuntime.revokeFiles(ids);
      return result;
    } finally { for (const id of ids) this.saving.delete(id); }
  }

  /** 显示项可即时保存；目标或凭据改变时不得取消任务、回滚事务或静默继续旧会话。 */
  async save(input: ConnectionProfile): Promise<ConnectionProfile> {
    const profile = { ...input, id: input.id || randomUUID() };
    this.assertAvailable(profile.id);
    const previous = this.store.connections().find(item => item.id === profile.id);
    // 先按公开概要判断编辑意图，不能因旧系统密文不可解密而阻止用户重填新密码修复连接。
    if (previous && !connectionTransportChanged(previous, profile)) return this.store.saveConnection(profile);
    const next = this.store.resolveConnection(profile.id, profile);
    this.saving.add(profile.id);
    try {
      // 只由主进程发送内部命令。引擎检查通过后清除缓存，磁盘失败时旧配置仍可重新打开。
      await this.broker.request('__connections.prepareSave', { id: profile.id, profile: next, transportChanged: Boolean(previous) });
      return this.store.saveConnection(profile);
    } finally { this.saving.delete(profile.id); }
  }
}
