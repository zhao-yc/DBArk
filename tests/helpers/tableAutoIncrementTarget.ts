import { assertDefaultEncodingLiveTarget, type DefaultEncodingLiveTarget, type DefaultEncodingLiveProfile } from './tableDefaultEncodingTarget';

/** 核心/UI共用显式200六实例及同一严格TLS/CA准备门，不探测目标或读取凭据文件。 */
export function assertTableAutoIncrementLiveTarget(target: DefaultEncodingLiveTarget, profile?: DefaultEncodingLiveProfile): void {
  assertDefaultEncodingLiveTarget(target, profile);
}
