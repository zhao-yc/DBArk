/** 保留 Monaco 的多选区、行操作和撤销行为。 */
export const sqlTextActions = {
  'sql-uppercase': 'editor.action.transformToUppercase',
  'sql-lowercase': 'editor.action.transformToLowercase',
  'sql-duplicate-lines': 'editor.action.copyLinesDownAction',
  'sql-move-lines-up': 'editor.action.moveLinesUpAction',
  'sql-move-lines-down': 'editor.action.moveLinesDownAction',
  'sql-delete-lines': 'editor.action.deleteLines',
} as const;

/** 行列及括号导航使用当前编辑器的原生动作。 */
export const sqlPositionActions = {
  'sql-goto-line': 'editor.action.gotoLine',
  'sql-goto-bracket': 'editor.action.jumpToBracket',
  'sql-select-bracket': 'editor.action.selectToBracket',
} as const;

export const bracketCommands = ['sql-goto-bracket', 'sql-select-bracket'] as const;
