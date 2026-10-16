/** 定义定位只报告已核对的有界位置，无法映射时不显示虚构的零次或总数。 */
export const definitionNavigationZh = {
  title: '定义正文命中', previous: '上一处定义命中', next: '下一处定义命中', close: '关闭定义高亮',
  invalid: '定义正文、对象或连接修订已变化；本次定位已失效，请重新搜索。',
  unavailable: '当前搜索结果无法提供可证明的精确位置（服务器正则或大小写映射等）；仅查看当前定义，不显示命中计数。',
  unlocatable: '定义包含当前编辑器无法无损映射的位置；已关闭本次高亮与导航，请调整条件重新搜索。',
  failed: '当前定义读取失败，未显示旧定义或命中计数。',
  count: (index: number, count: number) => `第 ${index + 1} / ${count} 处`,
  position: (line: number, column: number) => ` · 第 ${line} 行，第 ${column} 列`,
  capped: (limit: number) => `仅显示前 ${limit} 处，已探测到额外命中；导航只在已显示范围内循环。`,
  complete: '已列出该定义的全部非重叠命中。',
};
