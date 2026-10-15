import { describe, expect, it } from 'vitest';
import type { ConnectionStatus } from '../../src/shared/contracts';
import { CompletionServerFacts, completionServerFacts, type CompletionServerFactsTicket } from '../../src/renderer/completionServerFacts';

/** 仅构造已完成建连状态，不模拟网络；测试直接安排缓存生命周期的真实同步时序。 */
const status = (version = '8.4.8', dialect: ConnectionStatus['dialect'] = 'mysql'): ConnectionStatus => ({ version, dialect, connectionId: 123 });
/** 测试调用方的一次建连成功，返回原ticket以便继续模拟晚到失败。 */
function opened(cache: CompletionServerFacts, id: string, revision = 0, version = '8.4.8') {
  const ticket = cache.begin(id, revision); expect(cache.complete(ticket, status(version))).toBe(true); return ticket;
}

describe('建连服务器事实的只读快照', () => {
  it('只摘取方言及版本并冻结副本，不保留物理连接或配置字段', () => {
    const cache = new CompletionServerFacts(), ticket = cache.begin('逻辑连接', 0), source = status('11.4.8-MariaDB', 'mariadb');
    Object.defineProperty(source, 'password', { get() { throw Error('不应读取认证字段'); } });
    expect(Object.isFrozen(ticket)).toBe(true); expect(Reflect.set(ticket, 'revision', 9)).toBe(false);
    expect(cache.get('逻辑连接', 0)).toBeUndefined(); expect(cache.complete(ticket, source)).toBe(true);
    const facts = cache.get('逻辑连接', 0)!;
    expect(facts).toEqual({ dialect: 'mariadb', version: '11.4.8-MariaDB' }); expect(Object.keys(facts).sort()).toEqual(['dialect', 'version']);
    expect(Object.isFrozen(facts)).toBe(true); expect(Reflect.set(facts, 'version', '篡改')).toBe(false);
    source.version = '9.9.9'; source.dialect = 'mysql'; source.connectionId = 456;
    expect(cache.get('逻辑连接', 0)).toBe(facts); expect(facts.version).toBe('11.4.8-MariaDB');
  });

  it.each(['5.7.44', '8.4.8-commercial', '5.5.5-10.11.14-MariaDB-0+deb12u2', ' ' + 'v'.repeat(254) + ' '])('保留合法长度版本原文，不猜测或改写发行版后缀：%s', version => {
    const cache = new CompletionServerFacts(); expect(cache.complete(cache.begin('a', 0), status(version))).toBe(true); expect(cache.get('a', 0)?.version).toBe(version);
  });

  it('逻辑连接ID精确隔离大小写、点号、Unicode及原型同名值', () => {
    const cache = new CompletionServerFacts(), names = ['A', 'a', 'db.table', '中🙂', '__proto__', 'constructor', 'x'.repeat(200)];
    names.forEach((name, index) => opened(cache, name, index, `8.4.${index}`));
    names.forEach((name, index) => expect(cache.get(name, index)?.version).toBe(`8.4.${index}`));
  });

  it('导出的单例可按同一接口使用，明确clear后不留下测试事实', () => {
    const id = '单测-服务器事实'; try { opened(completionServerFacts, id, 2); expect(completionServerFacts.get(id, 2)?.dialect).toBe('mysql'); }
    finally { completionServerFacts.clear(id); } expect(completionServerFacts.get(id, 2)).toBeUndefined();
  });
});

