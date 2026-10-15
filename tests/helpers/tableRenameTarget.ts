import { assertDefaultEncodingLiveTarget, type DefaultEncodingLiveTarget, type DefaultEncodingLiveProfile } from './tableDefaultEncodingTarget';

/** 核心/UI统一使用已核对200六实例的显式准备门；不读凭据文件，不探测服务器。 */
export function assertTableRenameLiveTarget(target: DefaultEncodingLiveTarget, profile?: DefaultEncodingLiveProfile): void {
  assertDefaultEncodingLiveTarget(target, profile);
}
