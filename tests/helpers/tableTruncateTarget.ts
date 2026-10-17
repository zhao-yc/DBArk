import { assertDefaultEncodingLiveTarget, type DefaultEncodingLiveTarget, type DefaultEncodingLiveProfile } from './tableDefaultEncodingTarget';

/** 首片只允许200的MySQL8.4实例，严格TLS端口仍须显式CA与证书校验。纯函数不读取文件。 */
export function assertTableTruncateLiveTarget(target: DefaultEncodingLiveTarget, profile?: DefaultEncodingLiveProfile): void {
  assertDefaultEncodingLiveTarget(target, profile);
  if (!['13384', '13484'].includes(String(target.port))) throw new Error('清空首片仅允许已核对200的13384/13484，其他版本未开放');
}