describe('ticket、修订与失败时序', () => {
  it('同ID同修订重试也替换旧pending，旧成功和旧失败均不能影响新尝试', () => {
    const cache = new CompletionServerFacts(), old = cache.begin('a', 7), current = cache.begin('a', 7);
    expect(current).not.toBe(old); expect(cache.complete(old, status('5.7.44'))).toBe(false); cache.fail(old);
    expect(cache.complete(current, status())).toBe(true); cache.fail(old); expect(cache.get('a', 7)?.version).toBe('8.4.8');
  });

  it('新修订替换旧事实，旧响应及错误修订读取都不能污染当前事实', () => {
    const cache = new CompletionServerFacts(), old = opened(cache, 'a', 2, '5.7.44'), current = cache.begin('a', 3);
    expect(cache.get('a', 2)).toBeUndefined(); expect(cache.get('a', 3)).toBeUndefined(); expect(cache.complete(old, status('5.7.45'))).toBe(false);
    expect(cache.complete(current, status())).toBe(true); expect(cache.get('a', 2)).toBeUndefined(); expect(cache.get('a', 3)?.version).toBe('8.4.8');
  });

  it('只接受一次完成，晚到的成功或后续元数据权限失败不覆盖或移除已完成事实', () => {
    const cache = new CompletionServerFacts(), ticket = opened(cache, 'a', 0);
    cache.fail(ticket); expect(cache.complete(ticket, status('5.7.44'))).toBe(false); cache.fail(ticket);
    expect(cache.get('a', 0)).toEqual({ version: '8.4.8', dialect: 'mysql' });
  });

  it('fail只结束当前pending，之后必须显式begin新尝试', () => {
    const cache = new CompletionServerFacts(), old = cache.begin('a', 0); cache.fail(old); cache.fail(old);
    expect(cache.complete(old, status())).toBe(false); expect(cache.get('a', 0)).toBeUndefined();
    const current = cache.begin('a', 0); expect(cache.complete(current, status())).toBe(true); cache.fail(old); expect(cache.get('a', 0)?.version).toBe('8.4.8');
  });

  it.each(['pending', 'complete'] as const)('clear撤销%s且同ID同修订重建不会复用旧ticket', state => {
    const cache = new CompletionServerFacts(), old = cache.begin('a', 0); if (state === 'complete') expect(cache.complete(old, status('5.7.44'))).toBe(true);
    cache.clear('a'); cache.clear('a'); expect(cache.get('a', 0)).toBeUndefined(); expect(cache.complete(old, status())).toBe(false);
    const current = cache.begin('a', 0); cache.fail(old); expect(cache.complete(old, status('5.7.45'))).toBe(false);
    expect(cache.complete(current, status())).toBe(true); expect(cache.get('a', 0)?.version).toBe('8.4.8');
  });

  it('跨实例或复制字段伪造的ticket不能完成或删除真正pending', () => {
    const left = new CompletionServerFacts(), right = new CompletionServerFacts(), ticket = left.begin('a', 0), other = right.begin('a', 0), copy = Object.freeze({ ...ticket });
    expect(left.complete(other, status())).toBe(false); expect(left.complete(copy, status())).toBe(false); left.fail(other); left.fail(copy);
    expect(left.complete(ticket, status())).toBe(true); expect(right.complete(other, status('5.7.44'))).toBe(true);
    expect(left.get('a', 0)?.version).toBe('8.4.8'); expect(right.get('a', 0)?.version).toBe('5.7.44');
  });

  it('读取返回值期间发生clear及重建，旧完成不能借字段getter复活', () => {
    const cache = new CompletionServerFacts(), old = cache.begin('a', 0); let current: CompletionServerFactsTicket;
    const source: ConnectionStatus = { dialect: 'mysql', get version() { cache.clear('a'); current = cache.begin('a', 1); return '5.7.44'; } };
    expect(cache.complete(old, source)).toBe(false); expect(cache.get('a', 0)).toBeUndefined();
    expect(cache.complete(current!, status())).toBe(true); expect(cache.get('a', 1)?.version).toBe('8.4.8');
  });
});

describe('pending与已完成事实共用有界LRU', () => {
  it('pending被淘汰后不复活，同ID重建也不接纳旧结果', () => {
    const cache = new CompletionServerFacts(1), old = cache.begin('a', 0), other = cache.begin('b', 0);
    expect(cache.complete(old, status())).toBe(false); cache.fail(old); expect(cache.complete(other, status())).toBe(true);
    const current = cache.begin('a', 0); expect(cache.get('b', 0)).toBeUndefined(); expect(cache.complete(old, status('5.7.44'))).toBe(false);
    expect(cache.complete(current, status())).toBe(true);
  });

  it('已完成事实命中会刷新LRU，淘汰事实的旧ticket仍不可复活', () => {
    const cache = new CompletionServerFacts(2); opened(cache, 'a'); const b = opened(cache, 'b');
    expect(cache.get('a', 0)?.version).toBe('8.4.8'); opened(cache, 'c');
    expect(cache.get('b', 0)).toBeUndefined(); expect(cache.complete(b, status('5.7.44'))).toBe(false); cache.fail(b);
    expect(cache.get('a', 0)).toBeDefined(); expect(cache.get('c', 0)).toBeDefined();
  });

  it('错误修订和迟到回调不刷新LRU或挤走其它连接', () => {
    const cache = new CompletionServerFacts(2), a = opened(cache, 'a'), b = cache.begin('b', 0);
    expect(cache.get('a', 1)).toBeUndefined(); expect(cache.get('b', 0)).toBeUndefined(); expect(cache.complete(a, status('5.7.44'))).toBe(false);
    const c = cache.begin('c', 0); expect(cache.get('a', 0)).toBeUndefined();
    expect(cache.complete(b, status())).toBe(true); expect(cache.complete(c, status())).toBe(true);
  });

  it('读取最老pending没有提供事实，不能刷新其LRU寿命', () => {
    const cache = new CompletionServerFacts(2), a = cache.begin('a', 0); opened(cache, 'b');
    expect(cache.get('a', 0)).toBeUndefined(); const c = cache.begin('c', 0);
    expect(cache.complete(a, status())).toBe(false); expect(cache.get('b', 0)).toBeDefined(); expect(cache.complete(c, status())).toBe(true);
  });

  it('有效完成刷新LRU，仍pending的老请求可被新连接淘汰', () => {
    const cache = new CompletionServerFacts(2), a = cache.begin('a', 0), b = cache.begin('b', 0);
    expect(cache.complete(a, status())).toBe(true); const c = cache.begin('c', 0);
    expect(cache.complete(b, status())).toBe(false); expect(cache.get('a', 0)).toBeDefined(); expect(cache.complete(c, status())).toBe(true);
  });

  it('默认256项同时限制pending，第257个begin直接撤销最老请求', () => {
    const cache = new CompletionServerFacts(), tickets = Array.from({ length: 257 }, (_, index) => cache.begin(String(index), 0));
    expect(cache.complete(tickets[0], status())).toBe(false);
    for (const ticket of tickets.slice(1)) expect(cache.complete(ticket, status())).toBe(true);
    expect(cache.get('0', 0)).toBeUndefined(); for (let index = 1; index <= 256; index++) expect(cache.get(String(index), 0)).toBeDefined();
  });

  it('默认已完成事实仍最多256项，并按最近有效读取淘汰', () => {
    const cache = new CompletionServerFacts(); for (let index = 0; index < 256; index++) opened(cache, String(index));
    expect(cache.get('0', 0)).toBeDefined(); opened(cache, '新增'); expect(cache.get('1', 0)).toBeUndefined();
    expect(cache.get('0', 0)).toBeDefined(); expect(cache.get('新增', 0)).toBeDefined();
  });

  it('清除及新尝试只影响指定连接，不清空其它已完成事实', () => {
    const cache = new CompletionServerFacts(2); opened(cache, 'a'); opened(cache, 'b'); cache.clear('a'); const a = cache.begin('a', 1); cache.fail(a);
    expect(cache.get('a', 0)).toBeUndefined(); expect(cache.get('a', 1)).toBeUndefined(); expect(cache.get('b', 0)?.version).toBe('8.4.8');
  });

  it('容量0明确禁用，ticket仍只读且完成不产生条目', () => {
    const cache = new CompletionServerFacts(0), ticket = cache.begin('a', 0); expect(Object.isFrozen(ticket)).toBe(true);
    expect(cache.complete(ticket, status())).toBe(false); cache.fail(ticket); expect(cache.get('a', 0)).toBeUndefined();
  });

  it.each([-1, 1.5, NaN, Infinity, 257, '2'])('拒绝非法或放宽硬上限的容量：%s', capacity => { expect(() => new CompletionServerFacts(capacity as number)).toThrow(RangeError); });
});

