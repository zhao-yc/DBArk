import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { attachMonacoCaretDiagnostic, collectMonacoCaretDiagnostics } from '../e2e/monaco-caret-diagnostics';

const require = createRequire(import.meta.url);
const playwright = createRequire(require.resolve('@playwright/test/package.json'));
const { normalizeAndSaveAttachment } = require(join(dirname(playwright.resolve('playwright/package.json')), 'lib/util.js'));

/** 锁定Playwright真实附件函数，不启动runner、浏览器或原生窗口。 */
it('仅list报告时原JSON已在输出目录完整落盘，再交真实path附件函数复制', async () => {
  const root = resolve('.cache/monaco-diagnostic-persist-20261017/pure-output', randomUUID()); mkdirSync(root, { recursive: true });
  const context = { cold: 1, phase: 'prepare' as const, marked: '合成私密|正文', pageErrorCount: 0 };
  const sample = await collectMonacoCaretDiagnostics({ evaluate: async () => { throw Error('页面不可用'); } } as never, context.marked);
  const attachments: Array<{ path?: string; body?: Buffer }> = [];
  const info = { timeout: 90000, duration: 100, outputPath: (file: string) => join(root, file), attach: async (name: string, options: unknown) => { attachments.push(await normalizeAndSaveAttachment(root, name, options)); } };
  expect(await attachMonacoCaretDiagnostic({ evaluate: async () => sample } as never, info as never, context)).toBe('attached');
  const files = readdirSync(root).filter(file => file.endsWith('.json'));
  expect(files).toEqual(['offline-completion-cold-1-diagnostic.json']);
  const source = readFileSync(join(root, files[0]), 'utf8'), data = JSON.parse(source);
  expect(data).toMatchObject({ cold: 1, phase: 'prepare', pageErrorCount: 0, diagnostics: { sample: 'page-unavailable', model: { utf16Units: null }, rendererDraft: { availability: 'unknown' } } });
  expect(source).not.toContain('合成私密'); expect(Buffer.byteLength(source)).toBeLessThanOrEqual(8192);
  expect(attachments).toHaveLength(1); expect(attachments[0].body).toBeUndefined(); expect(attachments[0].path).toBeTypeOf('string');
  expect(readFileSync(attachments[0].path!, 'utf8')).toBe(source);
  expect(readdirSync(root).some(file => file.endsWith('.partial'))).toBe(false);
});

it('实际wx拒绝已有partial时不覆盖或删除它，也不创建完整JSON或附件', async () => {
  const root = resolve('.cache/monaco-diagnostic-persist-20261017/pure-output', randomUUID()); mkdirSync(root, { recursive: true });
  const context = { cold: 0, phase: 'prepare' as const, marked: '合成|正文', pageErrorCount: 0 };
  const sample = await collectMonacoCaretDiagnostics({ evaluate: async () => { throw Error('页面不可用'); } } as never, context.marked);
  const target = join(root, 'offline-completion-cold-0-diagnostic.json'); writeFileSync(target + '.partial', '原临时现场');
  const attach = vi.fn(async () => {}), warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const info = { timeout: 90000, duration: 100, outputPath: (file: string) => join(root, file), attach };
    expect(await attachMonacoCaretDiagnostic({ evaluate: async () => sample } as never, info as never, context)).toBe('failed');
    expect(readFileSync(target + '.partial', 'utf8')).toBe('原临时现场'); expect(existsSync(target)).toBe(false); expect(attach).not.toHaveBeenCalled();
    expect(warning.mock.calls).toEqual([['离线补全诊断不可用：采样或持久化附件失败']]);
  } finally { warning.mockRestore(); }
});
