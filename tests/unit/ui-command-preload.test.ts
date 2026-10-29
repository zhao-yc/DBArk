import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { publicCommands, isUiCommandInvocation } from '../../src/shared/commands';
import type { DesktopApi } from '../../src/shared/contracts';

it('原preload仅发布白名单命令与代次，不透传原生事件且精确解绑', async () => {
  let api!: DesktopApi;
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const request = vi.fn(async () => ({ ok: true, result: undefined }));
  const removeListener = vi.fn((channel: string, handler: (...args: unknown[]) => void) => { if (handlers.get(channel) === handler) handlers.delete(channel); });
  const source = readFileSync(new URL('../../src/main/preload.ts', import.meta.url), 'utf8');
  // 真实preload编译执行；只注入原Electron边界与真实纯白名单，不启动任何应用。
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: {}, require(name: string) {
      if (name === 'electron') return { contextBridge: { exposeInMainWorld(_key: string, value: DesktopApi) { api = value; } }, ipcRenderer: { invoke: request, on(channel: string, handler: (...args: unknown[]) => void) { handlers.set(channel, handler); }, removeListener } };
      if (name === '../shared/commands') return { publicCommands, isUiCommandInvocation };
      throw Error('禁止额外预加载依赖');
    }
  });
  const listener = vi.fn(), unsubscribe = api.onCommand(listener);
  expect([...handlers.keys()]).toEqual(['dbark:command']);
  const receive = handlers.get('dbark:command')!;
  receive({ sender: '不能透传的原生对象' }, { id: 'execute', revision: 12 });
  for (const input of [{ id: 'constructor', revision: 12 }, { id: 'execute', revision: -1 }, { id: 'execute', revision: 12, sql: '不能透传的正文' }, { id: 'execute', revision: '12' }]) receive({}, input);
  expect(listener.mock.calls).toEqual([[{ id: 'execute', revision: 12 }]]);
  let read = false;
  const accessor = { revision: 12 }; Object.defineProperty(accessor, 'id', { enumerable: true, get() { read = true; return 'execute'; } });
  receive({}, accessor); expect(read).toBe(false); expect(listener).toHaveBeenCalledOnce();
  unsubscribe(); expect(handlers.size).toBe(0); expect(removeListener).toHaveBeenCalledOnce();
  await api.invoke('app.menuState', { revision: 12, commands: [{ id: 'execute', enabled: true }] });
  expect(request.mock.calls).toEqual([['dbark:request', { command: 'app.menuState', input: { revision: 12, commands: [{ id: 'execute', enabled: true }] } }]]);
});
