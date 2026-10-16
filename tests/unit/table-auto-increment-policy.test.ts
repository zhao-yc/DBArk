import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';

const driver = vi.hoisted(() => ({ rows: [] as unknown[], query: vi.fn() }));
// 仅替换数据库查询端口；不读取当前环境、不建立连接、不执行任何SQL。
vi.mock('../../src/engine/structureDefinition', () => ({ structureTaskQuery: driver.query }));
import { readTableAutoIncrementPolicy } from '../../src/engine/tableAutoIncrementCapabilities';

const booleanKeys = ['readOnly', 'innodbReadOnly', 'compressedReadOnly', 'globalWsrep', 'sessionWsrep'] as const;
/** 按run868公开只读事实构造普通对象，不读取该轮环境、凭据或服务器。 */
function mariaFacts(): Record<string, unknown> {
  return { sessionIncrement: '1', sessionOffset: '1', globalIncrement: '1', globalOffset: '1', lockMode: '1', readOnly: 'OFF', innodbReadOnly: 'OFF', forceRecovery: '0', compressedReadOnly: 'OFF', globalWsrep: 'OFF', sessionWsrep: 'OFF' };
}
/** 正式读取器只消费方言，其他上下文由假查询端口隔离。 */
function context(dialect: string, version: string): StructureTaskContext { return { managed: { status: { dialect, version } } } as unknown as StructureTaskContext; }
beforeEach(() => { driver.query.mockReset(); driver.query.mockImplementation(async () => ({ rows: driver.rows })); });

describe('MariaDB自增策略布尔文本的保守读取', () => {
  it.each(['10.11.19-MariaDB-ubu2204', '11.4.13-MariaDB-ubu2404'])('%s的五个OFF按已知布尔字段规范化为0', async version => {
    const original = mariaFacts(); driver.rows = [original];
    const actual = await readTableAutoIncrementPolicy(context('mariadb', version));
    expect(actual).toEqual({ ...original, ...Object.fromEntries(booleanKeys.map(key => [key, '0'])) });
    expect(booleanKeys.every(key => original[key] === 'OFF')).toBe(true);
    expect(driver.query).toHaveBeenCalledTimes(1);
    expect(driver.query.mock.calls[0][1]).not.toContain('super_read_only');
  });

  it.each(['0', 'mixed'])('已知数字布尔及混合表示%s返回同一规范策略，不修改驱动原对象', async kind => {
    const original = mariaFacts(); booleanKeys.forEach((key, index) => { if (kind === '0' || index % 2 === 0) original[key] = '0'; });
    driver.rows = [original]; const before = { ...original };
    const actual = await readTableAutoIncrementPolicy(context('mariadb', '10.11.19-MariaDB'));
    expect(booleanKeys.every(key => actual[key] === '0')).toBe(true); expect(original).toEqual(before);
  });

  it.each(booleanKeys)('%s的ON和1仍触发原只读/Galera保护', async key => {
    for (const value of ['ON', '1']) {
      const original = { ...mariaFacts(), [key]: value }; driver.rows = [original];
      await expect(readTableAutoIncrementPolicy(context('mariadb', '11.4.13-MariaDB'))).rejects.toThrow('当前仅可查看');
      expect(original[key]).toBe(value);
    }
  });

  it.each(booleanKeys)('%s未知、null及异形值均不能coerce为false', async key => {
    for (const value of ['off', 'Off', ' OFF', 'OFF ', 'ON ', 'false', 'NO', 'NO_LOCK', '', null, undefined, 0, 1, false, true, {}, [], new String('OFF')]) {
      driver.rows = [{ ...mariaFacts(), [key]: value }];
      await expect(readTableAutoIncrementPolicy(context('mariadb', '10.11.19-MariaDB'))).rejects.toThrow('当前仅可查看');
    }
  });

  it.each(['sessionIncrement', 'sessionOffset', 'globalIncrement', 'globalOffset', 'lockMode', 'forceRecovery'])('%s不是布尔字段，OFF/ON、非字符串均保持拒绝', async key => {
    for (const value of ['OFF', 'ON', null, 0, false]) {
      driver.rows = [{ ...mariaFacts(), [key]: value }];
      await expect(readTableAutoIncrementPolicy(context('mariadb', '11.4.13-MariaDB'))).rejects.toThrow('当前仅可查看');
    }
  });

  it.each(['sessionIncrement', 'sessionOffset', 'globalIncrement', 'globalOffset', 'lockMode', 'forceRecovery'])('%s的原数值守卫不放宽', async key => {
    driver.rows = [{ ...mariaFacts(), [key]: key === 'lockMode' ? '3' : key === 'forceRecovery' ? '1' : '2' }];
    await expect(readTableAutoIncrementPolicy(context('mariadb', '10.11.19-MariaDB'))).rejects.toThrow('当前仅可查看');
  });

  it.each(['0', '1', '2'])('锁模式%s仍按原集合处理', async lockMode => {
    driver.rows = [{ ...mariaFacts(), lockMode }];
    expect((await readTableAutoIncrementPolicy(context('mariadb', '11.4.13-MariaDB'))).lockMode).toBe(lockMode);
  });

  it('空/多行、缺字段、错误别名和额外字段不能伪造完整策略', async () => {
    const { readOnly: _readOnly, ...missing } = mariaFacts();
    for (const rows of [[], [mariaFacts(), mariaFacts()], [null], [undefined], [{}], [[]], ['OFF'], [0], [missing], [{ ...missing, read_only: 'OFF' }], [{ ...mariaFacts(), superReadOnly: 'OFF' }], [{ ...mariaFacts(), unknown: 'OFF' }]]) {
      driver.rows = rows;
      await expect(readTableAutoIncrementPolicy(context('mariadb', '10.11.19-MariaDB'))).rejects.toThrow('当前仅可查看');
    }
  });

  it('查询失败不提供默认关闭值或回退重试', async () => {
    const failure = Error('合成变量读取失败'); driver.query.mockRejectedValueOnce(failure);
    await expect(readTableAutoIncrementPolicy(context('mariadb', '11.4.13-MariaDB'))).rejects.toBe(failure);
    expect(driver.query).toHaveBeenCalledTimes(1);
  });
});

