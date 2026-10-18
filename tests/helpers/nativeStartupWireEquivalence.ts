import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

/** 冻结9057原文仅作为数据，不导入正式Main/E2E或执行原生动作。 */
export const nativeStartupBaseline = JSON.parse(readFileSync(new URL('../fixtures/native-startup-wire-baseline.json', import.meta.url), 'utf8')) as { revision: string; runtime: string; appInfo: string; gate: string; originalAttachment: string; otherRuntimeFunctions: string[]; hashes: Record<string, string>; fileCounts: { awaits: number; guards: number }; functionCounts: { awaits: number; guards: number } };
export const parseStartupSource = (source: string) => ts.createSourceFile('source.ts', source.replaceAll('\r\n', '\n'), ts.ScriptTarget.Latest, true);
const printer = ts.createPrinter({ removeComments: true });

/** 规范化只消除注释与排版，保留所有标识符、字面量及节点顺序。 */
export function startupAst(source: string): string {
  const tree = parseStartupSource(source);
  function shape(node: ts.Node): unknown { const children: unknown[] = []; ts.forEachChild(node, child => { children.push(shape(child)); }); return [node.kind, children.length ? children : node.kind <= ts.SyntaxKind.LastToken ? node.getText(tree) : []]; }
  return JSON.stringify(shape(tree));
}
export function startupFunction(tree: ts.SourceFile, name: string): ts.FunctionDeclaration { const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name); assert.ok(fn && ts.isFunctionDeclaration(fn)); return fn; }
export function startupCounts(tree: ts.SourceFile) { let awaits = 0, guards = 0; function visit(node: ts.Node) { if (ts.isAwaitExpression(node)) awaits++; if (ts.isCallExpression(node) && node.expression.getText(tree) === 'guard') guards++; ts.forEachChild(node, visit); } visit(tree); return { awaits, guards }; }

/** 只接纳固定源码诊断闭包；包含其他调用、正文或额外副作用时不能剥离。 */
function assertMark(statement: ts.Statement, source: ts.SourceFile, hook: boolean) {
  const condition = hook ? "typeof value !== 'string' && value.wire" : 'wire';
  const expected = `const mark = (code: number) => { if (${condition}) try { console.log('DBARK_STARTUP_V1:' + code); } catch { try { console.error('DBARK_STARTUP_V1:99'); } catch {} } };`;
  assert.equal(startupAst(statement.getText(source)), startupAst(expected), '固定标记闭包发生非观察差异');
}

