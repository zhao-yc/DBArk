import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';

interface Baseline { baselineRevision: string; reviewedHead: string; baseline: Record<string, string>; baselineHashes: Record<string, string>; reviewedHashes: Record<string, string>; }
const frozen = JSON.parse(readFileSync(new URL('../fixtures/history-exit-observation-baseline.json', import.meta.url), 'utf8')) as Baseline;
/** 旧证据和已审新片段统一按Git规范化后的UTF-8字节锁定。 */
export const compatibilityHash = (value: string) => createHash('sha256').update(value).digest('hex');

/** 精确查找strict分支，前置观察语句不能再被误认成旧模式分支。 */
export function historyExitCompatibilitySegments(tree: ts.SourceFile): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && ['launchDesktop', 'requestQuit', 'quitDesktop', 'forceStopOwnProcess', 'launchPreparedOwnedDesktop', 'confirmOwnedDesktopExit', 'quitOwnedDesktop', 'bindOwnedDesktopExit'].includes(node.name?.text ?? '')) result[node.name!.text] = node.getText(tree);
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'desktopLifetime' && ts.isArrayLiteralExpression(node.initializer)) {
      const fn = node.initializer.elements[0] as ts.ArrowFunction, body = fn.body as ts.Block;
      const strict = body.statements.find(statement => ts.isIfStatement(statement) && statement.expression.getText(tree) === 'preserveOnUnconfirmedExit');
      assert.ok(strict, '缺少原strict分支');
      result.strictBranch = strict.getText(tree); result.defaultLifetime = tree.text.slice(strict.end, body.end - 1);
      result.lifetimePrelude = body.statements.filter(statement => statement.end <= strict.pos).map(statement => statement.getText(tree)).join('\n');
      result.lifetimeParameters = fn.parameters.map(parameter => parameter.getText(tree)).join(',');
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.equal(Object.keys(result).length, 12, '敏感片段必须完整提取'); return result;
}

/** 只撤销已逐项核对的观察差异，任何片段缺失或重复都拒绝；没有宽泛删除规则。 */
function once(text: string, before: string, after = ''): string {
  const offset = text.indexOf(before); assert.ok(offset >= 0 && text.indexOf(before, offset + before.length) < 0, '观察差异必须恰好出现一次：' + before);
  return text.slice(0, offset) + after + text.slice(offset + before.length);
}