describe('MySQL原严格策略路径保持', () => {
  it.each(['5.7.44', '8.0.30', '8.4.11'])('%s仅接受原数值字符串，查询和返回对象保持', async version => {
    const { compressedReadOnly: _compressed, globalWsrep: _global, sessionWsrep: _session, ...base } = mariaFacts();
    const original = { ...base, readOnly: '0', superReadOnly: '0', innodbReadOnly: '0' }; driver.rows = [original];
    expect(await readTableAutoIncrementPolicy(context('mysql', version))).toBe(original);
    expect(driver.query.mock.calls[0][1]).toBe('SELECT CAST(@@SESSION.auto_increment_increment AS CHAR) AS sessionIncrement, CAST(@@SESSION.auto_increment_offset AS CHAR) AS sessionOffset, CAST(@@GLOBAL.auto_increment_increment AS CHAR) AS globalIncrement, CAST(@@GLOBAL.auto_increment_offset AS CHAR) AS globalOffset, CAST(@@GLOBAL.innodb_autoinc_lock_mode AS CHAR) AS lockMode, CAST(@@GLOBAL.read_only AS CHAR) AS readOnly, CAST(@@GLOBAL.super_read_only AS CHAR) AS superReadOnly, CAST(@@GLOBAL.innodb_read_only AS CHAR) AS innodbReadOnly, CAST(@@GLOBAL.innodb_force_recovery AS CHAR) AS forceRecovery');
    for (const key of ['readOnly', 'superReadOnly', 'innodbReadOnly', 'forceRecovery']) for (const value of ['OFF', 'ON', null, 0, false]) {
      driver.rows = [{ ...original, [key]: value }];
      await expect(readTableAutoIncrementPolicy(context('mysql', version))).rejects.toThrow('当前仅可查看');
    }
  });
});