describe('非法事实和修订不缓存', () => {
  it.each([undefined, null, '', '   ', 'v'.repeat(257), 8, {}, []])('非法版本%j消费当前pending，不能以同ticket补入', version => {
    const cache = new CompletionServerFacts(), ticket = cache.begin('a', 0);
    expect(cache.complete(ticket, { dialect: 'mysql', version } as ConnectionStatus)).toBe(false);
    expect(cache.complete(ticket, status())).toBe(false); expect(cache.get('a', 0)).toBeUndefined();
  });

  it.each([undefined, null, '', 'MYSQL', 'postgres', 1])('非法方言%j不推测、不缓存', dialect => {
    const cache = new CompletionServerFacts(), ticket = cache.begin('a', 0);
    expect(cache.complete(ticket, { dialect, version: '8.4.8' } as ConnectionStatus)).toBe(false); expect(cache.get('a', 0)).toBeUndefined();
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '0', undefined])('非法修订%j不缓存并撤销同ID旧事实', revision => {
    const cache = new CompletionServerFacts(); const old = opened(cache, 'a', 0); const ticket = cache.begin('a', revision as number);
    expect(Object.isFrozen(ticket)).toBe(true); expect(cache.complete(ticket, status())).toBe(false); expect(cache.complete(old, status())).toBe(false); expect(cache.get('a', 0)).toBeUndefined();
  });

  it('最大安全修订可精确命中，非法get修订不影响当前事实', () => {
    const cache = new CompletionServerFacts(); opened(cache, 'a', Number.MAX_SAFE_INTEGER);
    for (const revision of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(cache.get('a', revision)).toBeUndefined();
    expect(cache.get('a', Number.MAX_SAFE_INTEGER)?.version).toBe('8.4.8');
  });

  it.each(['', 'x'.repeat(201), undefined, null, 123])('非法逻辑ID%j不占用LRU或挤掉有效pending', id => {
    const cache = new CompletionServerFacts(1), current = cache.begin('有效', 0), invalid = cache.begin(id as string, 0);
    expect(cache.complete(invalid, status())).toBe(false); expect(cache.complete(current, status())).toBe(true); expect(cache.get('有效', 0)).toBeDefined();
  });

  it('字段读取异常不抛出、不缓存，下一次明确begin仍可完成', () => {
    const cache = new CompletionServerFacts(), ticket = cache.begin('a', 0), source: ConnectionStatus = { dialect: 'mysql', get version(): string { throw Error('非法版本读取'); } };
    expect(cache.complete(ticket, source)).toBe(false); expect(cache.get('a', 0)).toBeUndefined(); opened(cache, 'a');
    expect(cache.get('a', 0)?.version).toBe('8.4.8');
  });
});
