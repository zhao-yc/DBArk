import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectPostgresCopySource } from '../../src/engine/postgres/copyImportFile';

/** 测试使用真实文件句柄，覆盖预览前缀和选择阶段的文件身份读取。 */
async function inspect(csv: string, hasHeader?: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'tabrelio-copy-preview-'));
  try {
    const file = join(directory, '源.csv');
    await writeFile(file, csv);
    return await inspectPostgresCopySource(file, ';', hasHeader);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

describe('PostgreSQL CSV 导入样本', () => {
  it('默认跳过表头，无表头时把第一条完整记录纳入预览', async () => {
    const csv = '\uFEFF"含\r\n换行";编号\r\n;9007199254740994\r\n"";9007199254740995\r\n';
    const ordinary = await inspect(csv);
    expect(ordinary.source).toMatchObject({ hasHeader: true, header: ['含\r\n换行', '编号'] });
    expect(ordinary.sample).toEqual([[null, '9007199254740994'], ['', '9007199254740995']]);
    expect(ordinary.sampleLimited).toBe(false);
    const headerless = await inspect(csv, false);
    expect(headerless.source).toMatchObject({ hasHeader: false, header: ['第1列', '第2列'] });
    expect(headerless.sample[0]).toEqual(['含\r\n换行', '编号']);
  });

  it('样本限制为五行十二列，截短值时保留 Unicode 字符边界', async () => {
    const names = Array.from({ length: 13 }, (_, i) => '列' + i);
    const row = ['甲'.repeat(119) + '🙂最后', ...names.slice(1)];
    const data = [names.join(';'), ...Array<string>(7).fill(row.join(';'))].join('\n');
    const { source, sample } = await inspect(data);
    expect(source.header).toEqual(names);
    expect(sample).toHaveLength(5);
    expect(sample.every(record => record.length === 12 && record[0] === '甲'.repeat(119) + '…')).toBe(true);
  });

  it('前缀截断的记录不进入样本，也不伪造无表头首行', async () => {
    const large = '跨边界'.repeat(100_000);
    expect(await inspect('甲;乙\n保留;1\n"' + large + '";2\n')).toMatchObject({
      sample: [['保留', '1']], sampleLimited: true,
    });
    expect(await inspect('甲;乙\n保留;1\n' + large + ';2\n')).toMatchObject({
      sample: [['保留', '1']], sampleLimited: true,
    });
    await expect(inspect(large + ';2\n', false)).rejects.toThrow('完整首条 CSV 记录');
  });

  it('区分只有表头和后续记录无法预览', async () => {
    expect(await inspect('甲;乙')).toMatchObject({ sample: [], sampleLimited: false });
    expect(await inspect('甲;乙\n"未闭合')).toMatchObject({ sample: [], sampleLimited: true });
    expect(await inspect('甲;乙\n多余;1;2\n')).toMatchObject({ sample: [], sampleLimited: true });
  });
});
