import { expect, it } from 'vitest';
import { sqlLineCommentAction } from '../../src/renderer/sqlLineComment';

it('MySQL 遇到双负号只加注释，SQLite 仍按本方言切换', () => {
  const model = { getLineContent: () => '  --8' };
  const selections = [{ startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 }];
  expect(sqlLineCommentAction(model, selections, false)).toBe('editor.action.addCommentLine');
  expect(sqlLineCommentAction(model, selections, true)).toBe('editor.action.commentLine');
  expect(sqlLineCommentAction({ getLineContent: () => '  -- 8' }, selections, false)).toBe('editor.action.commentLine');
});

it('选区停在下一行首列时不把下一行当作注释目标', () => {
  const model = { getLineContent: (line: number) => line === 1 ? 'SELECT 1;' : '--8' };
  const firstLine = { startLineNumber: 1, endLineNumber: 2, startColumn: 1, endColumn: 1 };
  expect(sqlLineCommentAction(model, [firstLine], false)).toBe('editor.action.commentLine');
  expect(sqlLineCommentAction(model, [{ ...firstLine, endColumn: 2 }], false)).toBe('editor.action.addCommentLine');
});
