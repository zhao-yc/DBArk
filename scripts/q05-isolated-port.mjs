/** ROOT已有的六个专用实例端口；禁止自动选择或改写目标。 */
export const q05IsolatedPorts = Object.freeze(['13357', '13380', '13384', '13310', '13311', '13484']);

/** CLI/身份记录与env必须逐字相同，且均在专用白名单内；数值强转不得绕过此门。 */
export function requireQ05IsolatedPort(selectedPort, environmentPort) {
  if (typeof selectedPort !== 'string' || !q05IsolatedPorts.includes(selectedPort) || selectedPort !== environmentPort) throw new Error('Q05只允许专用端口13357/13380/13384/13310/13311/13484，且必须与env逐字匹配');
  return Number(selectedPort);
}
