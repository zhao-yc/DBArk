import type { TableRenameApplyOutput } from '../../src/shared/tableRename';

/** 固定361b7be真实Engine驱动替身产生的两种回执，仅作协议夹具；原始结果与摘要保留在审查缓存。 */
export const tableRenameFailureResults: Record<'read-failure' | 'physical-change', TableRenameApplyOutput> = {
  'read-failure': {
    target: { connectionId: 'comment-unit', database: 'db', table: 't' }, newTarget: { connectionId: 'comment-unit', database: 'db', table: 'renamed' },
    ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [],
    verificationError: '已收到DDL成功响应，但取消、断线或目录读取失败导致后核验未完成；请核对源表和新表，不要重复执行',
  },
  'physical-change': {
    target: { connectionId: 'comment-unit', database: 'db', table: 't' }, newTarget: { connectionId: 'comment-unit', database: 'db', table: 'renamed' },
    ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [],
    after: { tableId: '9007199254740996', ddlHash: '9bfc0a597c491be10f8b0c272e1a6c336e3321e30d8ba960c34874dd0ea1fe9e', physicalIdentity: '35f8fa816cf8e5f9fcd797ebc2520f1e8e0fd6233b0da9b4b3c805915101f768' },
    verificationError: 'DDL已完成，但新名称的物理身份、完整定义或旧名称消失尚未全部核验；请核对实际状态，不要重复执行',
  },
};
