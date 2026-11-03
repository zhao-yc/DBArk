import type { editor, IRange } from 'monaco-editor';

/** MySQL 的双横线后需有空白或控制字符。遇到非注释双横线时只能添加注释。 */
export function sqlLineCommentAction(model: Pick<editor.ITextModel, 'getLineContent'>, selections: readonly IRange[], sqlite: boolean): string {
  if (!sqlite) {
    for (const selection of selections) {
      const end = selection.startLineNumber !== selection.endLineNumber && selection.endColumn === 1 ? selection.endLineNumber - 1 : selection.endLineNumber;
      for (let line = selection.startLineNumber; line <= end; line++) {
        if (/^\s*--[^\x00-\x20\x7f]/.test(model.getLineContent(line))) return 'editor.action.addCommentLine';
      }
    }
  }
  return 'editor.action.commentLine';
}
