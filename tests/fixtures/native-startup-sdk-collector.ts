import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

interface Collector { log(text: string): void; onMessage(listener: (text: string) => void): void; recentLogs(): string[]; }
let cached: (new () => Collector) | undefined;
/** 只提取1.64.0实际日志缓存类；不导入Playwright运行时、不创建真实应用或连接。 */
export function nativeStartupSdkCollector(): new () => Collector {
  if (cached) return cached;
  const require = createRequire(import.meta.url), metadata = require.resolve('playwright-core/package.json', { paths: [dirname(require.resolve('@playwright/test'))] });
  if (JSON.parse(readFileSync(metadata, 'utf8')).version !== '1.64.0') throw Error('启动观察RAM端口需要锁定SDK');
  const source = readFileSync(join(dirname(metadata), 'lib/coreBundle.js'), 'utf8'), tree = ts.createSourceFile('sdk.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let text = '';
  function visit(node: ts.Node) { if (ts.isBinaryExpression(node) && node.left.getText(tree) === 'RecentLogsCollector' && ts.isClassExpression(node.right)) text = node.right.getText(tree); ts.forEachChild(node, visit); }
  visit(tree); if (!text) throw Error('固定SDK原日志缓存类缺失');
  return cached = runInNewContext('(' + text + ')', { kLogCount: 150 }) as new () => Collector;
}