/** 观察项仅涉及记录器、事件、原错误重抛包装和参数透传，不删除任何原退出动作。 */
export function withoutHistoryExitObservation(name: string, value: string): string {
  let text = value;
  if (name === 'launchDesktop') {
    text = once(text, ', observationInfo?: TestInfo');
    text = once(text, 'const exitObservation = historyExitObservationFor(observationInfo);');
    text = once(text, 'const observedApplication = desktop; exitObservation?.bind(observedApplication);');
    text = once(text, " exitObservation?.mark(observedApplication, 'close');");
    text = once(text, "{ const call = JSON.parse(text.slice('DBARK_E2E_DIALOG:'.length)) as RecordedDialog; dialogCalls.push(call); exitObservation?.dialog(observedApplication, call); }", "dialogCalls.push(JSON.parse(text.slice('DBARK_E2E_DIALOG:'.length)) as RecordedDialog);");
    return once(text, "{ exitObservation?.mark(observedApplication, 'will-quit-marker'); ready(); exitObservation?.mark(observedApplication, 'quit-ready'); }", 'ready();');
  }
  if (name === 'requestQuit') {
    text = once(text, ', observationContext?: { observation: HistoryExitObservation | undefined; application: ElectronApplication }');
    text = once(text, 'const exitObservation = observationContext ? observationContext.observation : historyExitObservationFor(undefined), observedApplication = observationContext?.application ?? desktop;');
    text = once(text, "exitObservation?.mark(observedApplication, method === 'window' ? 'request-window' : 'request-app');");
    text = once(text, 'try {'); text = once(text, "exitObservation?.mark(observedApplication, 'request-returned');");
    return once(text, "} catch (reason) { exitObservation?.mark(observedApplication, 'request-error'); throw reason; }");
  }
  if (name === 'quitDesktop') {
    text = once(text, ', observationInfo?: TestInfo');
    text = once(text, 'const exitObservation = historyExitObservationFor(observationInfo), observedApplication = desktop;');
    for (const kind of ['quit-start', 'close-wait-start', 'quit-race-returned', 'quit-complete']) text = once(text, `exitObservation?.mark(observedApplication, '${kind}');`);
    text = once(text, 'try {\n    if (snippetsDiagnostics)', 'if (snippetsDiagnostics)');
    text = once(text, "} catch (reason) { exitObservation?.mark(observedApplication, 'quit-error'); throw reason; }");
    text = once(text, 'requestQuit(method, { observation: exitObservation, application: observedApplication })', 'requestQuit(method)');
    return once(text, "{ exitObservation?.mark(observedApplication, 'desktop-close-enter'); await desktop.close(); exitObservation?.mark(observedApplication, 'desktop-close-returned'); }", 'await desktop.close();');
  }
  if (name === 'defaultLifetime') {
    text = once(text, 'const exitObservation = beginHistoryExitObservation(historyExitObservation, testInfo, trace);');
    text = once(text, 'launchDesktop(undefined, testInfo)', 'launchDesktop()'); text = once(text, "quitDesktop('app', testInfo)", 'quitDesktop()');
    text = once(text, 'exitObservation?.beginTeardown(); let teardownCompleted = false;');
    text = once(text, 'try {\n        try {', 'try {');
    return once(text, '        teardownCompleted = true;\n      } finally { if (exitObservation) { exitObservation.endTeardown(teardownCompleted); await exitObservation.finish(); } }');
  }
  return text;
}

/** AST保留节点种类、字面量和所有子节点顺序，仅忽略注释、空白及源位置。 */
export function compatibilityAst(text: string): unknown {
  const tree = ts.createSourceFile('frozen.ts', text, ts.ScriptTarget.Latest, true);
  function shape(node: ts.Node): unknown { const children: unknown[] = []; ts.forEachChild(node, child => { children.push(shape(child)); }); return [node.kind, children.length ? children : node.getText(tree)]; }
  return shape(tree);
}

/** 先证明去观察AST与冻结旧实现相等，再锁9057新原文；旧hash保留为独立证据。 */
export function verifyHistoryExitCompatibility(tree: ts.SourceFile): Baseline {
  const current = historyExitCompatibilitySegments(tree);
  for (const [name, original] of Object.entries(frozen.baseline)) {
    assert.equal(compatibilityHash(original), frozen.baselineHashes[name], '旧基线字节漂移：' + name);
    if (name === 'lifetimePrelude') {
      assert.equal(current[name], "assertHistoryExitObservationScope(historyExitObservation, testInfo, trace);\nif (historyExitObservation && preserveOnUnconfirmedExit) throw new Error('历史退出观察只允许原默认退出夹具');\nif (!historyExitObservation) beginHistoryExitObservation(false, testInfo, trace);");
      assert.equal(original, '');
    } else {
      const restored = name === 'lifetimeParameters' ? once(current[name], ', historyExitObservation') : withoutHistoryExitObservation(name, current[name]);
      const wrap = (text: string) => name === 'defaultLifetime' ? 'async () => {' + text + '\n}' : name === 'lifetimeParameters' ? '(' + text + ') => {}' : text;
      assert.deepEqual(compatibilityAst(wrap(restored)), compatibilityAst(wrap(original)), '去观察后生命周期AST不一致：' + name);
    }
    assert.equal(compatibilityHash(current[name]), frozen.reviewedHashes[name], '已核对的新代码字节漂移：' + name);
  }
  return frozen;
}
