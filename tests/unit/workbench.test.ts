import { describe, expect, it, vi } from 'vitest';
import { emptyWorkbench, objectUri, parseObjectUri, targetKey, workbenchDocumentSchema, type WorkbenchTarget } from '../../src/shared/workbench';
import { resolveWorkbenchTarget, type WorkbenchResolver } from '../../src/main/workbench';
import { validateCommand } from '../../src/shared/validation';

const target = { connectionId: '__proto__', kind: 'table', database: '库.名/ %?#', name: 'constructor.表`/ 🚢' } satisfies WorkbenchTarget;
/** 只读服务桩明确记录实际访问的连接和库，检查失效目标不会发生回退或写操作。 */
function services(): WorkbenchResolver {
  return { connectionExists: vi.fn(() => true), connect: vi.fn(async () => {}), databases: vi.fn(async () => [target.database]), objects: vi.fn(async () => [{ kind: 'table' as const, name: target.name }]), assertCurrent: vi.fn() };
}
describe('收藏对象身份与应用内链接', () => {
  it('特殊字符、原型同名、库名与类型使用独立身份往返', () => {
    for (const kind of ['table', 'view', 'procedure', 'function', 'trigger', 'event'] as const) {
      const value = { ...target, kind }; expect(parseObjectUri(objectUri(value))).toEqual(value);
    }
    const database = { connectionId: 'constructor', kind: 'database', database: 'a.b/c' } as const;
    expect(parseObjectUri(objectUri(database))).toEqual(database);
    expect(targetKey(target)).not.toBe(targetKey({ ...target, kind: 'view' }));
    expect(targetKey({ ...target, database: 'a.b', name: 'c' })).not.toBe(targetKey({ ...target, database: 'a', name: 'b.c' }));
  });
  it('拒绝外部地址、SQL、凭据、非规范编码、过长和多余段', () => {
    const valid = objectUri(target);
    for (const uri of ['https://example.com', 'javascript:alert(1)', 'dbark://u:p@object/v1/c/table/d/t', valid + '?sql=DROP%20TABLE', valid + '#x', valid + '/x', valid.replace('%2F', '%2f'), valid.replace('%2F', '/'), 'dbark://object/v1/c/table/d/%00', 'dbark://object/v1/c/unknown/d/t', 'dbark://object/v1/c/table/d/%ZZ', 'dbark://object/v1/' + 'a'.repeat(8192), ' ' + valid, valid + '\n']) expect(() => parseObjectUri(uri)).toThrow();
    expect(() => validateCommand('workbench.resolve', { ...target, sql: 'SELECT 1', password: 'secret' })).toThrow();
  });
  it('仅接受合法虚拟关系和有限文档，不允许凭据或继承属性混入', () => {
    const favorite = { id: 'f', label: '收藏', groupId: null, target };
    const document = { ...emptyWorkbench(), favorites: [favorite] };
    expect(workbenchDocumentSchema.parse(document)).toEqual(document);
    expect(() => workbenchDocumentSchema.parse({ ...document, favorites: [favorite, { ...favorite, id: 'other' }] })).toThrow('重复收藏');
    expect(() => workbenchDocumentSchema.parse({ ...document, favorites: [{ ...favorite, groupId: 'missing' }] })).toThrow('不存在');
    expect(() => workbenchDocumentSchema.parse({ ...document, password: 'secret' })).toThrow();
    expect(() => workbenchDocumentSchema.parse({ ...document, groups: [{ id: 'g', name: '一' }, { id: 'g', name: '二' }] })).toThrow('重复');
    expect(() => validateCommand('workbench.save', { revision: -1, document })).toThrow();
  });
});
describe('收藏与链接按原连接只读核验', () => {
  it('完整匹配名称与类型，数据库收藏无需列对象', async () => {
    const api = services(); expect(await resolveWorkbenchTarget(target, api)).toEqual(target);
    expect(api.connect).toHaveBeenCalledExactlyOnceWith(target.connectionId);
    expect(api.objects).toHaveBeenCalledExactlyOnceWith(target.connectionId, target.database);
    const database = { connectionId: target.connectionId, database: target.database, kind: 'database' } as const;
    const dbApi = services(); await resolveWorkbenchTarget(database, dbApi); expect(dbApi.objects).not.toHaveBeenCalled();
  });
  it('未知连接不发起访问，连接失败不会泄漏错误中凭据', async () => {
    const api = services(); api.connectionExists = vi.fn(() => false);
    await expect(resolveWorkbenchTarget(target, api)).rejects.toThrow('原连接不存在'); expect(api.connect).not.toHaveBeenCalled();
    const failed = services(); failed.connect = vi.fn(async () => { throw Error('password=SECRET'); });
    await expect(resolveWorkbenchTarget(target, failed)).rejects.toThrow('无法连接原连接'); expect(failed.databases).not.toHaveBeenCalled();
  });
  it('数据库或对象删除、类型改变、权限不足都明确失败', async () => {
    const missingDb = services(); missingDb.databases = vi.fn(async () => []);
    await expect(resolveWorkbenchTarget(target, missingDb)).rejects.toThrow('原数据库已删除'); expect(missingDb.objects).not.toHaveBeenCalled();
    for (const objects of [[], [{ name: target.name!, kind: 'view' as const }], [{ name: target.name! + '.other', kind: 'table' as const }]]) {
      const api = services(); api.objects = vi.fn(async () => objects); await expect(resolveWorkbenchTarget(target, api)).rejects.toThrow('原对象已删除');
    }
    const denied = services(); denied.objects = vi.fn(async () => { throw Error('denied secret'); });
    await expect(resolveWorkbenchTarget(target, denied)).rejects.toThrow('检查访问权限');
  });
  it('核验期间连接变更后停止，不继续读取其它对象', async () => {
    const api = services(); api.assertCurrent = vi.fn(() => { throw Error('连接配置已变化'); });
    await expect(resolveWorkbenchTarget(target, api)).rejects.toThrow('连接配置已变化'); expect(api.databases).not.toHaveBeenCalled();
  });
});
