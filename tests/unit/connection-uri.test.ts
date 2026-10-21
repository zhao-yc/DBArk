import { describe, expect, it } from 'vitest';
import { connectionProfileFromUri, parseConnectionUri, connectionUriErrors, connectionUriLimits } from '../../src/shared/connectionUri';
import type { ConnectionProfile } from '../../src/shared/contracts';

describe('明确目标的连接URI解析', () => {
  it('解码一次，保留密码标点、加号、空白和数据库Unicode，默认3306', () => {
    expect(parseConnectionUri('mysql://u%3A%40:p%2F%3F%23%25%252F+%20@localhost/%E6%B5%8B%E8%AF%95')).toEqual({ dialect: 'mysql', host: 'localhost', port: 3306, user: 'u:@', password: 'p/?#%%2F+ ', database: '测试' });
    expect(parseConnectionUri('mariadb://root@host/')).toEqual({ dialect: 'mariadb', host: 'host', port: 3306, user: 'root', password: '' });
  });
  it('规范化主机、国际域名和IPv6，认证及数据库不套用URL路径归一化', () => {
    expect(parseConnectionUri('MySQL://u:p@[2001:0db8:0:0::1]:3307/db')).toMatchObject({ dialect: 'mysql', host: '2001:db8::1', port: 3307 });
    expect(parseConnectionUri('mysql://u:p@例子.测试/db')).toMatchObject({ host: 'xn--fsqu00a.xn--0zwm56d' });
    expect(parseConnectionUri('mysql://u:p@LOCALHOST:003306/db.name')).toMatchObject({ host: 'localhost', port: 3306, database: 'db.name' });
  });
  it.each(['mysql://u:p@host/db?ssl=true', 'mysql://u:p@host/db?ssl-mode=VERIFY_IDENTITY', 'mysql://u:p@host/?', 'mysql://u:p@host/#fragment'])('查询参数／片段不能被静默忽略：%s', raw => {
    expect(() => parseConnectionUri(raw)).toThrow(connectionUriErrors.options);
  });
  it.each(['', ' mysql://u:p@host', 'mysql://u:p@host\n', 'mysql://u:p@ho\\st', 'https://u:p@host/db', 'jdbc:mysql://host/db', 'mysql://host/db', 'mysql://@host', 'mysql://u:p@host/one/two', 'mysql://u:p@host:0/db', 'mysql://u:p@host:65536/db', 'mysql://u:p@host:1e3/db', 'mysql://u:p@host:/db', 'mysql://u:p@2001:db8::1/db', 'mysql://u:p@[not-ip]/db', 'mysql://u:p@[::1]:-1/db', 'mysql://u:p@@host/db', 'mysql://u:%E0%A4@host/db', 'mysql://%00:p@host/db', 'mysql://u:p@host/%2Fdb', 'mysql://u:p@host/%5Cdb', 'mysql://u:p@host/%0Adb', 'mysql://u:p@host%2Fother/db'])('拒绝无效或不确定目标：%s', raw => { expect(() => parseConnectionUri(raw)).toThrow(); });
  it('密码百分号编码不回显到错误文本，原输入没有被修剪或改变', () => {
    const raw = 'mysql://private-user:private-secret@host:65536/db';
    try { parseConnectionUri(raw); throw Error('应拒绝'); } catch (reason) { expect(String(reason)).not.toContain('private-'); expect(String(reason)).toContain(connectionUriErrors.invalid); }
    expect(raw).toBe('mysql://private-user:private-secret@host:65536/db');
  });
  it.each([() => 'x'.repeat(connectionUriLimits.units + 1), () => 'mysql://' + 'u'.repeat(257) + ':p@host/db', () => 'mysql://u:' + 'p'.repeat(4097) + '@host/db', () => 'mysql://u:p@host/' + 'd'.repeat(257)])('长度预算在完整填入前拒绝', make => { expect(() => parseConnectionUri(make())).toThrow(connectionUriErrors.budget); });
  it('复制来源只保留新编号和展示字段，目标不继承认证、传输或待补文件', () => {
    const current: ConnectionProfile = { id: 'new-id', name: '名称', group: '组', color: '#123456', dialect: 'mysql', host: 'old', port: 3306, user: 'old', database: 'old', rememberPassword: true, hasPassword: true, password: 'old-secret', pendingFiles: ['sshPrivateKey'], ssh: { enabled: true, host: 'ssh', port: 22, user: 'old', privateKeyPath: 'old-key', password: 'old-ssh' }, tls: { enabled: true, rejectUnauthorized: false, keyPath: 'old-tls', passphrase: 'old-passphrase' } };
    const before = structuredClone(current), next = connectionProfileFromUri(current, 'mysql://new@new-host');
    expect(next).toEqual({ id: 'new-id', name: '名称', group: '组', color: '#123456', dialect: 'mysql', host: 'new-host', port: 3306, user: 'new', password: '', rememberPassword: false }); expect(current).toEqual(before);
  });
});
