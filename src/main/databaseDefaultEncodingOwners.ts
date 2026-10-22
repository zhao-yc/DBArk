import type { ColumnsInvocation } from './columnsMainCapabilities';
import { databaseDefaultEncodingAcknowledgements, type DatabaseDefaultEncodingTarget } from '../shared/databaseDefaultEncoding';
import type { TableEncodingPair } from '../shared/tableDefaultEncoding';

type Command = 'get' | 'preview' | 'apply' | 'release';
export type DatabaseEncodingOwnerCommand = Command;
type TokenInput = { snapshotId?: string; previewToken?: string };
interface Ports {
  assert(owner: ColumnsInvocation): void;
  same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  release(input: TokenInput): Promise<unknown>;
}
interface Snapshot {
  owner: ColumnsInvocation; target: DatabaseDefaultEncodingTarget; expires: number;
  current: TableEncodingPair; definitionHash: string; catalogDigest: string;
}
interface Preview extends Snapshot { parent: Snapshot; snapshotId: string; after: TableEncodingPair; }
interface Request {
  command: Command; input: unknown; target?: DatabaseDefaultEncodingTarget; parent?: Snapshot;
  snapshotId?: string; selection?: TableEncodingPair; claimed?: Preview; reserved: boolean;
  issued?: { token: string; kind: 'snapshot' | 'preview'; record: Snapshot | Preview };
  cleanup?: Promise<never>; settled: boolean; published?: boolean;
}
const stale = '数据库默认编码能力已失效或来源不符，请重新读取；不会自动重试结构修改';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/i;
const ttl = 120000;
const cap = 64;

/** 只读取普通数据属性，拒绝访问器，避免验证阶段调用未知代码。 */
function object(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw Error('数据库默认编码响应格式无效');
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.some(key => typeof key !== 'string' || ![...keys, ...optional].includes(key)) || keys.some(key => !Object.hasOwn(descriptors, key)) ||
    names.some(key => !Object.hasOwn(descriptors[key as string], 'value') || !descriptors[key as string].enumerable)) throw Error('数据库默认编码响应字段无效');
  return Object.fromEntries(names.map(key => [key, descriptors[key as string].value]));
}
/** 文案与目录都有上限；拒绝稀疏数组及自定义属性。 */
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) throw Error('数据库默认编码响应列表无效');
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('数据库默认编码响应列表无效');
    result.push(descriptor.value);
  }
  return result;
}
/** 不对名称trim、折叠大小写或猜测字符集别名。 */
function text(value: unknown, maximum = 8192, nonempty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (nonempty && !value.length) || /[\u0000]/.test(value)) throw Error('数据库默认编码响应文本无效');
  return value;
}
function pair(value: unknown): TableEncodingPair {
  const data = object(value, ['charset', 'collation']);
  if (typeof data.charset !== 'string' || typeof data.collation !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(data.charset) || !/^[A-Za-z0-9_]{1,255}$/.test(data.collation)) throw Error('数据库默认编码响应配对无效');
  return { charset: data.charset, collation: data.collation };
}
function samePair(left: TableEncodingPair, right: TableEncodingPair): boolean { return left.charset === right.charset && left.collation === right.collation; }
function target(value: unknown): DatabaseDefaultEncodingTarget {
  const data = object(value, ['connectionId', 'database']);
  return { connectionId: text(data.connectionId, 256, true), database: text(data.database, 64, true) };
}
function sameTarget(left: DatabaseDefaultEncodingTarget, right: DatabaseDefaultEncodingTarget): boolean { return left.connectionId === right.connectionId && left.database === right.database; }
function strings(value: unknown): string[] { return list(value, 128).map(item => text(item)); }
/** 只识别已知字段上的数据UUID；错误响应不能借此撤销已有其它能力。 */
function returnedToken(command: Command, result: unknown): string | undefined {
  if ((command !== 'get' && command !== 'preview') || !result || typeof result !== 'object') return;
  const descriptor = Object.getOwnPropertyDescriptor(result, command === 'get' ? 'snapshotId' : 'previewToken');
  return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' && uuid.test(descriptor.value) ? descriptor.value : undefined;
}

