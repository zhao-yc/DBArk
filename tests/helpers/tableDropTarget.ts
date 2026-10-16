import { assertDefaultEncodingLiveTarget, type DefaultEncodingLiveTarget, type DefaultEncodingLiveProfile } from './tableDefaultEncodingTarget';
/** 仅供未来ROOT授权验收；纯配置校验，不连接、不读取证书或凭据。 */
export function assertTableDropLiveTarget(target: DefaultEncodingLiveTarget, profile?: DefaultEncodingLiveProfile): void {
  assertDefaultEncodingLiveTarget(target, profile);
  if (!['13384', '13484'].includes(String(target.port))) throw new Error('删除首片仅允许已核对200的13384/13484，其他版本未开放');
}
