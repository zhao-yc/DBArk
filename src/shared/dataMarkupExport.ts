import { queryHtmlZh } from './queryHtml.zh-CN';

export const dataXmlZh = {
  format: 'XML 文档',
  hint: '生成 UTF-8 XML，按列位置保留原列名，并区分 NULL、空文本和二进制。',
  streamHint: '按执行顺序将各组结果和语句回执写入同一文档。',
  utf8: 'XML 导出固定使用 UTF-8',
  field: 'XML 单个字段超过 8 MiB',
  row: 'XML 单行或列头超过 16 MiB',
  invalid: 'XML 导出单元格类型无效',
};

/** 两种标记格式都在文件内声明 UTF-8。 */
export function dataMarkupText(format: string) {
  if (format === 'html') return queryHtmlZh;
  if (format === 'xml') return dataXmlZh;
  return undefined;
}
