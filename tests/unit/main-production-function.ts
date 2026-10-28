import ts from 'typescript';

/** 只提取唯一的生产顶层函数，禁止启动接线变化时把相邻bootstrap误当函数执行。 */
export function extractMainProductionFunction(source: string, name: string): string {
  const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches = tree.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (matches.length !== 1 || !matches[0].body) throw Error(`生产main必须含唯一且完整的顶层函数：${name}`);
  return matches[0].getText(tree);
}

/** 唯一顶层能力初始化必须来自生产AST，不能以固定返回值替代真实归属及回收守卫。 */
export function extractMainProductionBinding(source: string, name: string): string {
  const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches = tree.statements.filter((node): node is ts.VariableStatement => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name));
  if (matches.length !== 1 || matches[0].declarationList.declarations.length !== 1 || !matches[0].declarationList.declarations[0].initializer) throw Error(`生产main必须含唯一且完整的顶层初始化：${name}`);
  return matches[0].getText(tree);
}
