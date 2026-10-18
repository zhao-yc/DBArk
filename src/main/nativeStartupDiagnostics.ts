/** 仅显式原生离线专项诊断开启；默认/list不访问输出端口，不影响产品返回或同步异常。 */
export function nativeStartupInfoMarker(code: 30 | 31 | 32 | 33): void {
  if (process.argv.some(value => value === '--list' || value.startsWith('--list=')) || process.env.DBARK_NATIVE_EDITOR_MAIN_DIAGNOSTICS !== '1' || process.env.DBARK_NATIVE_EDITOR_PROGRESS !== '1' || process.env.DBARK_INTEGRATION_ENABLED !== '0' || (process.env.DBARK_EDITOR_INDENT_NATIVE_TEST === '1') === (process.env.DBARK_QUERY_LAYOUT_NATIVE_TEST === '1')) return;
  if (![30, 31, 32, 33].includes(code) || written >= 32) return;
  written++;
  try { console.log('DBARK_STARTUP_V1:' + code); }
  catch { try { console.error('DBARK_STARTUP_V1:99'); } catch { /* 输出失败不能替换原app.info的值或异常；缺失标记不能解释为未调用。 */ } }
}
let written = 0;
