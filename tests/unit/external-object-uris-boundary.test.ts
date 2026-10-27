import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import type { DesktopApi } from '../../src/shared/contracts';

const emptyCommands = ['workbench.protocolReady', 'workbench.protocolTake'] as const;
const idCommands = ['workbench.protocolResolve', 'workbench.protocolCommit', 'workbench.protocolFinish'] as const;
const id = '10000000-0000-4000-8000-000000000001';

describe('系统链接的正式preload及参数边界', () => {
  it.each(emptyCommands)('%s不接受地址、命令行或路径参数', command => {
    expect(publicCommands[command]).toBe(true);
    expect(validateCommand(command, {})).toEqual({});
    for (const input of [{ uri: 'dbark://object/v1/secret' }, { argv: [] }, { id }, null, []]) {
      expect(() => validateCommand(command, input)).toThrow();
    }
  });
  it.each(idCommands)('%s只接受单个UUID编号', command => {
    expect(publicCommands[command]).toBe(true);
    expect(validateCommand(command, { id })).toEqual({ id });
    for (const input of [{ id, target: {} }, { id: 'dbark://secret' }, {}, { id, filePath: 'private' }]) {
      expect(() => validateCommand(command, input)).toThrow();
    }
  });
  it('真实preload空通知不透传Electron事件，解绑精确且原invoke仍走同一handler', async () => {
    let api!: DesktopApi;
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const request = vi.fn(async () => ({ ok: true, result: { pending: true, active: false } }));
    const on = vi.fn((channel: string, handler: (...args: unknown[]) => void) => { handlers.set(channel, handler); });
    const removeListener = vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      if (handlers.get(channel) === handler) handlers.delete(channel);
    });
    const source = readFileSync(new URL('../../src/main/preload.ts', import.meta.url), 'utf8');
    runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
      exports: {}, require(name: string) {
        if (name === 'electron') return { contextBridge: { exposeInMainWorld(_key: string, value: DesktopApi) { api = value; } }, ipcRenderer: { invoke: request, on, removeListener } };
        if (name === '../shared/commands') return { publicCommands };
        throw Error('禁止额外预加载依赖');
      }
    });
    const listener = vi.fn(), unsubscribe = api.onObjectUri(listener);
    expect([...handlers.keys()]).toEqual(['dbark:object-uri-pending']);
    handlers.get('dbark:object-uri-pending')!({ sender: '原生对象' }, '不可信地址');
    expect(listener.mock.calls).toEqual([[]]);
    expect(await api.invoke('workbench.protocolReady', {})).toEqual({ pending: true, active: false });
    expect(request.mock.calls).toEqual([['dbark:request', { command: 'workbench.protocolReady', input: {} }]]);
    unsubscribe(); expect(handlers.size).toBe(0); expect(removeListener).toHaveBeenCalledOnce();
    await expect(api.invoke('constructor' as never, {} as never)).rejects.toThrow('不支持的客户端操作');
    expect(request).toHaveBeenCalledOnce();
  });
});
