export const binaryCellFilesZh = {
  load: '从文件载入字节', save: '原字节另存为', busy: '正在处理二进制单元格文件，请等待文件操作结束',
  hint: '载入只替换当前 Hex 缓冲，仍需暂存、预览并提交；另存保存当前完整字节，不是当前显示分段。',
  readonlyHint: '另存当前完整原始字节，不执行 SQL，不转换文本编码。',
  loaded: (name: string, bytes: number) => `已载入 ${name}（${bytes} 字节），尚未暂存或提交`,
  saved: (name: string, bytes: number) => `已另存 ${name}（${bytes} 字节）`,
  invalidReply: '文件返回的完整字节与长度不一致，未载入或重试',
} as const;
