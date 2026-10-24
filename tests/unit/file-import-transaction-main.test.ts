import { describe, expect, it } from 'vitest';
import { mainColumnsHarness } from './main-columns-owner-harness';
import { resolveFileToken } from '../../src/main/fileTokens';
import { validateCommand } from '../../src/shared/validation';
import { importPresetConfigurationSchema } from '../../src/shared/importPresets';

const base = { connectionId: 'trusted', database: 'db', table: 't', fileToken: 'input', format: 'csv', encoding: 'utf8', mapping: { id: 'id' }, taskId: 'import' } as const;
/** 正式Main校验和文件能力不替换；仅用哨兵代替数据库进程，逐项检查传输合同。 */
function fixture() {
  const main = mainColumnsHarness(); main.context.resolveFileToken = resolveFileToken;
  main.context.files.set('input', { path: 'D:/本例授权/数据.csv', purpose: 'import', format: 'csv' });
  main.request.mockResolvedValue({ rows: 2, errors: [] }); return main;
}

describe('文件导入提交方式的正式IPC边界', () => {
  it('省略保持原输入，CSV和JSON的batch／atomic原样透传，不由Main扩大提交策略', async () => {
    const main = fixture();
    for (const format of ['csv', 'json'] as const) for (const option of [{}, { transactionMode: 'batch' }, { transactionMode: 'atomic' }]) {
      const input = { ...base, format, ...option, taskId: 'import-' + main.request.mock.calls.length };
      await expect(main.run('files.import', input)).resolves.toEqual({ rows: 2, errors: [] });
      expect(main.request.mock.calls.at(-1)).toEqual(['files.import', { ...input, filePath: 'D:/本例授权/数据.csv' }]);
      expect(main.tasks.get(input.taskId)?.status).toBe('completed');
    }
  });

  it('无效值、显式undefined及SQL夹带在任务或数据库分派前拒绝', async () => {
    const main = fixture();
    for (const transactionMode of [undefined, null, false, 0, '', 'ATOMIC', 'all', {}, []]) {
      const reply = await main.invoke('files.import', { ...base, transactionMode });
      expect(reply.ok).toBe(false); expect(reply.error).toContain('参数无效');
    }
    for (const transactionMode of ['batch', 'atomic', undefined]) expect((await main.invoke('files.import', { ...base, format: 'sql', transactionMode })).ok).toBe(false);
    expect(main.request).not.toHaveBeenCalled(); expect(main.tasks.size).toBe(0);
  });

  it('提交策略不能取得未经选择的路径、其他令牌或导出用途', async () => {
    const main = fixture();
    for (const extra of [{ fileToken: 'foreign' }, { filePath: 'D:/未经选择/数据.csv' }]) {
      expect((await main.invoke('files.import', { ...base, transactionMode: 'atomic', ...extra })).ok).toBe(false);
    }
    main.context.files.set('input', { path: 'D:/本例授权/结果.csv', purpose: 'export', format: 'csv' });
    expect((await main.invoke('files.import', { ...base, transactionMode: 'atomic' })).ok).toBe(false);
    expect(main.request).not.toHaveBeenCalled(); expect(main.tasks.size).toBe(0);
  });

  it('继承策略和访问器不能在解析时变成原子提交授权，也不能执行getter', () => {
    const inherited = Object.assign(Object.create({ transactionMode: 'atomic' }), base);
    expect(() => validateCommand('files.import', inherited)).toThrow('参数无效');
    let reads = 0;
    for (const enumerable of [true, false]) {
      const accessor = { ...base }; Object.defineProperty(accessor, 'transactionMode', { enumerable, get() { reads++; return 'atomic'; } });
      expect(() => validateCommand('files.import', accessor)).toThrow('参数无效');
    }
    expect(reads).toBe(0);
  });

  it('预览、导出、Excel及持久模板不接受本次执行的提交策略', () => {
    const targets = [
      ['files.preview', { fileToken: 'input', format: 'csv', encoding: 'utf8' }],
      ['files.export', { connectionId: 'trusted', database: 'db', table: 't', fileToken: 'output', format: 'csv', encoding: 'utf8', taskId: 'export', includeData: true, includeStructure: false }],
      ['excel.import', { connectionId: 'trusted', database: 'db', table: 't', fileToken: 'input', taskId: 'excel', sheetId: 'sheet', protocol: 'plain', fingerprint: 'a'.repeat(64), mapping: [{ source: 'id', target: 'id' }] }],
    ] as const;
    for (const [command, input] of targets) {
      expect(() => validateCommand(command, input)).not.toThrow();
      for (const transactionMode of ['batch', 'atomic', undefined]) expect(() => validateCommand(command, { ...input, transactionMode })).toThrow('参数无效');
    }
    const configuration = { format: 'csv', encoding: 'utf8', columns: ['id'], mapping: { id: 'id' } };
    expect(() => importPresetConfigurationSchema.parse(configuration)).not.toThrow();
    for (const transactionMode of ['batch', 'atomic', undefined]) expect(() => importPresetConfigurationSchema.parse({ ...configuration, transactionMode })).toThrow();
  });
});
