import { defineConfig } from 'vitest/config';

/** 专用入口明确关闭Vite的.env自动加载；只收集本片纯策略及默认双门关闭的八项真实用例。 */
export default defineConfig({ envDir: false, test: { include: ['tests/integration/engine-table-copy-source.integration.test.ts', 'tests/integration/helpers/d02-copy-source-policy.test.ts'], environment: 'node', fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } });
