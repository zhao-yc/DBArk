import { describe, expect, it } from 'vitest';
import { StructureExecutionLocks } from '../../src/engine/structureExecutionLocks';

const child = { database: 'a', table: 'child' }, parent = { database: 'b', table: 'parent' };
describe('结构执行的关联资源集合', () => {
  it('库级与同库任意表及跨库父表双向互斥，不占用其它连接和数据库', () => {
    const locks = new StructureExecutionLocks(), table = locks.acquire('c', [child, parent]);
    expect(() => locks.acquireDatabase('c', 'a')).toThrow('未发送 DDL');
    expect(() => locks.acquireDatabase('c', 'b')).toThrow('未发送 DDL');
    locks.acquireDatabase('other', 'a')(); locks.acquireDatabase('c', 'other')();
    table(); const database = locks.acquireDatabase('c', 'b');
    expect(() => locks.acquire('c', [child, parent])).toThrow('未发送 DDL');
    // 冲突集合失败后，另一个库的子表不能留下部分占有。
    locks.acquire('c', [child])(); expect(() => locks.acquireDatabase('c', 'b')).toThrow();
    database(); locks.acquire('c', [parent])();
  });
  it('库级重复释放不移除新占有，非法库范围拒绝，JSON键不碰撞', () => {
    const locks = new StructureExecutionLocks(), old = locks.acquireDatabase('c', '库`名'); old();
    const current = locks.acquireDatabase('c', '库`名'); old();
    expect(() => locks.acquire('c', [{ database: '库`名', table: '表' }])).toThrow();
    locks.acquireDatabase('c,库', '名')(); locks.acquireDatabase('c', '库,名')();
    for (const [connection, database] of [['', 'a'], ['c', ''], ['c', 'a\0']]) expect(() => locks.acquireDatabase(connection, database)).toThrow();
    current(); locks.acquireDatabase('c', '库`名')();
  });
  it('持有父子资源期间，单父索引变更与另一个相交外键变更均拒绝', () => {
    const locks = new StructureExecutionLocks(), release = locks.acquire('c', [child, parent]);
    expect(() => locks.acquire('c', [parent])).toThrow('未发送 DDL');
    expect(() => locks.acquire('c', [parent, { database: 'a', table: 'other' }])).toThrow('未发送 DDL');
    const disjoint = locks.acquire('c', [{ database: 'a', table: 'other' }]); disjoint();
    release(); const next = locks.acquire('c', [parent, child]); next();
  });
  it('校验或冲突失败不留部分占用，任意输入顺序结果一致', () => {
    const locks = new StructureExecutionLocks(), existing = locks.acquire('c', [parent]);
    expect(() => locks.acquire('c', [child, parent])).toThrow();
    const independent = locks.acquire('c', [child]); independent(); existing();
    expect(() => locks.acquire('c', [child, { database: '', table: 'bad' }])).toThrow('名称');
    locks.acquire('c', [child])();
  });
  it('重复目标与重复释放安全，迟到释放不能偷放新任务', () => {
    const locks = new StructureExecutionLocks(), old = locks.acquire('c', [child, child]); old();
    const current = locks.acquire('c', [child]); old();
    expect(() => locks.acquire('c', [child])).toThrow();
    current(); locks.acquire('c', [child])();
  });
  it('名称中的分隔符、原型名和Unicode不产生JSON键碰撞', () => {
    const locks = new StructureExecutionLocks();
    const releases = [
      locks.acquire('c', [{ database: 'a,b', table: 'c' }]), locks.acquire('c', [{ database: 'a', table: 'b,c' }]),
      locks.acquire('c', [{ database: '__proto__', table: 'constructor' }]), locks.acquire('c', [{ database: '库', table: '表' }]),
    ];
    for (const release of releases) release();
  });
  it('精确连接配置范围独立，空读任务不占资源，过多目标拒绝', () => {
    const locks = new StructureExecutionLocks(), release = locks.acquire('c', [child]);
    locks.acquire('other-profile', [child])(); locks.acquire('c', [])();
    expect(() => locks.acquire('', [child])).toThrow('身份');
    expect(() => locks.acquire('c', Array.from({ length: 258 }, () => parent))).toThrow('数量');
    release();
  });
});
