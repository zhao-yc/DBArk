import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/sqlite-workspace.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const expected = {
  workspace: [
    ['workspace', 'sqlite-workspace-native.spec.ts', 'sqlite-workspace'],
    ['table', 'sqlite-table-browse-native.spec.ts', 'sqlite-table-browse'],
    ['export', 'sqlite-table-export-native.spec.ts', 'sqlite-table-export'],
    ['edit', 'sqlite-table-edit-native.spec.ts', 'sqlite-table-edit'],
    ['schema-export', 'sqlite-schema-export-native.spec.ts', 'sqlite-schema-export'],
    ['current', 'sqlite-current-statement-native.spec.ts', 'sqlite-current-statement'],
    ['explain', 'sqlite-explain-native.spec.ts', 'sqlite-explain'],
    ['parameters', 'sqlite-parameters-native.spec.ts', 'sqlite-parameters'],
    ['create', 'sqlite-create-native.spec.ts', 'sqlite-create'],
    ['completion', 'sqlite-completion-native.spec.ts', 'sqlite-completion'],
    ['table-create', 'sqlite-table-create-native.spec.ts', 'sqlite-table-create'],
  ],
  'management-schema': [
    ['table-import', 'sqlite-table-import-native.spec.ts', 'sqlite-table-import'],
    ['import-new-table', 'sqlite-import-new-table-native.spec.ts', 'sqlite-import-new-table'],
    ['indexes', 'sqlite-indexes-native.spec.ts', 'sqlite-indexes'],
    ['columns', 'sqlite-columns-native.spec.ts', 'sqlite-columns'],
    ['table-rename', 'sqlite-table-rename-native.spec.ts', 'sqlite-table-rename'],
    ['table-maintenance', 'sqlite-table-maintenance-native.spec.ts', 'sqlite-table-maintenance'],
    ['objects', 'sqlite-objects-native.spec.ts', 'sqlite-objects'],
  ],
  'management-rebuild': [
    ['table-rebuild', 'sqlite-table-rebuild-native.spec.ts', 'sqlite-table-rebuild'],
    ['table-reorder', 'sqlite-table-reorder-native.spec.ts', 'sqlite-table-reorder'],
  ],
  'management-data': [
    ['clipboard', 'sqlite-table-clipboard-native.spec.ts', 'sqlite-table-clipboard'],
    ['range-paste', 'sqlite-table-range-paste-native.spec.ts', 'sqlite-table-range-paste'],
    ['table-find', 'sqlite-table-find-native.spec.ts', 'sqlite-table-find'],
    ['table-duplicate', 'sqlite-table-duplicate-native.spec.ts', 'sqlite-table-duplicate'],
    ['table-remove-selected', 'sqlite-table-remove-selected-native.spec.ts', 'sqlite-table-remove-selected'],
    ['table-fill', 'sqlite-table-fill-native.spec.ts', 'sqlite-table-fill'],
    ['filtered-select', 'sqlite-filtered-select-native.spec.ts', 'sqlite-filtered-select'],
  ],
} as const;
type Suite = keyof typeof expected;
const allExpected = Object.values(expected).flat();
// 原27项完整清单独立保存：分组变化不能借同步修改期望值而悄悄删掉专项。
const originalKinds = ['workspace', 'table', 'export', 'edit', 'schema-export', 'current', 'explain', 'parameters', 'create', 'completion', 'table-create', 'table-import', 'import-new-table', 'indexes', 'columns', 'table-rename', 'table-maintenance', 'objects', 'table-rebuild', 'clipboard', 'range-paste', 'table-reorder', 'table-find', 'table-duplicate', 'table-remove-selected', 'table-fill', 'filtered-select'];
interface Step { raw: string; name?: string; run?: string; uses?: string; condition?: string; }
/** 仅解析本workflow固定缩进的step标量，不启动runner或引入宽泛YAML解释器。 */
function parseSteps(source: string): Step[] {
  const marker = '    steps:\n', index = source.indexOf(marker); if (index < 0 || source.indexOf(marker, index + marker.length) >= 0) throw Error('必须只有一个固定矩阵任务步骤块');
  const body = source.slice(index + marker.length), blocks = body.split(/(?=^      - )/m).filter(value => value.trim());
  return blocks.map(raw => {
    const fields = new Map<string, string>();
    for (const line of raw.split('\n')) { const match = /^(?:      - |        )(name|run|uses|if): (.+)$/.exec(line); if (!match) continue; if (fields.has(match[1])) throw Error('重复step字段'); fields.set(match[1], match[2]); }
    return { raw, name: fields.get('name'), run: fields.get('run'), uses: fields.get('uses'), condition: fields.get('if') };
  });
}
/** 矩阵轴必须是完整固定值，不能把include误当平行但覆盖不全的任务。 */
function axis(name: 'os' | 'suite'): string[] {
  const matches = [...workflow.matchAll(new RegExp('^        ' + name + ': \\[([^\\]]+)\\]$', 'gm'))]; if (matches.length !== 1) throw Error('矩阵轴缺失或重复'); return matches[0][1].split(',').map(value => value.trim());
}
function platforms() {
  const start = workflow.indexOf('        include:\n'), end = workflow.indexOf('    steps:\n', start); if (start < 0 || end < start) throw Error('缺少平台include块');
  const entries = [...workflow.slice(start, end).matchAll(/^          - os: (.+)\n            label: (.+)\n            artifact: (.+)$/gm)].map(match => ({ os: match[1], label: match[2], artifact: match[3] })); return entries;
}
const steps = parseSteps(workflow), native = steps.filter(step => step.run?.startsWith('node scripts/sqlite-workspace-ci.mjs'));
/** 只接受精确suite判断；复杂表达式或always不允许扩大/缩减原生专项执行集合。 */
function suiteFor(step: Step): Suite {
  const condition = /^matrix\.suite == '(workspace|management-schema|management-rebuild|management-data)'$/.exec(step.condition ?? ''); if (!condition) throw Error('原生专项缺少准确suite条件'); return condition[1] as Suite;
}
function kindFor(step: Step): string { const match = /^node scripts\/sqlite-workspace-ci\.mjs ([a-z-]+)$/.exec(step.run ?? ''); if (!match) throw Error('专项命令不能追加timeout/重试/并发或shell指令'); return match[1]; }

