export interface DefaultEncodingLiveTarget { host?: string; port?: string | number; tlsFlag?: string; caPath?: string; }
export interface DefaultEncodingLiveProfile { host?: string; port?: string | number; tls?: { enabled?: boolean; rejectUnauthorized?: boolean; caPath?: string }; }

/** 核心和正式UI共用纯准备门；13484必须显式严格TLS，同一CA不能被另一份配置替换。 */
export function assertDefaultEncodingLiveTarget(target: DefaultEncodingLiveTarget, profile?: DefaultEncodingLiveProfile): void {
  const port = String(target.port);
  if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(target.host ?? '') || !['13357', '13380', '13384', '13310', '13311', '13484'].includes(port)) throw new Error('必须显式指定已核对200专用实例');
  if (profile && (profile.host !== target.host || String(profile.port) !== port)) throw new Error('保存连接与本轮隔离实例目标不一致');
  const strict = port === '13484' || target.tlsFlag === '1' || profile?.tls?.enabled === true;
  if (!strict) return;
  if (target.tlsFlag !== '1' || typeof target.caPath !== 'string' || !target.caPath.trim()) throw new Error('严格TLS实例必须显式设置DBARK_TEST_TLS=1及非空CA，禁止降级');
  // UI准备阶段尚未保存连接；实际profile由同一门在保存后再次核对。
  if (profile && (profile.tls?.enabled !== true || profile.tls.rejectUnauthorized !== true || typeof profile.tls.caPath !== 'string' || !profile.tls.caPath.trim() || profile.tls.caPath !== target.caPath)) throw new Error('连接必须启用TLS和证书校验，并使用本轮显式配置的同一CA');
}
