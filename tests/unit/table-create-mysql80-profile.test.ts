import { describe, expect, it } from 'vitest';
import { tableCreatePreparationProfile } from '../../src/shared/tableCreateProfiles';

describe('新建表8.0.46准确版本仅准备合同', () => {
  it.each(['8.0.46', '8.0.46-0ubuntu0.22.04.3', '8.0.46+debian'])('%s只允许准备事实，不激活写入', version => {
    const profile = tableCreatePreparationProfile('mysql', version);
    expect(profile).toMatchObject({ id: 'mysql-8.0.46-create-preparation-v1', state: 'prepared', canReadFacts: true, canWrite: false });
    expect(Object.isFrozen(profile)).toBe(true); expect(profile.reason).toContain('等待Root');
    expect(() => { (profile as any).canWrite = true; }).toThrow();
  });
  it.each(['8.0', '8.0.45', '8.0.47', '8.0.460', '8.4.11', '5.7.44', '10.11.19', '8.0.46-', '8.0.46\n', '8.0.46-x\n', ' 8.0.46', '8.0.46.1', '8.0.46custom'])('%s不能借准确版本合同读取或写入', version => {
    expect(tableCreatePreparationProfile('mysql', version)).toMatchObject({ state: 'unsupported', canReadFacts: false, canWrite: false });
  });
  it.each(['mariadb', 'postgres', '', 'MYSQL'])('方言%s不能借版本字符串放行', dialect => {
    expect(tableCreatePreparationProfile(dialect, '8.0.46').canReadFacts).toBe(false);
  });
});