/** 仅导入既有纯命令构造器检查实际spec与门槛，不执行任何native测试或进程。 */
const { sqliteOfflineCommand } = await import(new URL('../../scripts/sqlite-workspace-ci.mjs', import.meta.url).href);

describe('SQLite三平台四suite源码CI分片覆盖', () => {
  it('矩阵明确产生三平台×四suite，平台标签和产物前缀各准确唯一', () => {
    expect(axis('os')).toEqual(['windows-latest', 'macos-latest', 'macos-15-intel']); expect(axis('suite')).toEqual(['workspace', 'management-schema', 'management-rebuild', 'management-data']);
    expect(platforms()).toEqual([{ os: 'windows-latest', label: 'Windows x64', artifact: 'Windows-x64' }, { os: 'macos-latest', label: 'macOS arm64', artifact: 'macOS-arm64' }, { os: 'macos-15-intel', label: 'macOS x64', artifact: 'macOS-x64' }]);
    expect(new Set(platforms().map(value => value.os)).size).toBe(3); expect(workflow).toContain('runs-on: ${{ matrix.os }}'); expect(workflow).toContain('name: SQLite原工作区 · ${{ matrix.label }} · ${{ matrix.suite }}'); expect(workflow).toContain('fail-fast: false'); expect(workflow).toContain('cancel-in-progress: false');
  });
  it('原27项专项按11/7/2/7精确分片，不遗漏或重复；每个平台合计每项恰好一次', () => {
    expect(native).toHaveLength(27); expect(native.map(kindFor)).toEqual(originalKinds); expect(allExpected.map(value => value[0]).sort()).toEqual([...originalKinds].sort()); expect(new Set(native.map(kindFor)).size).toBe(27);
    expect(Object.values(expected).map(value => value.length)).toEqual([11, 7, 2, 7]);
    for (const suite of axis('suite') as Suite[]) expect(native.filter(step => suiteFor(step) === suite).map(kindFor)).toEqual(expected[suite].map(value => value[0]));
    for (const os of axis('os')) {
      const calls = (axis('suite') as Suite[]).flatMap(suite => native.filter(step => suiteFor(step) === suite).map(step => ({ os, suite, kind: kindFor(step) })));
      expect(calls).toHaveLength(27); for (const kind of originalKinds) expect(calls.filter(call => call.kind === kind)).toHaveLength(1);
    }
  });
  it('每个job完整checkout、Node24、锁文件安装、Electron与源码构建，不用产物替代另一suite的同源准备', () => {
    expect(steps.filter(step => step.uses === 'actions/checkout@v4')).toHaveLength(1); expect(steps.find(step => step.uses === 'actions/checkout@v4')?.raw).toContain('persist-credentials: false');
    const node = steps.find(step => step.uses === 'actions/setup-node@v4'); expect(node?.raw).toContain("node-version: '24'"); expect(node?.condition).toBeUndefined();
    for (const run of ['corepack enable', 'pnpm install --frozen-lockfile', 'pnpm exec install-electron', 'pnpm build']) { const setup = steps.filter(step => step.run === run); expect(setup).toHaveLength(1); expect(setup[0].condition).toBeUndefined(); expect(steps.indexOf(setup[0])).toBeLessThan(steps.indexOf(native[0])); }
    const guards = steps.filter(step => step.run === 'pnpm exec vitest run tests/unit/sqlite-ci-shards.test.ts tests/unit/sqlite-offline-ci.test.ts'); expect(guards).toHaveLength(1); expect(guards[0].condition).toBeUndefined(); expect(steps.indexOf(guards[0])).toBeLessThan(steps.indexOf(native[0]));
    for (const path of ['tests/unit/sqlite-ci-shards.test.ts', 'tests/unit/sqlite-offline-ci.test.ts']) expect(workflow.split("      - '" + path + "'").length - 1).toBe(2);
    expect(workflow).not.toMatch(/^    if:/m); expect(workflow).not.toContain('continue-on-error:');
  });
  it.each(allExpected)('%s仍用原准确spec、120秒、单worker、零重试，无额外参数扩大门槛', (kind, spec) => {
    const args: string[] = sqliteOfflineCommand(kind); expect(args).toContain('tests/e2e/' + spec); expect(args).toContain('--workers=1'); expect(args).toContain('--retries=0'); expect(args).toContain('--trace=off'); expect(args.filter(value => value.startsWith('--workers='))).toEqual(['--workers=1']); expect(args.filter(value => value.startsWith('--retries='))).toEqual(['--retries=0']); expect(args.some(value => /timeout|repeat-each|grep/.test(value))).toBe(false);
    const source = readFileSync(new URL('../../tests/e2e/' + spec, import.meta.url), 'utf8'); expect(source).toMatch(/test\.describe\.configure\(\{\s*timeout:\s*120000,\s*retries:\s*0\s*\}\)/); expect(source).toContain('info.timeout !== 120000'); expect(source).toContain('info.retry !== 0'); expect(source).toContain('info.config.workers !== 1');
  });
  it('每job总时限仍20分钟，上传always含27项目录，十二个artifact命名无冲突且保留原轮现场', () => {
    expect([...workflow.matchAll(/^    timeout-minutes: (\d+)$/gm)].map(match => match[1])).toEqual(['20']);
    const upload = steps.filter(step => step.uses === 'actions/upload-artifact@v4'); expect(upload).toHaveLength(1); expect(upload[0].condition).toBe('always()'); expect(upload[0].raw).toContain('if-no-files-found: warn');
    const paths = [...upload[0].raw.matchAll(/^            test-results\/([a-z-]+)\/$/gm)].map(match => match[1]); expect(paths).toHaveLength(27); expect([...paths].sort()).toEqual(allExpected.map(value => value[2]).sort()); expect(new Set(paths).size).toBe(27);
    const template = /^          name: (.+)$/m.exec(upload[0].raw)?.[1]; expect(template).toBe('SQLite原工作区-${{ matrix.artifact }}-${{ matrix.suite }}-${{ github.run_id }}-${{ github.run_attempt }}');
    const artifactNames = platforms().flatMap(platform => axis('suite').map(suite => template!.replace('${{ matrix.artifact }}', platform.artifact).replace('${{ matrix.suite }}', suite).replace('${{ github.run_id }}', 'fixed-run').replace('${{ github.run_attempt }}', '1'))); expect(new Set(artifactNames).size).toBe(12);
    expect(workflow).toContain('group: ${{ github.workflow }}-${{ github.ref }}-${{ github.run_id }}-${{ github.run_attempt }}');
  });
});