/** 单独绑定数据库默认编码能力与真实文档，不复用其它结构用途的通用令牌。 */
export class DatabaseDefaultEncodingOwners {
  // 到期只禁止使用，释放合同仍保留；活跃、过期记录及在途签发共用64项预算。
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly previews = new Map<string, Preview>();
  private readonly requests = new WeakMap<ColumnsInvocation, Request>();
  private reservations = 0;
  constructor(private readonly ports: Ports, private readonly now: () => number = Date.now) {}

  /** 精确撤销父快照与派生预览，只在明确释放或本次发布清理时归还容量。 */
  private removeSnapshot(token: string, snapshot: Snapshot): void {
    if (this.snapshots.get(token) !== snapshot) return;
    this.snapshots.delete(token);
    for (const [id, preview] of this.previews) if (preview.parent === snapshot) this.previews.delete(id);
  }
  /** 所有子能力必须沿原父对象生存，不能用同ID替换或过期重建复活。 */
  private assertSnapshot(snapshotId: string, snapshot: Snapshot, owner: ColumnsInvocation): void {
    this.ports.assert(snapshot.owner);
    if (this.snapshots.get(snapshotId) !== snapshot || snapshot.expires <= this.now() || !this.ports.same(snapshot.owner, owner)) throw Error(stale);
  }
  /** 在首个异步调用前检查并同步消费apply/release，错误后也不复活。 */
  before(command: Command, input: unknown, owner: ColumnsInvocation): void {
    this.ports.assert(owner);
    if (this.requests.has(owner)) throw Error('数据库默认编码请求不可重复使用');
    const request: Request = { command, input, reserved: false, settled: false };
    if (command === 'get') {
      const data = object(input, ['connectionId', 'database', 'taskId']);
      request.target = target({ connectionId: data.connectionId, database: data.database });
    } else if (command === 'preview') {
      const data = object(input, ['snapshotId', 'charset', 'collation', 'taskId']);
      const snapshot = typeof data.snapshotId === 'string' ? this.snapshots.get(data.snapshotId) : undefined;
      if (!snapshot) throw Error(stale);
      this.assertSnapshot(data.snapshotId as string, snapshot, owner);
      request.parent = snapshot; request.snapshotId = data.snapshotId as string; request.target = snapshot.target;
      request.selection = pair({ charset: data.charset, collation: data.collation });
    } else if (command === 'apply') {
      const data = object(input, ['previewToken', 'confirmation', 'acknowledgements', 'taskId']);
      const preview = typeof data.previewToken === 'string' ? this.previews.get(data.previewToken) : undefined;
      if (!preview || preview.expires <= this.now() || !this.ports.same(preview.owner, owner)) throw Error(stale);
      this.assertSnapshot(preview.snapshotId, preview.parent, owner);
      request.claimed = preview; request.target = preview.target;
      this.previews.delete(data.previewToken as string);
    } else {
      const data = object(input, [], ['snapshotId', 'previewToken']);
      if (!Object.hasOwn(data, 'snapshotId') && !Object.hasOwn(data, 'previewToken')) throw Error('释放数据库默认编码能力必须提供令牌');
      const snapshot = typeof data.snapshotId === 'string' ? this.snapshots.get(data.snapshotId) : undefined;
      const preview = typeof data.previewToken === 'string' ? this.previews.get(data.previewToken) : undefined;
      // 先验证全部，防组合输入的一项非法却已撤销另一项。
      if ((Object.hasOwn(data, 'snapshotId') && (!snapshot || !this.ports.same(snapshot.owner, owner))) ||
        (Object.hasOwn(data, 'previewToken') && (!preview || !this.ports.same(preview.owner, owner)))) throw Error(stale);
      if (snapshot) this.removeSnapshot(data.snapshotId as string, snapshot);
      if (preview) this.previews.delete(data.previewToken as string);
    }
    if (command === 'get' || command === 'preview') {
      if (this.snapshots.size + this.previews.size + this.reservations >= cap) throw Error('数据库默认编码能力已达64项，请先关闭已有设计器并释放旧快照');
      request.reserved = true; this.reservations++;
    }
    this.requests.set(owner, request);
  }

