import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, ConnectionProfile } from '../../src/shared/contracts';
import { assertConnectionUpdateAllowed, newQueryContext, saveConnectionUpdate } from '../../src/renderer/connectionChanges';
import { zh } from '../../src/renderer/locales/zh-CN';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke: request }));
beforeEach(() => { request.mockReset(); });

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

describe('连接保存成功后的缓存失效通知', () => {
  it('敏感修改等待保存成功才通知，并仅通知一次对应连接', async () => {
    const next = { ...original, host: 'new.example.test' }; const invalidated = vi.fn();
    let complete!: (profile: ConnectionProfile) => void;
    request.mockImplementation(() => new Promise<ConnectionProfile>(resolve => { complete = resolve; }));
    const pending = saveConnectionUpdate(original, next, [], invalidated);
    expect(invalidated).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledExactlyOnceWith('connections.save', next);
    complete(next);
    await expect(pending).resolves.toBe(next);
    expect(invalidated).toHaveBeenCalledExactlyOnceWith(original.id);
  });

  it('保存失败保留原缓存，并原样返回错误供表单显示', async () => {
    const invalidated = vi.fn(); const failure = new Error('无法保存连接');
    request.mockRejectedValueOnce(failure);
    await expect(saveConnectionUpdate(original, { ...original, password: '' }, [], invalidated)).rejects.toBe(failure);
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('元信息修改和新连接保存成功均不清理已有连接上下文', async () => {
    const invalidated = vi.fn();
    const renamed = { ...original, name: '新名称', group: '新分组', color: '#123456', rememberPassword: false };
    request.mockResolvedValueOnce(renamed);
    await saveConnectionUpdate(original, renamed, [openTab('query')], invalidated);
    const created = { ...original, id: '新连接' };
    request.mockResolvedValueOnce(created);
    await saveConnectionUpdate(undefined, created, [], invalidated);
    expect(request).toHaveBeenCalledTimes(2);
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('仍有工作区标签的敏感修改在保存前被拒绝，不发送请求也不触发清理', async () => {
    const invalidated = vi.fn();
    await expect(saveConnectionUpdate(original, { ...original, host: 'new.example.test' }, [openTab('table')], invalidated)).rejects.toThrow(zh.connections.openTabsBlockChanges);
    expect(request).not.toHaveBeenCalled();
    expect(invalidated).not.toHaveBeenCalled();
  });
});

describe('新查询的连接与数据库上下文', () => {
  it('选择已重置的连接时不从另一连接活动标签填入旧库名', () => {
    expect(newQueryContext({ connectionId: '变更后的连接' }, openTab('query', '其它连接'), original.id)).toEqual({ connectionId: '变更后的连接' });
  });

  it('明确选择库时使用该选择，没有树选择时才使用活动标签的连接和库', () => {
    expect(newQueryContext({ connectionId: '所选连接', database: 'selected_db' }, openTab('query'), original.id)).toEqual({ connectionId: '所选连接', database: 'selected_db' });
    expect(newQueryContext(undefined, openTab('query'), '其它连接')).toEqual({ connectionId: original.id, database: 'app' });
    expect(newQueryContext(undefined, undefined, original.id)).toEqual({ connectionId: original.id });
  });
});
