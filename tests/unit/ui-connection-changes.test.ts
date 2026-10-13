import { describe, expect, it } from 'vitest';
import type { AppSettings, ConnectionProfile } from '../../src/shared/contracts';
import { assertConnectionUpdateAllowed } from '../../src/renderer/connectionChanges';
import { zh } from '../../src/renderer/locales/zh-CN';

const original: ConnectionProfile = {
  id: '开发连接', name: '开发库', group: '开发', color: '#52c5a2', dialect: 'mysql',
  host: 'dev.example.test', port: 3306, user: 'developer', database: 'app', hasPassword: true, rememberPassword: true,
  ssh: { enabled: true, host: 'ssh.example.test', port: 22, user: 'operator', hasPassword: true, hasPassphrase: true },
  tls: { enabled: true, rejectUnauthorized: true }
};

/** 构造工作区标签，查询正文与表名用于确认拒绝更新不丢弃用户上下文。 */
function openTab(kind: 'query' | 'table', connectionId = original.id): AppSettings['tabs'][number] {
  return { id: '保留标签', kind, connectionId, title: '待保存工作', database: 'app', ...(kind === 'query' ? { sql: 'SELECT 1;' } : { table: 'orders' }) };
}

describe('连接编辑的工作区保护', () => {
  it.each(['query', 'table'] as const)('已有 %s 标签时拒绝切换服务器，完整保留标签和待保存表单', kind => {
    const tabs = [openTab(kind)]; const next = { ...original, host: 'production.example.test' };
    const snapshot = structuredClone({ tabs, original, next });
    expect(() => assertConnectionUpdateAllowed(original, next, tabs)).toThrow(zh.connections.openTabsBlockChanges);
    expect({ tabs, original, next }).toEqual(snapshot);
  });

  it('任何该连接标签都受保护，包括非当前标签；其它连接标签不阻止更新', () => {
    const next = { ...original, user: 'other-user' };
    expect(() => assertConnectionUpdateAllowed(original, next, [openTab('table', '其它连接'), openTab('query')])).toThrow();
    expect(() => assertConnectionUpdateAllowed(original, next, [openTab('table', '其它连接')])).not.toThrow();
    expect(() => assertConnectionUpdateAllowed(original, next, [])).not.toThrow();
  });

  it('有工作区标签仍允许改名称、分组、颜色及密码保存偏好，未填写秘密保留原认证', () => {
    const next = { ...original, name: '开发库的新名称', group: '常用', color: '#334455', rememberPassword: false };
    expect(() => assertConnectionUpdateAllowed(original, next, [openTab('query'), openTab('table')])).not.toThrow();
  });

  it.each([
    { password: '' },
    { ssh: { ...original.ssh!, password: '' } },
    { ssh: { ...original.ssh!, passphrase: '' } },
    { tls: { ...original.tls!, rejectUnauthorized: false } },
    { database: 'another_database' }
  ])('已有标签时阻止认证清除与连接范围修改：%j', patch => {
    expect(() => assertConnectionUpdateAllowed(original, { ...original, ...patch }, [openTab('query')])).toThrow(zh.connections.openTabsBlockChanges);
  });

  it('新连接不受已有工作区标签影响', () => {
    expect(() => assertConnectionUpdateAllowed(undefined, { ...original, id: '新连接' }, [openTab('query')])).not.toThrow();
  });
});