  /** 任何引擎失败都要释放并发占位；已消费的apply能力绝不恢复。 */
  failed(owner: ColumnsInvocation): void {
    const request = this.requests.get(owner);
    if (request?.reserved) { request.reserved = false; this.reservations--; }
  }
  /** 格式与目标全部核对后才登记响应，失败先等待精确清理，不吞清理错误。 */
  async after(command: Command, input: unknown, result: unknown, owner: ColumnsInvocation): Promise<void> {
    const request = this.requests.get(owner);
    try {
      if (!request || request.command !== command || request.input !== input || request.settled) throw Error(stale);
      request.settled = true;
      if (command === 'release') return; // 原清理已开始后，关闭文档不撤销清理本身。
      this.ports.assert(owner);
      if (command === 'get' || command === 'preview') this.register(command, result, owner, request);
      else this.checkApply(result, request);
    } catch (error) { return await this.rejectPublication(command, result, owner, error); }
    finally { this.failed(owner); }
  }

  private expiry(value: unknown): number {
    const string = text(value, 64, true), expires = Date.parse(string), now = this.now();
    if (!Number.isFinite(expires) || new Date(expires).toISOString() !== string || expires <= now || expires > now + ttl) throw Error('数据库默认编码响应期限无效');
    return expires;
  }
  /** 只接受完整Engine合同，预览严格绑定原目标、原定义和本次选择。 */
  private register(command: 'get' | 'preview', result: unknown, owner: ColumnsInvocation, request: Request): void {
    const data = object(result, command === 'get' ? ['target', 'snapshotId', 'expiresAt', 'definitionHash', 'catalogDigest', 'current', 'candidates', 'writable', 'reasons', 'warnings', 'serverVersion'] :
      ['target', 'before', 'after', 'previewToken', 'expiresAt', 'definitionHash', 'catalogDigest', 'sql', 'warnings', 'requiredAcknowledgements']);
    const id = returnedToken(command, result), actualTarget = target(data.target), expires = this.expiry(data.expiresAt);
    if (!id || this.snapshots.has(id) || this.previews.has(id) || !request.target || !sameTarget(actualTarget, request.target) ||
      typeof data.definitionHash !== 'string' || !hash.test(data.definitionHash) || typeof data.catalogDigest !== 'string' ||
      (!hash.test(data.catalogDigest) && !(command === 'get' && data.catalogDigest === '' && data.writable === false && strings(data.reasons).length > 0))) throw Error('数据库默认编码响应身份无效');
    strings(data.warnings);
    let record: Snapshot | Preview;
    if (command === 'get') {
      const current = pair(data.current), candidates = list(data.candidates, 8192).map(pair);
      if (new Set(candidates.map(item => `${item.charset}/${item.collation}`)).size !== candidates.length || candidates.reduce((sum, item) => sum + item.charset.length + item.collation.length, 0) > 2 * 1024 * 1024 || typeof data.writable !== 'boolean') throw Error('数据库默认编码响应目录无效');
      strings(data.reasons); text(data.serverVersion, 1024, true);
      record = { owner, target: actualTarget, expires, current, definitionHash: data.definitionHash, catalogDigest: data.catalogDigest };
      this.snapshots.set(id, record);
    } else {
      const parent = request.parent!, before = pair(data.before), after = pair(data.after);
      this.assertSnapshot(request.snapshotId!, parent, owner);
      const acknowledgements = strings(data.requiredAcknowledgements);
      if (!samePair(before, parent.current) || !samePair(after, request.selection!) || data.definitionHash !== parent.definitionHash || data.catalogDigest !== parent.catalogDigest ||
        acknowledgements.length !== databaseDefaultEncodingAcknowledgements.length || databaseDefaultEncodingAcknowledgements.some(item => acknowledgements.filter(value => value === item).length !== 1)) throw Error('数据库默认编码预览与原快照不符');
      text(data.sql, 65536, true);
      record = { ...parent, owner, expires: Math.min(expires, parent.expires), parent, snapshotId: request.snapshotId!, after };
      this.previews.set(id, record as Preview);
    }
    request.issued = { token: id, kind: command === 'get' ? 'snapshot' : 'preview', record };
  }
  /** 执行回执只能对应本次已消费预览，不能重新签发能力。 */
  private checkApply(result: unknown, request: Request): void {
    const data = object(result, ['target', 'ddlSubmitted', 'ddlCompleted', 'definitionVerified', 'before', 'after', 'warnings'], ['verificationError']);
    if (!request.claimed || !sameTarget(target(data.target), request.claimed.target) || data.ddlSubmitted !== true || data.ddlCompleted !== true || typeof data.definitionVerified !== 'boolean' ||
      !samePair(pair(data.before), request.claimed.current) || (data.definitionVerified === true && !samePair(pair(data.after), request.claimed.after))) throw Error('数据库默认编码执行回执不符；结果可能已经提交，不能重试');
    // 后核失败时实际观察值可能不同，仍必须是合法配对；保留它供人工核对，不能伪装原计划。
    pair(data.after);
    strings(data.warnings); if (Object.hasOwn(data, 'verificationError')) text(data.verificationError);
  }

