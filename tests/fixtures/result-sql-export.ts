import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { ResultSqlPreviews } from '../../src/main/resultSqlPreviews';
import { resolveFileToken, type SelectedFile } from '../../src/main/fileTokens';
import { validateCommand } from '../../src/shared/validation';
import type { TaskRecord } from '../../src/shared/contracts';

/** 执行生产Main函数原文，外界仅提供原生选择、归属与broker端口；不另写一套派发逻辑。 */
const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
const choose = source.slice(source.indexOf('async function chooseResultSqlFile('), source.indexOf('/** 布局请求到达'));
const dispatch = source.slice(source.indexOf('async function dispatch('), source.indexOf('/** 按平台生成中文原生菜单'));
const script = ts.transpileModule(choose + dispatch + '\nglobalThis.dispatch = dispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
export function resultSqlMain(filePath: string, request: (command: string, input: any) => Promise<unknown>, reserve: () => Promise<() => void> = async () => () => {}) {
  const files = new Map<string, SelectedFile>(), previews = new ResultSqlPreviews(files), owner = {}, tasks = new Map<string, TaskRecord>();
  const state = { current: true }, commands: { command: string; input: any }[] = [];
  const invocation = { owner: { document: owner } };
  const context = createContext({ Date, Map, Error, randomUUID, shuttingDown: false, files, resultSqlPreviews: previews, resolveFileToken,
    SavedQuerySearchCancelled: class extends Error {},
    columnsMain: { assertCapturedOwner(value: unknown) { if (value !== invocation || !state.current) throw Error('合成主文档已失效'); } },
    async chooseFile(input: any) { const token = randomUUID(); files.set(token, { path: filePath, purpose: input.purpose, format: input.format }); return { token, name: '结果.sql' }; },
    tasks, preparingTasks: new Map(), completionTasks: new Set(), tablePresetReads: new Map(), structureTokens: new Map(), sessions: new Map(), pendingQueryHistory: new Map(), exportProgress: new Map(), structureProgress: new Map(),
    historyPages: undefined, savedQueryPages: undefined, savedQuerySearches: { has: () => false }, connectionConfig: { assertAvailable(id: unknown) { if (id !== undefined) throw Error('结果文件禁止访问数据库连接'); } },
    store: { saveTask() {} }, exportReservations: { acquire: reserve }, broker: { request },
    taskEvent(event: any) { const previous = tasks.get(event.taskId); if (previous) tasks.set(event.taskId, { ...previous, ...event }); },
  });
  runInContext(script, context);
  const actual = context.dispatch as (command: string, input: unknown, invocation: unknown) => Promise<unknown>;
  return { state, files, previews, tasks, commands, context, async invoke(command: string, input: any): Promise<any> { const parsed = validateCommand(command, input); commands.push({ command, input: parsed }); return actual(command, parsed, invocation); } };
}
