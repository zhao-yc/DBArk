import { createHash } from 'node:crypto';
import type { ConnectionProfile } from '../shared/contracts';
import { parseTableDraftDocument, parseTableDraftPayload, type TableDraftDocument, type TableDraftPayload, type TableDraftTarget } from '../shared/tableDraft';
/** 端点摘要仅包含连接目标和登录身份；不输出密码、密钥或证书内容与路径。 */
export function tableDraftEndpointKey(profile: ConnectionProfile): string {
  return createHash('sha256').update(JSON.stringify([profile.dialect, profile.host, profile.port, profile.user,
    !!profile.ssh?.enabled, ...(profile.ssh?.enabled ? [profile.ssh.host, profile.ssh.port, profile.ssh.user, profile.ssh.hostFingerprint ?? ''] : [])])).digest('hex');
}
/** 保存时由主进程绑定当前配置端点，界面不能指定其它端点的摘要。 */
export function bindTableDraft(payload: TableDraftPayload, profile: ConnectionProfile): TableDraftDocument {
  return parseTableDraftDocument({ kind: 'dbark.table-draft', version: 1, ...parseTableDraftPayload(payload), endpointKey: tableDraftEndpointKey(profile) });
}
/** 文件选择后仍核精确目标；同ID更换主机不能领取旧草稿。 */
export function assertTableDraftBinding(document: TableDraftDocument, target: TableDraftTarget, profile: ConnectionProfile): void {
  const checked = parseTableDraftDocument(document);
  if (checked.target.connectionId !== target.connectionId || checked.target.database !== target.database || checked.target.table !== target.table || checked.endpointKey !== tableDraftEndpointKey(profile)) throw Error('草稿不属于当前连接目标或表，未恢复任何修改');
}
