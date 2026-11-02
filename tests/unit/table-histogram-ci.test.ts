import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { tableHistogramOfflineEnvironment, tableHistogramOfflineCommand } from '../../scripts/table-histogram-ci.mjs';
it('数值分布离线环境移除认证/配置/注入，只启用本例，原父环境不变', () => {
  const parent = { PATH: '原系统路径', SystemRoot: '原系统目录', DBARK_TEST_PASSWORD: '合成秘密', DBARK_USER_DATA: '原安装配置', DBARK_DEV_URL: '原服务', DBARK_TABLE_HISTOGRAM_READONLY: '1', MYSQL_HOST: '原服务器', PGPASSWORD: '合成PG秘密', SSH_AUTH_SOCK: '原代理', NODE_OPTIONS: '--require 原模块', NODE_PATH: '原模块路径', ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_TRACE: 'on' }, value = tableHistogramOfflineEnvironment(parent);
  expect(parent.DBARK_TABLE_HISTOGRAM_READONLY).toBe('1'); expect(value.env).toMatchObject({ PATH: parent.PATH, SystemRoot: parent.SystemRoot, DBARK_TABLE_HISTOGRAM_NATIVE: '1', DBARK_INTEGRATION_ENABLED: '0' });
  expect(Object.keys(value.env).filter(key => /^(DBARK|MYSQL|PG|SSH|NODE_|ELECTRON|PLAYWRIGHT_TRACE)/.test(key)).sort()).toEqual(['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_HISTOGRAM_NATIVE']); expect(JSON.stringify(value)).not.toContain('合成秘密'); expect(value.dropped).toContain('NODE_OPTIONS');
});
it('固定原两例与原时限，不允许CLI覆盖认证/重试/路径；默认和list先短路', () => {
  const args = tableHistogramOfflineCommand(); expect(args).toContain('tests/e2e/table-histogram-native.spec.ts'); expect(args).toContain('--workers=1'); expect(args).toContain('--retries=0'); expect(args).toContain('--trace=off'); expect(args.some(value => /timeout|grep|repeat-each|password|executable-path/.test(value))).toBe(false);
  const spec = readFileSync(new URL('../e2e/table-histogram-native.spec.ts', import.meta.url), 'utf8'); expect(spec).toContain('timeout: 120000, retries: 0'); expect(spec).toContain("!listing && process.env.DBARK_TABLE_HISTOGRAM_NATIVE === '1'"); expect(spec).toContain("if (!enabled) return;");
});
it('三平台源码CI保留原件，不取消旧轮且不创建发行', () => {
  const source = readFileSync(new URL('../../.github/workflows/table-histogram.yml', import.meta.url), 'utf8'); for (const name of ['windows-latest', 'macos-latest', 'macos-15-intel', 'node scripts/table-histogram-ci.mjs', 'cancel-in-progress: false', 'if: always()', 'actions/upload-artifact@v4']) expect(source).toContain(name); expect(source).not.toContain('gh release'); expect(source).not.toContain('continue-on-error');
});
