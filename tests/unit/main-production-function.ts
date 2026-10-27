import ts from 'typescript';

/** 只提取唯一的生产顶层函数，禁止启动接线变化时把相邻bootstrap误当函数执行。 */
export function extractMainProductionFunction(source: string, name: string): string {
  const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches = tree.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (matches.length !== 1 || !matches[0].body) throw Error(`生产main必须含唯一且完整的顶层函数：${name}`);
  return matches[0].getText(tree);
}
