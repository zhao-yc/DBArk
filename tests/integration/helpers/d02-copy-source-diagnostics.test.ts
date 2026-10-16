import { describe, expect, it } from 'vitest';
import { c02Failure } from './c02-mtls-policy';
import { D02FixtureError, d02Failure } from './d02-copy-source-policy';

const mdl = 'D02服务器未提供真实MDL观察条件；不自动修改全局设置';
const resource = 'dbark_e2e_d02_0123456789ab';
const caseStage = `D02验收失败；本轮数据库${resource}；临时用户未创建`;
const finalStage = `D02验收或清理失败；保留现场核对入口${resource}/无临时用户；真实CREATE状态：用户absent、库absent；DROP成功响应：用户false、库false；确认删除：用户false、库false`;

/** 仅检查脱敏产物的自有数据属性；不执行未知getter，不把私有输入交给失败断言展开。 */
function text(error: unknown): string {
  const seen = new Set<object>(), values: string[] = [];
  function visit(value: unknown, depth = 0) { if (!value || typeof value !== 'object' || seen.has(value) || depth > 12) return; seen.add(value); for (const key of Object.getOwnPropertyNames(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor)) continue; if (typeof descriptor.value === 'string') values.push(descriptor.value); else if (Array.isArray(descriptor.value)) descriptor.value.forEach(item => visit(item, depth + 1)); else visit(descriptor.value, depth + 1); } }
  visit(error); return values.join('\n');
}

describe('D02私有固定分类与重复脱敏回归', () => {
  it('复现run877包装层级：二次脱敏后固定MDL前提仍在最外层可辨', () => { const result = d02Failure(finalStage, d02Failure(caseStage, new D02FixtureError(mdl))); expect(result.message).toContain('D02_PREFLIGHT_MDL'); expect(result.message).toContain(mdl); });
  it('多次包装及AggregateError仍保留固定原因，长度有界', () => { let result: Error = new D02FixtureError(mdl); for (let i = 0; i < 8; i++) result = d02Failure('D02验证或操作无法确认，永久保留现场', new AggregateError([result, new Error('敏感驱动原文')])); expect(result.message).toContain('D02_PREFLIGHT_MDL'); expect(result.message).toContain(mdl); expect(result.message.length).toBeLessThan(4096); expect(text(result)).not.toContain('敏感驱动原文'); });
  it('driver原文、SQL、参数、凭据及行值不输出，错误编号保持', () => { const raw = Object.assign(new Error('敏感驱动内容'), { sql: '敏感SQL', params: ['敏感参数'], password: '敏感口令', row: { value: '敏感行值' }, errno: 1142 }); const result = d02Failure('D02夹具写响应未知，保留现场且未重放', raw); expect(text(result)).not.toContain('敏感'); expect((result.cause as { errno: number }).errno).toBe(1142); });
  it('未登记D02消息和外部阶段不提升为可信文字', () => { const result = d02Failure('敏感外部阶段', new D02FixtureError('敏感未登记内容')); expect(text(result)).not.toContain('敏感'); });
  it('伪造固定message、code或诊断属性不能冒充私有固定分类', () => { const raw = Object.assign(new Error(mdl), { code: 'D02_PREFLIGHT_MDL', d02Diagnostics: [mdl] }); const result = d02Failure('固定阶段失败', raw); expect(text(result)).not.toContain('D02_PREFLIGHT_MDL'); expect(text(result)).not.toContain(mdl); });
  it('公共C02不因D02而增加消息信任范围', () => { for (const reason of [new D02FixtureError(mdl), d02Failure(caseStage, new D02FixtureError(mdl))]) { const result = c02Failure('公共固定阶段', reason); expect(result.cause).toBeInstanceOf(Error); expect((result.cause as Error).message).toBe('底层失败详情已脱敏'); } });
  it('曾登记的包装message被篡改也不变成可信内容，固定分类仍独立保留', () => { const previous = d02Failure(caseStage, new D02FixtureError(mdl)); previous.message = '敏感篡改内容'; const result = d02Failure(finalStage, previous); expect(text(result)).not.toContain('敏感'); expect(result.message).toContain('D02_PREFLIGHT_MDL'); expect(result.message).toContain(mdl); });
  it('未知getter失败不能抛出未脱敏原文', () => { const raw = Object.defineProperty(new Error('敏感原文'), 'cause', { get() { throw new Error('敏感getter'); } }); let result: Error | undefined; expect(() => { result = d02Failure('固定阶段失败', raw); }).not.toThrow(); expect(text(result)).not.toContain('敏感'); });
  it('未知Proxy读取失败不能绕过脱敏边界', () => { const raw = new Proxy(new Error('敏感Proxy内容'), { getOwnPropertyDescriptor() { throw new Error('敏感描述器'); }, get() { throw new Error('敏感属性'); } }); let result: Error | undefined; expect(() => { result = d02Failure('固定阶段失败', raw); }).not.toThrow(); expect(text(result)).not.toContain('敏感'); const marked = d02Failure('固定阶段失败', new D02FixtureError(mdl, { cause: raw })); expect(marked.message).toContain('D02_PREFLIGHT_MDL'); expect(text(marked)).not.toContain('敏感'); });
  it('循环cause不无限展开，固定分类仍可辨', () => { const raw = new D02FixtureError(mdl); Object.defineProperty(raw, 'cause', { value: raw }); const result = d02Failure('D02验证或操作无法确认，永久保留现场', raw); expect(result.message).toContain('D02_PREFLIGHT_MDL'); expect(result.message.length).toBeLessThan(4096); });
});
