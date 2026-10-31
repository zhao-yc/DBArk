import { describe, expect, it } from 'vitest';
import type { NetworkConnectionProfile as ConnectionProfile } from '../../src/shared/contracts';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import { bindTableDraft, assertTableDraftBinding, tableDraftEndpointKey } from '../../src/main/tableDraftBinding';
import { tableDraftOpenSchema, tableDraftSaveSchema, tableDraftVerifySchema } from '../../src/shared/tableDraftCommands';
import type { TableDraftPayload } from '../../src/shared/tableDraft';

/** 所有凭据和路径均为合成值；测试不读取本机文件或连接数据库。 */
function profile(): ConnectionProfile {
  return {
    id: 'connection-a', name: '开发库', group: '测试', color: '#008080', dialect: 'mysql',
    host: 'database.internal.test', port: 3306, user: 'dbark_test', database: 'default_db',
    password: 'synthetic-database-secret', rememberPassword: true,
    ssh: { enabled: true, host: 'gateway.internal.test', port: 22, user: 'ssh_test', password: 'synthetic-ssh-secret', privateKeyPath: 'Z:/synthetic/private.key', passphrase: 'synthetic-key-phrase', hostFingerprint: 'SHA256:synthetic-host-fingerprint' },
    tls: { enabled: true, rejectUnauthorized: true, caPath: 'Z:/synthetic/ca.pem', certPath: 'Z:/synthetic/client.pem', keyPath: 'Z:/synthetic/client.key', passphrase: 'synthetic-tls-phrase' },
  };
}
/** 目标表与默认库刻意不同，文件只绑定显式目标，不依赖当前默认数据库。 */
function payload(): TableDraftPayload {
  return { target: { connectionId: 'connection-a', database: '草稿库', table: 'subject' }, metadataKey: '有界结构摘要', changes: [{ kind: 'update', before: { id: '18446744073709551615', value: '旧值' }, values: { value: '新值' } }] };
}
function verifyInput() { const value = payload(); return { ...value.target, taskId: '11111111-1111-4111-8111-111111111111', metadataKey: value.metadataKey, changes: value.changes }; }

/** 构造自有可枚举访问器，断言失败时也不能读取其返回值。 */
function withGetter(value: object, key: string, read: () => unknown): object {
  const result = { ...value }; Object.defineProperty(result, key, { enumerable: true, configurable: true, get: read }); return result;
}

