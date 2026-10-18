import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { verifyHistoryExitCompatibility } from '../helpers/historyExitObservationCompatibility';

const source = readFileSync(new URL('../e2e/desktop-fixture.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const parse = (text: string) => ts.createSourceFile('desktop.ts', text, ts.ScriptTarget.Latest, true);

it('去除逐项观察差异后，原退出顺序、强制兜底、准备启动、确认权限与清理AST均保持', () => {
  const proof = verifyHistoryExitCompatibility(parse(source));
  expect(proof.baselineRevision).toBe('ff462366e2f7fbba06ced95e1048aa4404da68eb');
  expect(proof.reviewedHead).toBe('9057178829b892b6e820337e1b8341ba6e548758');
  for (const name of ['forceStopOwnProcess', 'launchPreparedOwnedDesktop', 'confirmOwnedDesktopExit', 'quitOwnedDesktop', 'bindOwnedDesktopExit', 'strictBranch']) expect(proof.reviewedHashes[name]).toBe(proof.baselineHashes[name]);
});

// 只修改内存源码，不执行夹具；反例必须由AST差异或精确观察片段缺失先行拒绝。
it.each([
  ['close原期限', "desktop.waitForEvent('close', { timeout: 12000 })", "desktop.waitForEvent('close', { timeout: 12001 })"],
  ['强制兜底前置条件', 'if (closed) return;', 'if (false) return;'],
  ['准备启动读取PID前归属', 'own(); const ids = await localApplication.evaluate', 'const ids = await localApplication.evaluate'],
  ['确认真实close权限', 'if (state.confirmed && state.closed) return;', 'if (state.confirmed) return;'],
  ['默认清理目录边界', "!basename(dataDir).startsWith('dbark-e2e-')", 'false'],
  ['显式清理目录边界', "!basename(directory).startsWith('dbark-e2e-')", 'false'],
  ['默认清理动作增加', 'await forceStopOwnProcess();', 'await quitDesktop(); await forceStopOwnProcess();'],
  ['原退出与ready先后', 'await requestQuit(method, { observation: exitObservation, application: observedApplication });await Promise.race([quitReady,exited]);', 'await Promise.race([quitReady,exited]);await requestQuit(method, { observation: exitObservation, application: observedApplication });'],
])('%s发生行为漂移时独立证明拒绝，不能只换新hash放行', (_name, before, after) => {
  expect(source.split(before)).toHaveLength(2);
  expect(() => verifyHistoryExitCompatibility(parse(source.replace(before, after)))).toThrow(/AST不一致|观察差异必须/);
});
