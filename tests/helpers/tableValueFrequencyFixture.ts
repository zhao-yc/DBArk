/** 合成 633 条精确大整数主键及 525 个分组，热门值刻意位于默认前 500 组之外。 */
export function tableValueFrequencyRows(): { id: string; n: string | null }[] {
  const rows: { id: string; n: string | null }[] = [];
  let id = 9007199254740993n;
  const add = (n: string | null) => rows.push({ id: String(id++), n });
  for (let index = 0; index < 520; index++) add(String(index).padStart(4, '0'));
  for (let index = 0; index < 100; index++) add('zz_hot');
  for (let index = 0; index < 9; index++) add('yy_warm');
  add(null); add(null); add(''); add('NULL');
  return rows;
}
