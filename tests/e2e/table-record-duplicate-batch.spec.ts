import { test } from '@playwright/test';

// 默认/列表只注册身份，不加载owner、驱动、凭据或会回填.env的旧帮助器。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_D02_BATCH_DUPLICATE_RECORD_UI === '1') {
  const { bindBatchDuplicateTarget, batchDuplicateTargetKeys } = require('../helpers/batchRecordDuplicateUi') as typeof import('../helpers/batchRecordDuplicateUi');
  const helper = Object.fromEntries(batchDuplicateTargetKeys.filter(key => Object.hasOwn(process.env, key)).map(key => [key, process.env[key]]));
  const binding = bindBatchDuplicateTarget(() => process.env, helper);
  const { registerBatchRecordDuplicate } = require('./table-record-duplicate-batch-live') as typeof import('./table-record-duplicate-batch-live');
  registerBatchRecordDuplicate(binding);
} else for (const name of ['批量复制精确值与暂存值，整批一步撤销重做且不自动写入', '勾选含新增草稿时整批拒绝且不增加历史', '批量副本唯一键冲突先拒绝，改键后只读预览并返回编辑']) test.skip(name, () => {});
