import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

const live = readFileSync(new URL('../e2e/query-file-shortcut-native-live.ts', import.meta.url), 'utf8');

/** 回放真实失败收尾，验证原断言、附录及自有句柄关闭故障都能留下；不创建原生资源。 */
it.each([[false, false], [true, false], [false, true], [true, true]])('快捷键原失败遇到附录故障%s和句柄故障%s仍完整保留', async (attachmentFails, closeFails) => {
  const tree = ts.createSourceFile('live.ts', live, ts.ScriptTarget.Latest, true);
  let envelope: ts.TryStatement | undefined;
  function visit(node: ts.Node) {
    if (ts.isTryStatement(node) && node.catchClause?.getText(tree).includes("info.attach('单次文件保存快捷键保留现场'") && node.finallyBlock) envelope = node;
    ts.forEachChild(node, visit);
  }
  visit(tree); expect(envelope).toBeDefined();
  const original = Error('原保存断言失败'), attachment = Error('内存附录失败'), closing = Error('原句柄关闭失败');
  const forbidden = vi.fn(() => { throw Error('不得在失败后补SDK、路径或保存'); });
  const mainLog = { frames: [], stop: vi.fn() }, log = { events: [], stop: vi.fn() };
  const cleanupMain = vi.fn(), cleanupConsole = vi.fn(), closeHandles = vi.fn(async () => { if (closeFails) throw closing; });
  const files = { records: [], closeHandles, read: forbidden }, run = { retained: false, path: 'RAM原目录', owners: [], close: forbidden, finish: forbidden };
  const info = { attach: vi.fn(async () => { if (attachmentFails) throw attachment; }) };
  // 仅将主体替换成确定的原错误，catch/finally始终从真实live提取，不另写一套聚合器。
  const body = ts.factory.createBlock([ts.factory.createThrowStatement(ts.factory.createIdentifier('original'))], true);
  const action = ts.factory.updateTryStatement(envelope!, body, envelope!.catchClause, envelope!.finallyBlock);
  const statement = ts.createPrinter().printNode(ts.EmitHint.Unspecified, action, tree);
  const source = ts.transpileModule('(async()=>{let failure,removeMain=cleanupMain,removeConsole=cleanupConsole;'+statement+'})()', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let rejected: unknown;
  try { await runInNewContext(source, { original, files, run, info, mainLog, log, cleanupMain, cleanupConsole, presses: 1, mainWindow: {}, observationFailure: undefined, AggregateError, Buffer }); }
  catch (reason) { rejected = reason; }
  const flatten = (error: unknown): unknown[] => error instanceof AggregateError ? error.errors.flatMap(flatten) : [error];
  expect(flatten(rejected)).toEqual([original, ...(attachmentFails ? [attachment] : []), ...(closeFails ? [closing] : [])]);
  expect(info.attach).toHaveBeenCalledOnce(); expect(closeHandles).toHaveBeenCalledOnce(); expect(run.retained).toBe(true);
  expect(cleanupMain).toHaveBeenCalledOnce(); expect(cleanupConsole).toHaveBeenCalledOnce(); expect(forbidden).not.toHaveBeenCalled();
});
