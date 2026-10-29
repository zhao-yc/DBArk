import ts from 'typescript';

/** 精确提取工作台已声明的命令与原包装器；RAM夹具不复制业务处理或旧按钮。 */
export function workspaceCommandSource(source: string, id: string) {
  const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const app = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'WorkspaceApp') as ts.FunctionDeclaration | undefined;
  if (!app?.body) throw Error('真实工作台方法缺失');
  let handler = '', available = '', command = '';
  for (const statement of app.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const node of statement.declarationList.declarations) {
      if (node.name.getText(tree) === 'handler') handler = node.getText(tree);
      if (node.name.getText(tree) === 'available') available = node.getText(tree);
      if (node.name.getText(tree) === 'appCommands' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        const item = node.initializer.properties.find(property => ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name) && property.name.text === id);
        if (item && ts.isPropertyAssignment(item)) command = item.initializer.getText(tree);
      }
    }
  }
  if (!handler || !available || !command) throw Error('真实工作台命令接线缺失：' + id);
  return { handler, available, command };
}
