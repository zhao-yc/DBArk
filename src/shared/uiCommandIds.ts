/** 沙箱预加载只依赖纯白名单，不引入校验器、文件系统或数据库运行时。 */
export const uiCommandIds = [
  'new-connection', 'new-query', 'open-sql-file', 'recent-sql-file', 'save-query', 'save-sql-file',
  'connections-transfer', 'connections-organize', 'find', 'replace', 'toggle-theme', 'focus-mode',
  'editor-font', 'editor-word-wrap', 'editor-indent', 'favorite-toggle', 'favorites-manage', 'object-link',
  'execute', 'execute-current', 'execute-all', 'stop', 'format', 'parameters', 'explain', 'analyze',
  'transaction-settings', 'import', 'export', 'schema-compare', 'structure-search', 'server-monitor',
  'explain-snapshot', 'result-snapshot', 'task-center', 'tab-search', 'close-tab', 'close-other-queries',
  'close-left-queries', 'close-right-queries', 'next-tab', 'previous-tab', 'help', 'shortcuts', 'about'
] as const;

/** 只读取两个自有数据字段，不求值访问器，也不向页面转发额外内容。 */
export function isUiCommandInvocation(value: unknown): value is { id: typeof uiCommandIds[number]; revision: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('id') || !keys.includes('revision')) return false;
  const id = Object.getOwnPropertyDescriptor(value, 'id'), revision = Object.getOwnPropertyDescriptor(value, 'revision');
  return !!id && id.enumerable === true && 'value' in id && typeof id.value === 'string' && uiCommandIds.some(command => command === id.value)
    && !!revision && revision.enumerable === true && 'value' in revision && Number.isSafeInteger(revision.value) && revision.value >= 0;
}
