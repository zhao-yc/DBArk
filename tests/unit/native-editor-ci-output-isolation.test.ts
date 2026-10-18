import { createRequire } from 'node:module';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url), testRequire = createRequire(require.resolve('@playwright/test/package.json'));
const playwrightPath = testRequire.resolve('playwright/package.json'), playwrightRequire = createRequire(playwrightPath);
const version = JSON.parse(readFileSync(playwrightPath, 'utf8')).version;
const bundle = readFileSync(join(dirname(playwrightPath), 'lib/runner/index.js'), 'utf8');
const tree = ts.createSourceFile('runner.js', bundle, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const cleanupNode = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createRemoveOutputDirsTask');
if (!cleanupNode) throw Error('缺少锁定Playwright的原输出清理函数');
const { removeFolders } = playwrightRequire('playwright-core/lib/coreBundle').utils;
// 原函数与原removeFolders均直接消费，只在本人合成临时目录执行，不启动Playwright runner或产品。
const cleanup = runInNewContext('(' + cleanupNode.getText(tree) + ')', { removeFolders4: removeFolders });
const script = readFileSync(new URL('../../scripts/test-packaged.mjs', import.meta.url), 'utf8');
const scriptTree = ts.createSourceFile('test-packaged.mjs', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let installedArguments = '';
/** 定位原安装脚本实际Playwright参数数组，不能让测试另写一个理想输出目录。 */
function findArguments(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(scriptTree) === 'command' && node.arguments[1] && ts.isArrayLiteralExpression(node.arguments[1]) && node.arguments[1].elements.some(value => ts.isStringLiteral(value) && value.text === 'test')) installedArguments = node.arguments[1].getText(scriptTree);
  ts.forEachChild(node, findArguments);
}
findArguments(scriptTree); if (!installedArguments) throw Error('未定位原安装Playwright调用');
const directories: string[] = [];
/** 原SDK递归删除及测试收尾前均核绝对/真实路径，不能删除本任务自建根之外的位置。 */
function owned(path: string, root: string) {
  const part = relative(root, resolve(path));
  if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part) || lstatSync(path).isSymbolicLink() || realpathSync(path) !== resolve(path)) throw Error('拒绝清理本任务所属范围之外的路径');
}
afterEach(() => { for (const directory of directories.splice(0)) { owned(directory, resolve('.cache/native-ci-output-tests')); rmSync(directory, { recursive: true, force: true }); } });
/** 每个用例只建自己的缓存目录，结束只移除该固定根。 */
function fixture() {
  const parent = resolve('.cache/native-ci-output-tests'); mkdirSync(parent, { recursive: true });
  const project = mkdtempSync(join(parent, '独立-')); directories.push(project);
  const evidence = join(project, 'test-results/native-editor-ci'); mkdirSync(evidence, { recursive: true });
  const files = ['source-approval.json', 'installed-approval.json', 'source-indent-manifest.json', 'installed-layout-manifest.json', 'source-indent/report.json', 'installed-layout/accepted.json'];
  const bytes = Buffer.from('合成批准及原专项终态，不可被普通回归删除');
  for (const name of files) { mkdirSync(dirname(join(evidence, name)), { recursive: true }); writeFileSync(join(evidence, name), bytes); }
  return { project, evidence, files, bytes };
}
/** 在RAM中读取实际安装参数，不另造一个与产品脚本无关的理想参数数组。 */
function argumentsFor(project: string, enabled: boolean) { return runInNewContext(installedArguments, { project, join, process: { env: enabled ? { DBARK_NATIVE_EDITOR_CI: '1' } : {} } }) as string[]; }
/** 从真实命令选项推导清理范围；未启用新CI时保留原默认目录。 */
function outputFor(project: string, args: string[]) { const item = args.find(value => value.startsWith('--output=')); return item ? resolve(project, item.slice('--output='.length)) : join(project, 'test-results'); }

describe('原PW清理下源码与安装回归的输出隔离', () => {
  it.each(['source', 'installed'] as const)('%s普通回归只清自己的输出，保留批准及两专项证据', async phase => {
    expect(version).toBe('1.64.0'); const f = fixture();
    const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const sourceArgs = workflow.match(/- run: pnpm exec playwright test([^\r\n]*)/)?.[1].trim().split(/\s+/).filter(Boolean) ?? [];
    const outputDir = outputFor(f.project, phase === 'source' ? sourceArgs : argumentsFor(f.project, true));
    mkdirSync(outputDir, { recursive: true }); const disposable = join(outputDir, '旧回归残留.txt'); writeFileSync(disposable, '只清理此目录');
    owned(outputDir, f.project);
    await cleanup().setup({ options: {}, filteredProjects: [{ project: { outputDir } }] });
    expect(existsSync(disposable)).toBe(false);
    for (const name of f.files) expect(existsSync(join(f.evidence, name)), '原批准/专项证据应保留：' + name).toBe(true);
    for (const name of f.files) expect(readFileSync(join(f.evidence, name))).toEqual(f.bytes);
  });
  it('未启用新专项的独立安装调用保持旧默认参数', () => {
    const f = fixture(); expect(argumentsFor(f.project, false)).toEqual([join(f.project, 'node_modules/@playwright/test/cli.js'), 'test']);
  });
});