describe('表格草稿绑定主进程当前端点', () => {
  it('保存绑定当前端点且只输出摘要，不夹带连接凭据、路径或配置', () => {
    const connection = profile(), source = payload(), document = bindTableDraft(source, connection);
    expect(document).toEqual({ kind: 'dbark.table-draft', version: 1, ...source, endpointKey: tableDraftEndpointKey(connection) });
    expect(document.endpointKey).toMatch(/^[a-f0-9]{64}$/);
    const encoded = JSON.stringify(document);
    for (const secret of [connection.password!, connection.ssh!.password!, connection.ssh!.privateKeyPath!, connection.ssh!.passphrase!, connection.tls!.caPath!, connection.tls!.certPath!, connection.tls!.keyPath!, connection.tls!.passphrase!]) expect(encoded).not.toContain(secret);
    expect(() => assertTableDraftBinding(document, source.target, connection)).not.toThrow();
  });

  it('轮换数据库与SSH密码、私钥路径及TLS材料不改变原目标绑定', () => {
    const old = profile(), next = profile();
    next.password = 'rotated-db-secret'; next.ssh = { ...next.ssh!, password: 'rotated-ssh-secret', privateKeyPath: 'Y:/rotated/key', passphrase: 'rotated-key-phrase' };
    next.tls = { ...next.tls!, caPath: 'Y:/rotated/ca', certPath: 'Y:/rotated/cert', keyPath: 'Y:/rotated/tls-key', passphrase: 'rotated-tls-phrase' };
    expect(tableDraftEndpointKey(next)).toBe(tableDraftEndpointKey(old));
    expect(() => assertTableDraftBinding(bindTableDraft(payload(), old), payload().target, next)).not.toThrow();
  });

  it('不读取密码、私钥及证书属性；摘要生成不会隐式取得凭据', () => {
    let reads = 0; const connection = profile(), original = tableDraftEndpointKey(connection);
    const getter = () => { reads++; throw new Error('不得读取凭据'); };
    Object.defineProperty(connection, 'password', { enumerable: true, get: getter });
    for (const field of ['password', 'privateKeyPath', 'passphrase']) Object.defineProperty(connection.ssh!, field, { enumerable: true, get: getter });
    for (const field of ['caPath', 'certPath', 'keyPath', 'passphrase']) Object.defineProperty(connection.tls!, field, { enumerable: true, get: getter });
    expect(tableDraftEndpointKey(connection)).toBe(original); expect(reads).toBe(0);
  });

  it.each(['host', 'port', 'user', 'dialect'] as const)('同一连接ID修改%s后拒绝领取旧草稿', key => {
    const old = profile(), next = profile();
    if (key === 'host') next.host = 'another.internal.test';
    if (key === 'port') next.port = 3307;
    if (key === 'user') next.user = 'another_user';
    if (key === 'dialect') next.dialect = 'mariadb';
    expect(next.id).toBe(old.id); expect(tableDraftEndpointKey(next)).not.toBe(tableDraftEndpointKey(old));
    expect(() => assertTableDraftBinding(bindTableDraft(payload(), old), payload().target, next)).toThrow('不属于');
  });

  it.each(['enabled', 'host', 'port', 'user', 'hostFingerprint'] as const)('SSH的%s变化不能继承旧端点授权', key => {
    const old = profile(), next = profile();
    if (key === 'enabled') next.ssh!.enabled = false;
    if (key === 'host') next.ssh!.host = 'another-gateway.internal.test';
    if (key === 'port') next.ssh!.port = 2222;
    if (key === 'user') next.ssh!.user = 'another_ssh_user';
    if (key === 'hostFingerprint') next.ssh!.hostFingerprint = 'SHA256:rotated-host-fingerprint';
    expect(tableDraftEndpointKey(next)).not.toBe(tableDraftEndpointKey(old));
    expect(() => assertTableDraftBinding(bindTableDraft(payload(), old), payload().target, next)).toThrow('不属于');
  });

  it('显示名称、分组、颜色及默认库改变不会改写显式表目标的绑定', () => {
    const old = profile(), next = { ...old, name: '重命名', group: '其它分组', color: '#ff0000', database: 'another_default' };
    expect(tableDraftEndpointKey(next)).toBe(tableDraftEndpointKey(old));
    expect(() => assertTableDraftBinding(bindTableDraft(payload(), old), payload().target, next)).not.toThrow();
  });

  it.each(['connectionId', 'database', 'table'] as const)('文件的精确%s不一致时整份拒绝，不修改请求目标', key => {
    const source = payload(), target = { ...source.target, [key]: '另一个目标' }, before = structuredClone(target);
    expect(() => assertTableDraftBinding(bindTableDraft(source, profile()), target, profile())).toThrow('不属于');
    expect(target).toEqual(before);
  });

  it('保存深复制原草稿，绑定后修改源对象不会换目标或原值', () => {
    const source = payload(), document = bindTableDraft(source, profile()); source.target.table = 'changed';
    const change = source.changes[0]; if (change.kind !== 'update') throw new Error('测试准备错误'); change.before.value = 'changed'; change.values.value = 'changed';
    expect(document.target.table).toBe('subject'); expect(document.changes).toEqual(payload().changes);
  });
});

