/** 表、已返回结果及完整流式CSV导出共用文案，不影响导入或其他格式。 */
export const csvExportZh = {
  label: 'CSV导出分隔符',
  labels: { ',': '逗号（默认）', ';': '分号（;）', '\t': '制表符（Tab）' },
  hint: '按接收方要求选择；修改后请重新选择保存文件。NULL、空字符串和二进制协议保持。',
  format: 'CSV',
} as const;
