import type * as monaco from 'monaco-editor';
import type { WorkspaceTab } from './store';
import { flushEditorContent } from './editorContentBridge';
import { zh } from './locales/zh-CN';
import { assertQueryFileSourceSql } from '../shared/queryFileSources';

/** 文件保存只捕获当前正文桥的全文；同步交付正文时不得连带替换标题、来源或标签上下文。 */
export function captureQueryFileSnapshot(editor: monaco.editor.IStandaloneCodeEditor | null, read: () => WorkspaceTab | undefined): Readonly<WorkspaceTab> {
  const before = read();
  if (!editor || before?.kind !== 'query') throw Error(zh.editor.bodyUnavailable);
  // 原SQL摘要是文件保存基线；未编辑的受控EOL等价模型不能因捕获而回写草稿。
  const sql = flushEditorContent(editor, before.sql ?? '', 'preserve-equivalent-draft-eol');
  assertQueryFileSourceSql(sql);
  const current = read();
  if (!current || (current.sql ?? '') !== sql) throw Error(zh.editor.bodyUnavailable);
  // 正文flush只允许推进sql；逐字段核对还保护今后增加的文件来源字段，不预设公共合同。
  const keys = new Set([...Object.keys(before), ...Object.keys(current)]) as Set<keyof WorkspaceTab>;
  for (const key of keys) if (key !== 'sql' && !Object.is(before[key], current[key])) throw Error(zh.editor.bodyUnavailable);
  return Object.freeze({ ...current, sql });
}
