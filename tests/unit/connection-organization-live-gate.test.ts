import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { bindConnectionOrganizationUi, installConnectionOrganizationAudit } from '../helpers/connectionOrganizationUi';

const source = readFileSync(new URL('../e2e/connection-organization.spec.ts', import.meta.url), 'utf8');
/** 实际声明只登记回调；任何桌面加载都以RAM哨兵截断，不创建资源。 */
function fixture(flag: string | undefined, args: string[] = [], extra: Record<string, string> = {}) {
  const env = { ...(flag === undefined ? {} : { DBARK_CONNECTION_ORGANIZATION_UI: flag }), DBARK_CONNECTION_ORGANIZATION_OUTPUT: resolve('.cache/dbark-connection-organization-' + 'a'.repeat(32)), ...extra };
  const modules: string[] = [], skip = vi.fn();
  const run = () => runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: {}, process: { env, argv: ['node', ...args], platform: 'win32' }, require(name: string) {
    modules.push(name); if (name === '@playwright/test') return { test: { skip } }; if (name === '../helpers/connectionOrganizationUi') return { bindConnectionOrganizationUi }; if (name === './desktop-fixture') throw Error('RAM_RUNTIME_CAPTURE'); throw Error('未知资源');
  } });
  return { run, env, modules, skip };
}
it.each([undefined, '', '0', 'true'])('默认门%j不加载桌面或读取认证', flag => { const f = fixture(flag, [], { DBARK_TEST_PASSWORD: 'RAM_SENTINEL' }); f.run(); expect(f.skip).toHaveBeenCalledOnce(); expect(f.modules).toEqual(['@playwright/test']); });
it.each(['--list', '--list=true'])('列表%s即使开门也只登记占位', flag => { const f = fixture('1', [flag], { DBARK_TEST_PASSWORD: 'RAM_SENTINEL' }); f.run(); expect(f.modules).toEqual(['@playwright/test']); });
it('准确门和独占输出才到runtime哨兵，不启动窗口', () => { const f = fixture('1'); expect(f.run).toThrow('RAM_RUNTIME_CAPTURE'); expect(f.modules).toEqual(['@playwright/test', '../helpers/connectionOrganizationUi', './desktop-fixture']); });
it('离线门拒绝任何实库配置，不加载桌面', () => { const f = fixture('1', [], { DBARK_INTEGRATION_ENABLED: '1' }); expect(f.run).toThrow('离线窗口配置'); expect(f.modules).not.toContain('./desktop-fixture'); });
it('配置漂移后恢复也不能复活绑定', () => {
  const f = fixture('1'), binding = bindConnectionOrganizationUi(() => ({ env: f.env, platform: 'win32' })); binding.assertCurrent(); f.env.DBARK_CONNECTION_ORGANIZATION_UI = '0'; expect(() => binding.assertCurrent()).toThrow(); f.env.DBARK_CONNECTION_ORGANIZATION_UI = '1'; expect(() => binding.assertCurrent()).toThrow('停链');
});
/** 主进程真实审计函数只调用RAM原端口，证明未知SQL/连接请求在原处理器前被拒。 */
function audit() {
  const original = vi.fn(async (_event: unknown, _request: unknown) => ({ ok: true, result: {} })), handlers = new Map([['dbark:request', original]]), context: any = { ipcMain: { _invokeHandlers: handlers } };
  runInNewContext(`(${installConnectionOrganizationAudit.toString()})({ipcMain},1)`, context);
  return { original, send: (command: string, input: unknown = {}) => handlers.get('dbark:request')!({ sender: { id: 1 } }, { command, input }) };
}
it.each(['query.execute', 'connections.open', 'connections.test', 'sessions.open', 'metadata.databases', 'files.choose'])('%s在原处理器前永久拒绝', async command => { const f = audit(); await expect(f.send(command)).rejects.toThrow('停链'); expect(f.original).not.toHaveBeenCalled(); await expect(f.send('tasks.list')).rejects.toThrow('停链'); });
it('外观批次不能在准确三次空认证新建之前提交', async () => { const f = audit(); await expect(f.send('connections.organizationApply', { ids: [], changes: { group: '误写' } })).rejects.toThrow('停链'); expect(f.original).not.toHaveBeenCalled(); });