  /** Root在最后一次await之后同步调用；成功返回后不得再await才交付IPC。 */
  assertPublication(command: Command, result: unknown, owner: ColumnsInvocation): void {
    const request = this.requests.get(owner);
    if (!request || request.command !== command || !request.settled || request.cleanup) throw Error(stale);
    if (command === 'release') return;
    this.ports.assert(owner);
    if (command === 'get' || command === 'preview') {
      const issued = request.issued;
      if (!issued || returnedToken(command, result) !== issued.token || issued.record.expires <= this.now() ||
        (issued.kind === 'snapshot' ? this.snapshots.get(issued.token) : this.previews.get(issued.token)) !== issued.record) throw Error(stale);
      if (issued.kind === 'preview') this.assertSnapshot((issued.record as Preview).snapshotId, (issued.record as Preview).parent, owner);
    }
    request.published = true;
  }
  /** 仅撤销本次新签发的精确对象，绝不删除相同ID的既有能力；清理完成前拒绝响应不结束。 */
  rejectPublication(command: Command, result: unknown, owner: ColumnsInvocation, error: unknown): Promise<never> {
    const request = this.requests.get(owner); this.failed(owner);
    if (request?.cleanup) return request.cleanup;
    const issued = request?.issued, returned = returnedToken(command, result);
    let release: TokenInput | undefined;
    if (request && request.command === command && !request.published && issued && returned === issued.token) {
      if (issued.kind === 'snapshot' && this.snapshots.get(issued.token) === issued.record) { this.removeSnapshot(issued.token, issued.record); release = { snapshotId: issued.token }; }
      else if (issued.kind === 'preview' && this.previews.get(issued.token) === issued.record) { this.previews.delete(issued.token); release = { previewToken: issued.token }; }
    } else if (request && request.command === command && !request.published && returned && !this.snapshots.has(returned) && !this.previews.has(returned)) release = command === 'get' ? { snapshotId: returned } : { previewToken: returned };
    const cleanup = (async (): Promise<never> => {
      if (release) {
        try { await this.ports.release(release); }
        catch (failure) { throw new AggregateError([error, failure], '数据库默认编码响应失效且资源清理失败；原错误与清理错误均保留'); }
      }
      throw error;
    })();
    if (request) request.cleanup = cleanup;
    return cleanup;
  }
}
