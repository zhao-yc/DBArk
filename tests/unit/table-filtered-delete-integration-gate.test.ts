import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** 提取真实入口守卫，不加载集成模块、引擎、文件系统观察器或认证环境。 */
function gate() {
  const source = ts.createSourceFile('integration.ts', readFileSync(new URL('../integration/table-filtered-delete.test.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'tableFilteredDeleteIntegrationEnabled');
  expect(functions).toHaveLength(1);
  const code = ts.transpileModule(functions[0].getText(source).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(code + '\ntableFilteredDeleteIntegrationEnabled') as (env: Record<string, string | undefined>, args: readonly string[]) => boolean;
}

/** 仅提取真实协调器函数，不载入实库helper的依赖、环境或Engine。 */
function mdlLifecycle() {
  const source = ts.createSourceFile('helper.ts', readFileSync(new URL('../helpers/tableFilteredDeleteIntegration.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'tableFilteredDeleteMdlLifecycle');
  expect(functions).toHaveLength(1);
  const code = ts.transpileModule(functions[0].getText(source).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(code + '\ntableFilteredDeleteMdlLifecycle') as typeof import('../helpers/tableFilteredDeleteIntegration').tableFilteredDeleteMdlLifecycle;
}

/** 独立能力期望只提取本测试helper，不引用产品版本判断。 */
function expectedCapability() {
  const source = ts.createSourceFile('helper.ts', readFileSync(new URL('../helpers/tableFilteredDeleteIntegration.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'tableFilteredDeleteExpectedCapability');
  expect(functions).toHaveLength(1);
  const code = ts.transpileModule(functions[0].getText(source).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(code + '\ntableFilteredDeleteExpectedCapability') as (dialect: string, version: string) => boolean;
}

/** 可显式交付的原Promise，用于区分调用close与真正完成close。 */
function pending<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe('删除实库专项默认及列表门', () => {
  it.each(['list', '--list', '--list=verbose'])('列表%s在任何环境访问之前短路', listing => {
    const env = new Proxy({}, { get() { throw Error('列表不得读取环境'); } });
    expect(gate()(env, ['node', 'vitest', listing])).toBe(false);
  });
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_TABLE_FILTERED_DELETE_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: 'true', DBARK_TABLE_FILTERED_DELETE_TEST: '1' }])('缺少明确双门只读两个开关', values => {
    const reads: string[] = [], env = new Proxy(values as Record<string, string>, { get(target, key: string) { reads.push(key); if (!['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_FILTERED_DELETE_TEST'].includes(key)) throw Error('默认不得读取认证'); return target[key]; } });
    expect(gate()(env, [])).toBe(false); expect(reads.every(key => key.startsWith('DBARK_'))).toBe(true);
  });
  it('准确双门才允许进入受控绑定，列表仍优先', () => {
    const env = { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_FILTERED_DELETE_TEST: '1' };
    expect(gate()(env, ['run'])).toBe(true); expect(gate()(env, ['run', '--list'])).toBe(false);
  });

  it.each(['8.0.46', '8.0.46-0ubuntu0.24.04.2', '8.4.11', '8.4.11-commercial'])('独立正能力只认可mysql %s', version => {
    expect(expectedCapability()('mysql', version)).toBe(true);
    expect(expectedCapability()('mariadb', version)).toBe(false);
  });

  it.each(['5.7.44', '10.11.19-MariaDB', '11.4.13-MariaDB', '5.5.5-11.4.13-MariaDB', '8.0.45', '8.0.47', '8.4.10', '8.4.12', '8.0.460', '8.4.11 ', '8.4.11-'])('未知或负能力%s不得因相邻版本升级为支持', version => {
    expect(expectedCapability()('mysql', version)).toBe(false);
    expect(expectedCapability()('mariadb', version)).toBe(false);
  });

  it('三个原整例保持原期限并真实走版本拒绝；拒绝分支不skip，MDL使用外部checks0', () => {
    const source = readFileSync(new URL('../integration/table-filtered-delete.test.ts', import.meta.url), 'utf8');
    const negative = source.slice(source.indexOf('    if(!expectedCapability){'), source.indexOf("    }else if(kind==='main')"));
    expect(negative).toContain("await preview('unsupported')"); expect(negative).toContain('tableFilteredDeleteExpectedVersionError');
    expect(negative).toContain('expect(rejected.facts).toHaveLength(1)'); expect(negative).toContain('expect(rejected.sent).toEqual([])');
    expect(negative).toContain('snapshotBytes:0,dmlMayHaveBeenSent:false,commitMayHaveBeenSent:false,commitAcknowledged:false,rollbackAcknowledged:false');
    expect(negative).not.toContain('.skip(');
    expect(source.match(/await scenario\(context,'(?:main|mdl|cancel)'\)/g)).toHaveLength(3);
    expect(source.match(/timeout:120000,retry:0,repeats:0/g)).toHaveLength(3);
    expect(source).toContain("(ddl,'SET SESSION foreign_key_checks=0')");
    expect(source).toContain("expect(checks.rows).toEqual([{foreignKeyChecks:'0'}])");
  });
});

describe('删除MDL原终态与异常收尾', () => {
  it('意外DDL成功仍失败，主RPC收尾必须等待真实close且不能重试', async () => {
    const terminal: unknown[] = [], closed = pending<void>(), started = pending<void>(), first = Error('真实DDL意外成功');
    const lifecycle = mdlLifecycle()<number>(() => undefined, value => { terminal.push(value); });
    let closes = 0;
    lifecycle.track(31, async () => { closes++; started.resolve(); await closed.promise; });
    expect(await lifecycle.start(async () => 7)).toEqual({ value: 7 }); lifecycle.fail(first);
    const finishing = lifecycle.finish(); const rejection = expect(finishing).rejects.toBe(first);
    await started.promise; expect(lifecycle.resources).toEqual([{ id: 31, closed: false }]);
    closed.resolve(); await rejection;
    expect(lifecycle.terminal).toEqual({ value: 7 }); expect(terminal).toEqual([{ value: 7 }]);
    expect(lifecycle.resources).toEqual([{ id: 31, closed: true }]);
    await expect(lifecycle.finish()).rejects.toBe(first); expect(closes).toBe(1);
  });

  it('原KILL后真实DDL错误与两条原连接正常关闭可收尾，错误不会被改成成功', async () => {
    const interrupted = Error('原DDL已被准确取消'), order: number[] = [];
    const lifecycle = mdlLifecycle()(() => undefined);
    lifecycle.track(41, async () => { order.push(41); }); lifecycle.track(42, async () => { order.push(42); });
    expect(await lifecycle.start(async () => { throw interrupted; })).toEqual({ error: interrupted });
    await lifecycle.close(); await lifecycle.finish();
    expect(lifecycle.terminal).toEqual({ error: interrupted }); expect(lifecycle.failed).toBe(false);
    expect(order).toEqual([41, 42]); expect(lifecycle.resources.every(value => value.closed)).toBe(true);
  });

  it('意外DDL同步失败仅记录一次真实错误，仍关闭原连接并回报观察首因', async () => {
    const ddlFailure = Error('原ALTER同步失败'), first = Error('未出现真实MDL等待'), terminal: unknown[] = [];
    let closes = 0;
    const lifecycle = mdlLifecycle()(() => undefined, value => { terminal.push(value); });
    lifecycle.track(45, async () => { closes++; });
    expect(await lifecycle.start(() => { throw ddlFailure; })).toEqual({ error: ddlFailure });
    lifecycle.fail(first); await expect(lifecycle.finish()).rejects.toBe(first);
    expect(terminal).toEqual([{ error: ddlFailure }]); expect(closes).toBe(1);
    expect(lifecycle.resources).toEqual([{ id: 45, closed: true }]);
  });

  it('观察先失败时保留原在途DDL，finally等原终态后才close并保留首因', async () => {
    const ddl = pending<number>(), first = Error('原线程观察首因'), later = Error('严格关闭失败'), order: number[] = [];
    const lifecycle = mdlLifecycle()<number>(() => undefined);
    lifecycle.track(51, async () => { order.push(51); throw later; }); lifecycle.track(52, async () => { order.push(52); });
    const original = lifecycle.start(() => ddl.promise); lifecycle.fail(first);
    const finishing = lifecycle.finish(); const rejection = expect(finishing).rejects.toBe(first);
    expect(order).toEqual([]); expect(lifecycle.terminal).toBeUndefined();
    ddl.resolve(9); expect(await original).toEqual({ value: 9 }); await rejection;
    expect(order).toEqual([51, 52]); expect(lifecycle.failure).toBe(first);
    expect(lifecycle.closeFailures).toEqual([{ id: 51, error: later }]);
    expect(lifecycle.resources).toEqual([{ id: 51, closed: false }, { id: 52, closed: true }]);
  });

  it('未完成DDL不得在持锁暂停中等待close，原owner失效也不合成关闭', async () => {
    const ddl = pending<number>(), expired = Error('原owner已失效'); let valid = true, closes = 0;
    const lifecycle = mdlLifecycle()<number>(() => { if (!valid) throw expired; });
    lifecycle.track(61, async () => { closes++; }); const original = lifecycle.start(() => ddl.promise);
    await expect(lifecycle.close()).rejects.toThrow('原DDL尚未真实终结'); expect(closes).toBe(0);
    ddl.reject(Error('真实DDL失败')); expect(await original).toHaveProperty('error'); valid = false;
    await expect(lifecycle.finish()).rejects.toBe(expired); expect(closes).toBe(0);
    expect(lifecycle.resources).toEqual([{ id: 61, closed: false }]);
  });

  it('真实入口在主RPC finally回收后才等fact.closed，保留原等待失败及准确取消门', () => {
    const source = readFileSync(new URL('../integration/table-filtered-delete.test.ts', import.meta.url), 'utf8');
    const invoke = source.slice(source.indexOf('const invoke=async'), source.indexOf("expect((await invoke('connections.open'"));
    expect(invoke).toContain("finally{rpcSettled=true;if(kind==='mdl'&&scope==='table.filteredDelete.apply:mdl')await mdlLifecycle.finish();}");
    expect(invoke.indexOf('await mdlLifecycle.finish()')).toBeLessThan(invoke.indexOf('for(const fact of current)'));
    expect(source).toContain("if(ddlSettled)throw Error('外部ADD FK未在原删除事务持写锁时等待");
    expect(source).toContain("expect('error' in stopped).toBe(true)");
    expect(source).toContain("rows[0].state==='Waiting for table metadata lock'&&rows[0].info===plan.mdlSql");
    expect(source).toContain("}catch(error){mdlLifecycle.fail(error);throw error;}finally{audit.scope=data.scope;}");
  });
});
