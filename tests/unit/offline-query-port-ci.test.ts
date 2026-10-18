import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const workflow=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
/** 只检查固定流水线接线，不运行Actions、安装、网络或产品。 */
describe('源码与安装的固定离线预检接线',()=>{
  it('源码E2E之前单独执行固定预检，源码和安装两处均开启新门',()=>{
    const source=workflow.match(/- run: pnpm exec playwright test --output=test-results\/legacy-source([\s\S]*?)(?=\n      - )/)?.[1],packaged=workflow.match(/- run: pnpm test:packaged([\s\S]*?)(?=\n      - )/)?.[1];
    expect(source).toContain("DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST: '1'");expect(source).toContain("DBARK_INTEGRATION_ENABLED: '0'");expect(packaged).toContain("DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST: '1'");
    // 新源码专项也必须在同一固定预检之后；legacy改独立输出，不重复build。
    const precheck=workflow.indexOf('run: node scripts/check-offline-query-port.mjs'),native=workflow.indexOf('run: node scripts/native-editor-ci.mjs source'),legacy=workflow.indexOf('run: pnpm exec playwright test --output=test-results/legacy-source');
    expect(precheck).toBeGreaterThan(0);expect(precheck).toBeLessThan(native);expect(native).toBeLessThan(legacy);
    expect(workflow.match(/DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST: '1'/g)).toHaveLength(2);expect(source).not.toContain('DBARK_DEV_URL:');
  });
});
