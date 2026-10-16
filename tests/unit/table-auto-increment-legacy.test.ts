import { describe, expect, it } from 'vitest';
import { tableAutoIncrementCapability, tableAutoIncrementCapabilityWarnings } from '../../src/engine/tableAutoIncrementCapabilities';
import { tableAutoIncrementAcknowledgements, tableAutoIncrementKnownAcknowledgements, tableAutoIncrementRequiredAcknowledgements } from '../../src/shared/tableAutoIncrement';
import { tableAutoIncrementAckLabel, tableAutoIncrementAcksComplete } from '../../src/renderer/tableAutoIncrementUi';
import { validateCommand } from '../../src/shared/validation';
import { assertTableAutoIncrementLegacyTarget } from '../helpers/tableAutoIncrementLegacyTarget';

describe('0.19旧引擎版本与专属确认的纯契约', () => {
  it('六端口只是预期映射，版本/方言错配或TLS降级必须拒绝', () => {
    expect(assertTableAutoIncrementLegacyTarget({ host: 'deve-server.yinzon.com', port: '13357' }, { dialect: 'mysql', version: '5.7.44-log' })).toBe('mysql57-native-status');
    expect(() => assertTableAutoIncrementLegacyTarget({ host: 'deve-server.yinzon.com', port: '13357' }, { dialect: 'mysql', version: '8.4.11' })).toThrow('方言');
    expect(() => assertTableAutoIncrementLegacyTarget({ host: 'deve-server.yinzon.com', port: '13310' }, { dialect: 'mysql', version: '10.11.19-MariaDB' })).toThrow('方言');
    expect(() => assertTableAutoIncrementLegacyTarget({ host: 'deve-server.yinzon.com', port: '13484' }, { dialect: 'mysql', version: '8.4.11' })).toThrow('TLS');
    expect(() => assertTableAutoIncrementLegacyTarget({ host: '127.0.0.1', port: '13357' }, { dialect: 'mysql', version: '5.7.44' })).toThrow('200');
  });
  it.each([['mysql', '5.7.44-log', 'mysql57-native-status'], ['mysql', '8.0.30', 'mysql8-stats-expiry'], ['mysql', '8.0.99', 'mysql8-stats-expiry'], ['mysql', '8.4.11', 'mysql8-stats-expiry'], ['mariadb', '10.11.19-MariaDB-0+deb12u2', 'mariadb1011-native-status'], ['mariadb', '5.5.5-11.4.13-MariaDB', 'mariadb114-native-status']])('%s %s只选已明确的读取策略', (dialect, version, expected) => expect(tableAutoIncrementCapability(dialect, version)).toBe(expected));
  it.each([['mysql', '5.7.43'], ['mysql', '5.7.440'], ['mysql', '5.7.45'], ['mysql', '8.0.29'], ['mysql', '8.1.0'], ['mysql', '9.0.1'], ['mysql', '10.11.19-MariaDB'], ['mariadb', '8.4.11'], ['mariadb', '10.11.18-MariaDB'], ['mariadb', '10.11.190-MariaDB'], ['mariadb', '11.4.14-MariaDB'], ['mariadb', '11.8.1-MariaDB'], ['unknown', '5.7.44']])('%s %s未知或方言不符继续只读', (dialect, version) => expect(tableAutoIncrementCapability(dialect, version)).toBeUndefined());
  it('三项旧契约不变，5.7必须四项，IPC允许已知第四项但拒绝重复及陌生项', () => {
    expect(tableAutoIncrementRequiredAcknowledgements('mysql8-stats-expiry')).toEqual(tableAutoIncrementAcknowledgements);
    expect(tableAutoIncrementRequiredAcknowledgements('mysql57-native-status')).toEqual(tableAutoIncrementKnownAcknowledgements);
    expect(tableAutoIncrementAcksComplete(tableAutoIncrementKnownAcknowledgements, new Set(tableAutoIncrementKnownAcknowledgements))).toBe(true);
    for (const required of [['restart-volatile'], [...tableAutoIncrementAcknowledgements, 'unknown'], [...tableAutoIncrementKnownAcknowledgements, 'restart-volatile']]) expect(tableAutoIncrementAcksComplete(required, new Set(required))).toBe(false);
    expect(tableAutoIncrementAcksComplete(tableAutoIncrementKnownAcknowledgements, new Set(tableAutoIncrementAcknowledgements))).toBe(false);
    expect(tableAutoIncrementAckLabel('restart-volatile')).toContain('重启');
    const input = { previewToken: 'p', taskId: 'a', acknowledgements: [...tableAutoIncrementKnownAcknowledgements] };
    expect(validateCommand('schema.tableAutoIncrement.apply', input)).toEqual(input);
    for (const acknowledgements of [[...input.acknowledgements, 'restart-volatile'], [...tableAutoIncrementAcknowledgements, 'unknown']]) expect(() => validateCommand('schema.tableAutoIncrement.apply', { ...input, acknowledgements })).toThrow();
  });
  it('5.7告知内存/初始化锁，MariaDB告知持久但非事务，不从纯测试宣称重启实测', () => {
    expect(tableAutoIncrementCapabilityWarnings('mysql57-native-status').join('；')).toMatch(/内存.*重启.*扫描最大值/);
    expect(tableAutoIncrementCapabilityWarnings('mariadb1011-native-status').join('；')).toContain('不承诺重启后精确值');
    expect(tableAutoIncrementCapabilityWarnings('mysql8-stats-expiry')).toEqual([]);
  });
});
