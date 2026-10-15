import { describe, expect, it } from 'vitest';
import { assertDefaultEncodingLiveTarget, type DefaultEncodingLiveProfile, type DefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';

const caPath = 'D:\\验收夹具\\ca.pem';
const target: DefaultEncodingLiveTarget = { host: '192.168.31.200', port: 13484, tlsFlag: '1', caPath };
const profile: DefaultEncodingLiveProfile = { host: target.host, port: target.port, tls: { enabled: true, rejectUnauthorized: true, caPath } };
describe('默认编码核心与正式UI共用的严格TLS准备门', () => {
  it.each(['13357', '13380', '13384', '13310', '13311'])('原五端口%s的非TLS配置保持可用', port => {
    const current = { host: target.host, port }; expect(() => assertDefaultEncodingLiveTarget(current, current)).not.toThrow();
  });
  it.each(['192.168.31.200', 'deve-server.yinzon.com'])('13484主机%s只有显式严格TLS和一致CA才通过', host => {
    const current = { ...target, host }; expect(() => assertDefaultEncodingLiveTarget(current)).not.toThrow(); expect(() => assertDefaultEncodingLiveTarget(current, { ...profile, host })).not.toThrow();
  });
  it.each([undefined, '', '0', 'true'])('13484缺少显式TLS=1（%s）在建连前拒绝，即使profile已开TLS', tlsFlag => {
    expect(() => assertDefaultEncodingLiveTarget({ ...target, tlsFlag }, profile)).toThrow('DBARK_TEST_TLS=1'); expect(() => assertDefaultEncodingLiveTarget({ ...target, tlsFlag })).toThrow('DBARK_TEST_TLS=1');
  });
  it.each([undefined, '', '   '])('环境CA为空白（%s）时核心和UI准备阶段均拒绝', value => {
    expect(() => assertDefaultEncodingLiveTarget({ ...target, caPath: value }, profile)).toThrow('非空CA'); expect(() => assertDefaultEncodingLiveTarget({ ...target, caPath: value })).toThrow('非空CA');
  });
  it.each([
    undefined, { enabled: false, rejectUnauthorized: true, caPath }, { enabled: true, rejectUnauthorized: false, caPath }, { enabled: true, caPath },
    { enabled: true, rejectUnauthorized: true, caPath: '' }, { enabled: true, rejectUnauthorized: true, caPath: '   ' }, { enabled: true, rejectUnauthorized: true },
    { enabled: true, rejectUnauthorized: true, caPath: 'D:\\验收夹具\\另一CA.pem' },
  ])('实际profile的TLS/证书校验/CA缺失或不一致时拒绝（%j）', tls => {
    expect(() => assertDefaultEncodingLiveTarget(target, { ...profile, tls })).toThrow('启用TLS和证书校验');
  });
  it('原五端口显式选择TLS时同样不得关闭验证、换CA或静默改回明文', () => {
    const current = { ...target, port: 13384 }, actual = { ...profile, port: 13384 };
    expect(() => assertDefaultEncodingLiveTarget(current, actual)).not.toThrow(); expect(() => assertDefaultEncodingLiveTarget(current, { ...actual, tls: { ...actual.tls, rejectUnauthorized: false } })).toThrow();
    expect(() => assertDefaultEncodingLiveTarget({ ...current, tlsFlag: '0' }, actual)).toThrow('DBARK_TEST_TLS=1');
  });
  it.each([{ ...target, host: 'localhost' }, { ...target, port: 3306 }, { ...target, port: 13485 }])('未知主机或端口不因TLS正确而放行（%j）', current => {
    expect(() => assertDefaultEncodingLiveTarget(current, profile)).toThrow('已核对200');
  });
  it('实际保存目标必须与准备目标一致，端口不能被另一个合法实例替换', () => {
    expect(() => assertDefaultEncodingLiveTarget(target, { ...profile, port: 13384 })).toThrow('目标不一致'); expect(() => assertDefaultEncodingLiveTarget(target, { ...profile, host: 'deve-server.yinzon.com' })).toThrow('目标不一致');
  });
});
