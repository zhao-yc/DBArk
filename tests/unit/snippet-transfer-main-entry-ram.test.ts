import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { TableChecksMainCapabilities, tableChecksFailureProgress } from '../../src/main/tableChecksMainCapabilities';
import { extractMainProductionBinding } from './main-production-function';
import { expect, it, vi } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { snippetTransferZh } from '../../src/shared/snippetTransfer';

const source = ts.createSourceFile('index.ts', readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const emit = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
/** 取正式Main函数AST运行；只保留该专属dispatch分支，其余路径遇到即失败，不启动Electron。 */
function main() {
  const dispatch = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'dispatch')!;
  // 按真实命令前缀找专属分支，不依赖dispatch中第一条语句的位置。
  const snippetBranches = dispatch.body!.statements.filter((node): node is ts.IfStatement => ts.isIfStatement(node) && ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression) && ts.isIdentifier(node.expression.expression.expression) && node.expression.expression.expression.text === 'command' && node.expression.expression.name.text === 'startsWith' && node.expression.arguments.length === 1 && ts.isStringLiteral(node.expression.arguments[0]) && node.expression.arguments[0].text === 'snippets.transfer');
  expect(snippetBranches).toHaveLength(1);
  let handler: ts.Expression | undefined;
  function visit(node: ts.Node): void { if (ts.isCallExpression(node) && node.expression.getText(source) === 'ipcMain.handle' && node.arguments[0]?.getText(source) === "'dbark:request'") handler = node.arguments[1]; ts.forEachChild(node, visit); } visit(source);
  expect(handler).toBeDefined(); let valid = true;
  const owner = { document: {} }, columns = { owner }, webContents = { mainFrame: { url: 'RAM渲染页' } }, event = { sender: webContents, senderFrame: webContents.mainFrame };
  const columnsMain = { capture: vi.fn(() => { if (!valid) throw Error('文档已失效'); return columns; }), assertCapturedOwner: vi.fn((value: unknown) => { if (value !== columns || !valid) throw Error('文档已失效'); }), hasUnpublished: () => false };
  const snippetTransfers = { open: vi.fn(() => ({ scopeId: 'RAM能力' })), preview: vi.fn(async () => null), export: vi.fn(async () => ({ count: 1 })), apply: vi.fn(() => ({ items: [], added: 0, replaced: 0, skipped: 0 })), cancel: vi.fn(() => ({ cancelled: true })) };
  const queryFileOperations=new Set<Promise<unknown>>();
  const context = createContext({ Error, TableChecksMainCapabilities, tableChecksFailureProgress, structureTokens: new Map(), columnsMain, snippetTransfers, snippetTransferZh, shuttingDown: false, window: { webContents }, rendererURL: 'RAM渲染页', tasks: new Map(), queryInsertExports: { has: () => false }, validateMainCommand: validateCommand, localSearchOperations: new Set(),queryFileOperations });
  runInContext(emit(`${extractMainProductionBinding(source.text, 'tableChecksMain')}\nasync function dispatch(command:any,input:any,columns?:any){${snippetBranches[0].getText(source)}throw Error('越界分派');}\nvar request=${handler!.getText(source)};`), context);
  return { request: context.request as (event: unknown, payload: unknown) => Promise<any>, event, columns, owner, snippetTransfers, columnsMain,queryFileOperations, invalidate() { valid = false; } };
}
it('五项正式IPC实际捕获Main文档、严格校验、进入专属dispatch并在回包前再次检查归属', async () => {
  const scopeId = '12345678-1234-4234-8234-123456789abc', h = main();
  for (const [command, input, method] of [
    ['snippets.transferOpen', {}, 'open'], ['snippets.transferPreview', { scopeId }, 'preview'], ['snippets.transferExport', { scopeId }, 'export'], ['snippets.transferApply', { scopeId, previewId: scopeId, decisions: [] }, 'apply'], ['snippets.transferCancel', { scopeId, close: true }, 'cancel'],
  ] as const) {
    expect(await h.request(h.event, { command, input })).toMatchObject({ ok: true }); expect(h.snippetTransfers[method]).toHaveBeenCalledTimes(1);
    const args = h.snippetTransfers[method].mock.calls[0] as unknown[]; const passedOwner = args[method === 'open' ? 0 : 1] as { document: object; assertCurrent(): void }; expect(passedOwner.document).toBe(h.owner.document); passedOwner.assertCurrent();
  }
  expect(h.columnsMain.capture).toHaveBeenCalledTimes(5); expect(h.columnsMain.assertCapturedOwner.mock.calls.length).toBeGreaterThanOrEqual(15);
});
it('真实入口拒绝另一个sender/frame及renderer路径，异步迟到结果不能返回旧文档', async () => {
  const h = main(), scopeId = '12345678-1234-4234-8234-123456789abc';
  for (const event of [{ ...h.event, sender: {} }, { ...h.event, senderFrame: { url: 'RAM渲染页' } }]) expect(await h.request(event, { command: 'snippets.transferOpen', input: {} })).toMatchObject({ ok: false });
  expect(await h.request(h.event, { command: 'snippets.transferPreview', input: { scopeId, path: '越权路径' } })).toMatchObject({ ok: false }); expect(h.snippetTransfers.preview).not.toHaveBeenCalled();
  h.snippetTransfers.preview.mockImplementation(async () => { h.invalidate(); return null; }); expect(await h.request(h.event, { command: 'snippets.transferPreview', input: { scopeId } })).toMatchObject({ ok: false, error: '文档已失效' });
});
it.each(['resolved','rejected'] as const)('片段分派%s前保留退出等待集合，原操作结算后才释放',async outcome=>{
  const h=main(),scopeId='12345678-1234-4234-8234-123456789abc';let resolve!:(value:{count:number})=>void,reject!:(reason:Error)=>void;
  const pending=new Promise<{count:number}>((yes,no)=>{resolve=yes;reject=no;});h.snippetTransfers.export.mockImplementation(()=>pending);
  const request=h.request(h.event,{command:'snippets.transferExport',input:{scopeId}}),tracked=h.queryFileOperations.size;
  if(outcome==='resolved')resolve({count:1});else reject(Error('原文件操作失败'));
  const reply=await request;expect(tracked).toBe(1);expect(h.snippetTransfers.export).toHaveBeenCalledOnce();expect(reply.ok).toBe(outcome==='resolved');if(outcome==='rejected')expect(reply.error).toBe('原文件操作失败');expect(h.queryFileOperations.size).toBe(0);
});
