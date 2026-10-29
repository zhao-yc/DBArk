import { workspaceCommandSource } from '../helpers/workspaceCommandSource';
import React, { useLayoutEffect } from 'react';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { QueryCloseQueue } from '../../src/renderer/queryCloseQueue';
import { QueryCloseRequests } from '../../src/renderer/queryCloseIntent';
import { queryCloseZh } from '../../src/renderer/locales/queryClose.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

/** 从真实工作台提取四个方法、注册命令和准确layout effect；仅用RAM按钮投递原命令，不证明原生菜单布局。 */
export function appFunctions(environment: Record<string, unknown>) {
  const text = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), methods: string[] = [];
  const registration = workspaceCommandSource(text, 'close-other-queries'); let layout = '';
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && ['closeTab', 'closeOtherQueries', 'finishQueryClose', 'commitQueryClose'].includes(node.name?.text ?? '')) methods.push(node.getText(tree));
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useLayoutEffect' && node.arguments[0]?.getText(tree).includes('commitQueryClose(queryCloseCommit, queryCloseRequest)')) layout = node.getText(tree);
    ts.forEachChild(node, visit);
  }; visit(tree); if (methods.length !== 4 || !layout) throw Error('真实App队列提交接线缺失');
  const context = createContext({ React, useLayoutEffect, QueryCloseQueue, QueryCloseRequests, queryCloseZh, zh, ...environment });
  const code = methods.join('\n') + '\nglobalThis.closeSides=closeOtherQueries;globalThis.finish=finishQueryClose;globalThis.entry=(settings,activeTab,closingOtherQueries)=>{const state=useWorkspace.getState(),ready=true,queryCloseRequest=undefined;const ' + registration.available + ';const ' + registration.handler + ';const command=(' + registration.command + ');return React.createElement("button",{"data-ram-command":"close-other-queries",disabled:!command.enabled,onClick:command.run},queryCloseZh.others);};globalThis.layout=(queryCloseCommit,queryCloseRequest,settings)=>{' + layout + ';};';
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  return context as any;
}
