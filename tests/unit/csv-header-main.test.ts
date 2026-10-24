import { describe, expect, it } from 'vitest';
import { mainColumnsHarness } from './main-columns-owner-harness';
import { resolveFileToken } from '../../src/main/fileTokens';
import { validateCommand } from '../../src/shared/validation';

const preview = { fileToken: 'csv-source', format: 'csv', encoding: 'utf8' } as const;
const importing = { ...preview, connectionId: 'trusted', database: 'db', table: 't', mapping: { 第1列: 'id' }, taskId: 'csv-import' };

/** 使用生产IPC、参数校验、文件能力及分派；只替换引擎物理端口，不进行实际文件或数据库访问。 */
function fixture() {
  const main = mainColumnsHarness();
  main.context.resolveFileToken = resolveFileToken;
  main.context.files.set(preview.fileToken, { path: 'D:/本例授权/无标题.csv', purpose: 'import', format: 'csv' });
  main.request.mockImplementation(async (command: string) => command === 'files.preview'
    ? { columns: ['第1列'], rows: [{ 第1列: '18446744073709551615' }] }
    : { rows: 1, errors: [] });
  return main;
}

describe('CSV首行配置共享合同与正式Main入口', () => {
  it('省略、true和false原样透传至引擎，路径只来自本窗口文件能力', async () => {
    const main = fixture();
    for (const option of [{}, { csvHasHeader: true }, { csvHasHeader: false }]) {
      await expect(main.run('files.preview', { ...preview, ...option })).resolves.toEqual({ columns: ['第1列'], rows: [{ 第1列: '18446744073709551615' }] });
      expect(main.request.mock.calls.at(-1)).toEqual(['files.preview', { ...preview, ...option, filePath: 'D:/本例授权/无标题.csv' }]);
      const input = { ...importing, ...option, taskId: 'csv-' + main.request.mock.calls.length };
      await expect(main.run('files.import', input)).resolves.toEqual({ rows: 1, errors: [] });
      expect(main.request.mock.calls.at(-1)).toEqual(['files.import', { ...input, filePath: 'D:/本例授权/无标题.csv' }]);
      expect(main.tasks.get(input.taskId).status).toBe('completed');
    }
  });

  it('错误类型、显式undefined和非CSV夹带在文件与引擎访问之前拒绝', async () => {
    const main = fixture();
    for (const [command, base] of [['files.preview', preview], ['files.import', importing]] as const) {
      for (const csvHasHeader of [undefined, null, 0, 1, '', 'false', [], {}]) {
        const reply = await main.invoke(command, { ...base, csvHasHeader });
        expect(reply.ok).toBe(false); expect(reply.error).toContain('参数无效');
      }
      for (const csvHasHeader of [true, false, undefined]) {
        expect((await main.invoke(command, { ...base, format: 'json', csvHasHeader })).ok).toBe(false);
        if (command === 'files.import') expect((await main.invoke(command, { ...base, format: 'sql', csvHasHeader })).ok).toBe(false);
      }
    }
    expect(main.request).not.toHaveBeenCalled(); expect(main.tasks.size).toBe(0);
  });

  it('无标题配置不能取得任意路径、其他窗口文件能力或导出用途', async () => {
    const main = fixture();
    for (const input of [
      { ...preview, csvHasHeader: false, filePath: 'D:/未经选择/数据.csv' },
      { ...preview, csvHasHeader: false, fileToken: '其他窗口令牌' },
    ]) expect((await main.invoke('files.preview', input)).ok).toBe(false);
    main.context.files.set(preview.fileToken, { path: 'D:/本例授权/结果.csv', purpose: 'export', format: 'csv' });
    expect((await main.invoke('files.import', { ...importing, csvHasHeader: false })).ok).toBe(false);
    expect(main.request).not.toHaveBeenCalled(); expect(main.tasks.size).toBe(0);
  });

  it('导出、SQL结果导出和Excel继续严格拒绝CSV导入标题选项', () => {
    const { mapping: _mapping, ...base } = importing;
    const inputs = [
      ['files.export', { ...base, includeData: true, includeStructure: false }],
      ['files.exportResult', { fileToken: preview.fileToken, format: 'csv', encoding: 'utf8', taskId: 'result', result: { columns: [{ key: 'c0', name: 'id' }], rows: [{ c0: '1' }], truncated: false } }],
      ['excel.preview', { fileToken: preview.fileToken, sheetId: 'Sheet1', headerRow: 1, protocol: 'plain', taskId: 'excel' }],
    ] as const;
    for (const [command, input] of inputs) {
      expect(() => validateCommand(command, input)).not.toThrow();
      for (const csvHasHeader of [true, false, undefined]) expect(() => validateCommand(command, { ...input, csvHasHeader })).toThrow('参数无效');
    }
  });
});