describe('草稿文件与只读复核的公开IPC边界', () => {
  it('三个命令均注册公开桥接并经validateCommand校验，payload保持无损深复制', () => {
    const source = payload(), opened = { target: source.target }, saved = { payload: source }, verified = verifyInput();
    for (const command of ['tableDraftFiles.open', 'tableDraftFiles.save', 'table.draftVerify'] as const) expect(Object.hasOwn(publicCommands, command) && publicCommands[command]).toBe(true);
    expect(validateCommand('tableDraftFiles.open', opened)).toEqual(opened);
    const parsed = validateCommand('tableDraftFiles.save', saved);
    expect(parsed).toEqual(saved); expect(parsed).not.toBe(saved);
    expect(validateCommand('table.draftVerify', verified)).toEqual(verified);
    expect(tableDraftOpenSchema.parse(opened)).toEqual(opened); expect(tableDraftSaveSchema.parse(saved)).toEqual(saved); expect(tableDraftVerifySchema.parse(verified)).toEqual(verified);
  });

  it('外壳、目标、原值与修改值访问器全部在执行前拒绝', () => {
    let reads = 0; const read = () => { reads++; return '不得读取'; }, source = payload(), request = verifyInput();
    const values: [string, unknown][] = [
      ['tableDraftFiles.open', withGetter({ target: source.target }, 'target', read)],
      ['tableDraftFiles.save', withGetter({ payload: source }, 'payload', read)],
      ['table.draftVerify', withGetter(request, 'taskId', read)],
      ['tableDraftFiles.open', { target: withGetter(source.target, 'table', read) }],
      ['tableDraftFiles.save', { payload: withGetter(source, 'changes', read) }],
      ['tableDraftFiles.save', { payload: { ...source, changes: [withGetter(source.changes[0], 'before', read)] } }],
      ['table.draftVerify', { ...request, changes: [{ kind: 'insert', values: withGetter({ id: '1' }, 'id', read) }] }],
    ];
    for (const [command, value] of values) expect(() => validateCommand(command, value)).toThrow();
    expect(reads).toBe(0);
  });

  it('继承、隐藏及多余字段不能变成文件路径、SQL或端点授权', () => {
    const source = payload(), request = verifyInput(), inherited = Object.assign(Object.create({ inherited: true }), request);
    const hidden = { ...request }; Object.defineProperty(hidden, 'taskId', { enumerable: false, value: request.taskId });
    const symbol = { ...request, [Symbol('secret')]: true };
    for (const value of [inherited, hidden, symbol, { ...request, sql: 'DELETE FROM anything' }, { ...request, filePath: 'Z:/private' }, { ...request, endpointKey: 'a'.repeat(64) }]) expect(() => validateCommand('table.draftVerify', value)).toThrow();
    expect(() => validateCommand('tableDraftFiles.open', { target: source.target, filePath: 'Z:/private' })).toThrow();
    expect(() => validateCommand('tableDraftFiles.save', { payload: source, endpointKey: 'a'.repeat(64) })).toThrow();
    expect(() => validateCommand('tableDraftFiles.save', { payload: { ...source, endpointKey: 'a'.repeat(64) } })).toThrow();
  });

  it.each(['', 'arbitrary-task', '11111111-1111-4111-8111-11111111111', '11111111-1111-4111-8111-111111111111-extra', undefined, null, 1])('拒绝无效任务编号 %#', taskId => {
    expect(tableDraftVerifySchema.safeParse({ ...verifyInput(), taskId }).success).toBe(false);
    expect(() => validateCommand('table.draftVerify', { ...verifyInput(), taskId })).toThrow();
  });

  it('空原型的精确数据字段可用，合法数据库原型同名列不被误拒', () => {
    const source = payload(); source.changes = [{ kind: 'insert', values: Object.fromEntries([['__proto__', '原值'], ['constructor', null]]) }];
    const wrapped = Object.assign(Object.create(null), { payload: source });
    expect(validateCommand('tableDraftFiles.save', wrapped)).toEqual({ payload: source });
  });
});