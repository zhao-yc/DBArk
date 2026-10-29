import ts from 'typescript';
import { workspaceCommandSource } from './workspaceCommandSource';

/** 提取正式工具菜单及唯一命令，夹具只提供DOM和外界端口，不复制业务按钮。 */
export function workspaceToolCommandSource(source: string, toolbar: string, id: string) {
  const registration = workspaceCommandSource(source, id);
  const tree = ts.createSourceFile('NavigationToolbar.tsx', toolbar, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let command = '', tools = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'command') command = node.getText(tree);
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'toolActions') tools = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!command || !tools) throw Error('真实工具菜单接线缺失');
  return `const state=useWorkspace(),settings=state.settings,ready=true,closingOtherQueries=false,queryCloseRequest=undefined;const ${registration.available};const ${registration.handler};const registered=${registration.command};const commands={enabled:id=>id===${JSON.stringify(id)}&&registered.enabled,checked:id=>id===${JSON.stringify(id)}&&registered.checked,run:id=>{if(id===${JSON.stringify(id)}&&registered.enabled)registered.run();}};const ${command};const ${tools};`;
}