/** 仅去除指定枚举的mark语句；每个调用及其代码必须按原审查顺序完整出现。 */
function removeMarks(body: ts.Block, source: ts.SourceFile, hook: boolean): ts.Block {
  assertMark(body.statements[0], source, hook);
  const found: number[] = [], allowed = hook ? [20, 21, 22, 23, 24] : [1, 2, 3, 4, 5, 6, 7, 8];
  const result = ts.transform(body, [context => root => {
    const visit: ts.Visitor = node => {
      if (node === body.statements[0]) return undefined;
      if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'mark') {
        assert.equal(node.expression.arguments.length, 1); const code = node.expression.arguments[0]; assert.ok(ts.isNumericLiteral(code)); found.push(Number(code.text)); return undefined;
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.Block;
  }]);
  assert.deepEqual(found, allowed, '固定标记数量或顺序发生漂移'); const block = result.transformed[0]; result.dispose(); return block;
}

/** 展开局部变量，重建原对象字面量；原每个属性的initializer及顺序必须一对一保持。 */
function objectFromVariables(statements: readonly ts.Statement[], source: ts.SourceFile, fields: string[]) {
  assert.ok(statements.length > 1 && ts.isReturnStatement(statements.at(-1)!));
  const returned = (statements.at(-1)! as ts.ReturnStatement).expression!; assert.ok(ts.isObjectLiteralExpression(returned));
  assert.deepEqual(returned.properties.map(property => { assert.ok(ts.isShorthandPropertyAssignment(property)); return property.name.text; }), fields);
  const declarations = statements.slice(0, -1).flatMap(statement => { assert.ok(ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Const); return [...statement.declarationList.declarations]; });
  assert.deepEqual(declarations.map(declaration => declaration.name.getText(source)), fields);
  return ts.factory.createObjectLiteralExpression(declarations.map(declaration => { assert.ok(ts.isIdentifier(declaration.name) && declaration.initializer); return ts.factory.createPropertyAssignment(declaration.name.text, declaration.initializer); }));
}

/** 精确剥离新增诊断接线，重建两个原RPC及原console判定；不能匹配时立即拒绝。 */
export function runtimeWithoutStartupWire(text: string): string {
  assert.equal(text.split('; observationActive?(): boolean').length, 2);
  const source = parseStartupSource(text.replace('; observationActive?(): boolean', ''));
  let sources = 0, hooks = 0, observers = 0, consoles = 0, stops = 0;
  const transformed = ts.transform(source, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isIfStatement(node) && node.expression.getText(source) === 'progressActive && binding.observationActive') {
        assert.equal(startupAst(node.getText(source)), startupAst('if (progressActive && binding.observationActive) owner.startupWire = observeNativeStartupWire(application, child, () => !!binding.observationActive?.() && !run.retained && !run.removed && run.owners.at(-1) === owner && owner.application === own.application && owner.page === own.page && !own.quitting && !own.closed && !owner.confirmed);'));
        observers++; return undefined;
      }
      if (ts.isExpressionStatement(node) && node.getText(source) === 'owner.startupWire?.stop();') { stops++; return undefined; }
      if (ts.isArrowFunction(node) && ts.isBlock(node.body) && node.body.statements[0]?.getText(source) === 'const text = message.text();') {
        assert.equal(node.body.statements.length, 3); assert.equal(node.body.statements[1].getText(source), 'owner.startupWire?.console(text);');
        const condition = node.body.statements[2]; assert.ok(ts.isIfStatement(condition) && condition.expression.getText(source) === 'text === marker');
        const next = ts.factory.updateIfStatement(condition, ts.factory.createBinaryExpression(ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('message'), 'text'), undefined, []), ts.SyntaxKind.EqualsEqualsEqualsToken, ts.factory.createIdentifier('marker')), condition.thenStatement, condition.elseStatement);
        consoles++; return ts.factory.updateArrowFunction(node, node.modifiers, node.typeParameters, node.parameters, node.type, node.equalsGreaterThanToken, ts.factory.createBlock([next]));
      }
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'own.application.evaluate' && ts.isArrowFunction(node.arguments[0]) && ts.isBlock(node.arguments[0].body)) {
        const fn = node.arguments[0], body = fn.body as ts.Block;
        if (body.statements[0].getText(source).startsWith('const mark =')) {
          const isHook = fn.parameters.length === 2 && fn.parameters[1].name.getText(source) === 'value', stripped = removeMarks(body, source, isHook);
          if (isHook) {
            assert.equal(node.arguments[1].getText(source), 'progressActive ? { marker: own.marker, ...(owner.startupWire && !owner.startupWire.data.stopped ? { wire: true } : {}) } : own.marker');
            const argument = (parseStartupSource('const value = progressActive ? { marker: own.marker } : own.marker;').statements[0] as ts.VariableStatement).declarationList.declarations[0].initializer!;
            hooks++; return ts.factory.updateCallExpression(node, node.expression, node.typeArguments, [ts.factory.updateArrowFunction(fn, fn.modifiers, fn.typeParameters, fn.parameters, fn.type, fn.equalsGreaterThanToken, stripped), argument]);
          }
          assert.equal(node.arguments[1].getText(source), 'progressActive && !!owner.startupWire && !owner.startupWire.data.stopped && !own.page');
          const object = objectFromVariables([...stripped.statements], source, ['executable','appPath','resources','packaged','pid','parent','platform','metrics','windows']);
          sources++; return ts.factory.updateCallExpression(node, node.expression, node.typeArguments, [ts.factory.updateArrowFunction(fn, fn.modifiers, fn.typeParameters, fn.parameters.slice(0, 1), fn.type, fn.equalsGreaterThanToken, ts.factory.createParenthesizedExpression(object))]);
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  assert.deepEqual([sources, hooks, observers, consoles, stops], [1, 1, 1, 1, 1], '新增观察接线必须逐项匹配');
  const result = printer.printFile(transformed.transformed[0]); transformed.dispose(); return result;
}

/** Main原返回对象按原求值次序还原，四个固定marker不能包含原业务值。 */
export function appInfoWithoutStartupWire(tree: ts.SourceFile): string {
  let clause: ts.CaseClause | undefined; function visit(node: ts.Node) { if (ts.isCaseClause(node) && node.expression.getText(tree) === "'app.info'") clause = node; ts.forEachChild(node, visit); } visit(tree); assert.ok(clause);
  assert.equal(clause.statements.length, 1); const block = clause.statements[0]; assert.ok(ts.isBlock(block));
  const codes: number[] = [], real = block.statements.filter(statement => {
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(tree) === 'nativeStartupInfoMarker') { assert.equal(statement.expression.arguments.length, 1); const code = statement.expression.arguments[0]; assert.ok(ts.isNumericLiteral(code)); codes.push(Number(code.text)); return false; } return true;
  });
  assert.deepEqual(codes, [30, 31, 32, 33]);
  const object = objectFromVariables(real, tree, ['version','platform','encryptionAvailable','dataPath']);
  const restored = ts.factory.updateCaseClause(clause, clause.expression, [ts.factory.createReturnStatement(object)]);
  return printer.printNode(ts.EmitHint.Unspecified, restored, tree);
}

/** 原权限门只移除新增的纯观察方法，原assertCurrent/时钟/环境门主体逐字锁定。 */
export function gateWithoutStartupWire(text: string): string {
  const source = parseStartupSource(text); let removed = 0;
  const result = ts.transform(source, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'observationActive') {
        assert.equal(startupAst('const value = {' + node.getText(source) + '};'), startupAst("const value = { observationActive(): boolean { try { return !retained && currentInfo() === info && Object.hasOwn(info, '_startWallTime') === internal && info.startTime === startObject && readStart() === start && info.timeout === timeout && (info.status === undefined || info.status === 'passed'); } catch { return false; } } };"));
        removed++; return undefined;
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  assert.equal(removed, 1); const restored = printer.printFile(result.transformed[0]); result.dispose(); return restored;
}
