/** 只生成普通文本编辑；不启用 Monaco 片段插值，保留 $、JSON、注释和引号。 */
export function snippetEdit<T>(range: T, sql: string): { range: T; text: string; forceMoveMarkers: boolean } {
  return { range, text: sql, forceMoveMarkers: true };
}
