import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { tableCheckApplySchema, tableCheckGetSchema, tableCheckPreviewSchema, tableCheckReleaseSchema } from '../../src/shared/tableChecks';

const commands = ['get', 'preview', 'apply', 'release'].map(op => 'schema.tableChecks.' + op);
/** 保留真实Engine.handle的关闭门、CHECK分支和配置登记方法；只替换数据库任务外界端口。 */
function engine() {
  const source = readFileSync(new URL('../../src/engine/index.ts', import.meta.url), 'utf8'), file = ts.createSourceFile('engine.ts', source, ts.ScriptTarget.Latest, true), clauses: string[] = [];
  let guard = '', copy = '';
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'handle') guard = node.body!.statements.find(statement => ts.isIfStatement(statement) && statement.expression.getText(file).includes('this.closing'))!.getText(file);
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'copySourceProfile') copy = node.getText(file);
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && commands.includes(node.expression.text)) clauses.push(node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file); expect(clauses).toHaveLength(4); expect(guard && copy).toBeTruthy();
  const tasks = { get: vi.fn(async (value: unknown, _revision: number) => tableCheckGetSchema.parse(value)), preview: vi.fn(async (value: unknown, _revision: number) => tableCheckPreviewSchema.parse(value)), apply: vi.fn(async (value: unknown, _revision: number) => tableCheckApplySchema.parse(value)), releaseTokens: vi.fn((value: unknown) => tableCheckReleaseSchema.parse(value)) };
  const context = createContext({ exports: {}, tasks });
  const script = `class Entry { closing=false; profiles=new Map(); tableChecks=tasks; ${copy} async handle(command,input){${guard}\nswitch(command){${clauses.join('\n')}}} };globalThis.entry=new Entry();`;
  runInContext(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { entry: (context as any).entry as { closing: boolean; profiles: Map<string, unknown>; handle(command: string, input: any): Promise<unknown> }, tasks };
}

const profile = { id: 'c', name: '合成连接', host: 'offline.invalid', port: 1, dialect: 'mysql', user: 'synthetic-only' };
it('真实get剥离Main私有配置和修订，冷引擎登记准确profile，严格Tasks合同仍拒未知字段', async () => {
  const f = engine(), input = { connectionId: 'c', database: 'db', table: 'subject', taskId: 'get' };
  expect(await f.entry.handle(commands[0], { ...input, profile, connectionRevision: 7 })).toEqual(input);
  expect(f.tasks.get).toHaveBeenCalledWith(input, 7); expect(f.entry.profiles.get('c')).toBe(profile);
  await expect(f.entry.handle(commands[0], { ...input, profile, connectionRevision: 7, sql: '不能混入SQL' })).rejects.toThrow();
});
it('真实preview/apply各自剥离私有修订，不放宽renderer请求schema', async () => {
  const f = engine(), preview = { snapshotId: 's', taskId: 'preview', change: { op: 'drop', checkRef: 'r' } }, apply = { previewToken: 'p', taskId: 'apply', databaseConfirmation: 'db', tableConfirmation: 'subject', acknowledgements: [] };
  expect(await f.entry.handle(commands[1], { ...preview, connectionRevision: 8 })).toEqual(preview); expect(f.tasks.preview).toHaveBeenCalledWith(preview, 8);
  expect(await f.entry.handle(commands[2], { ...apply, connectionRevision: 8 })).toEqual(apply); expect(f.tasks.apply).toHaveBeenCalledWith(apply, 8);
  await expect(f.entry.handle(commands[1], { ...preview, connectionRevision: 8, profile })).rejects.toThrow();
});
it('缺少或错目标profile在任务端口前拒绝，closing仅允许准确纯release', async () => {
  const f = engine(), input = { connectionId: 'c', database: 'db', table: 'subject', taskId: 'get', connectionRevision: 2 };
  await expect(f.entry.handle(commands[0], input)).rejects.toThrow('准确'); await expect(f.entry.handle(commands[0], { ...input, profile: { ...profile, id: 'other' } })).rejects.toThrow('准确'); expect(f.tasks.get).not.toHaveBeenCalled(); expect(f.entry.profiles.size).toBe(0);
  f.entry.closing = true; for (const command of commands.slice(0, 3)) await expect(f.entry.handle(command, input)).rejects.toThrow('正在关闭');
  expect(await f.entry.handle(commands[3], { snapshotId: 's' })).toEqual({ snapshotId: 's' }); expect(f.tasks.releaseTokens).toHaveBeenCalledOnce(); expect(f.tasks.preview).not.toHaveBeenCalled(); expect(f.tasks.apply).not.toHaveBeenCalled();
});
it('真实Main get分支按当前目标解析配置，不依赖用户先展开连接', () => {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true), clauses: string[] = [];
  const visit = (node: ts.Node) => { if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === commands[0]) clauses.push(node.getText(file)); ts.forEachChild(node, visit); }; visit(file); expect(clauses).toHaveLength(1);
  const resolveConnection = vi.fn(() => profile), context = createContext({ exports: {}, store: { resolveConnection } });
  runInContext(ts.transpileModule(`globalThis.prepare=function(command,input){switch(command){${clauses[0]}}return input;}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  const input = { connectionId: 'c', database: 'db', table: 'subject', taskId: 'g' }; expect((context as any).prepare(commands[0], input)).toEqual({ ...input, profile }); expect(resolveConnection).toHaveBeenCalledWith('c');
});
