import type { editor } from 'monaco-editor';

/** Monaco 遇到空光标会自动选词。所有选区均非空时才启用显式转换。 */
export function hasExplicitCaseSelection(instance: editor.IStandaloneCodeEditor): boolean {
  const selections = instance.getSelections();
  return !!selections?.length && selections.every(selection => !selection.isEmpty());
}
