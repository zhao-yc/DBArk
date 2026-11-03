export const maxTablePage = 10_000_000;

/** 精确计算末页及其应返回的行数，计数不经过浮点数。 */
export function tableLastPageBounds(count: unknown, pageSize: number): { page: number; rows: number; matchingRows: string } {
  if (typeof count !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(count) || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw Error('服务器返回的末页计数或页大小无效');
  const total = BigInt(count), size = BigInt(pageSize);
  const page = total === 0n ? 1n : (total - 1n) / size + 1n;
  if (page > BigInt(maxTablePage)) throw Error('末页超出最大可浏览页码，请缩小筛选范围');
  return { page: Number(page), rows: Number(total - (page - 1n) * size), matchingRows: count };
}
