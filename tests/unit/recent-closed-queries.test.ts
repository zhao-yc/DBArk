import { expect, it } from 'vitest';
import { captureRetainedQuery, RecentClosedQueries } from '../../src/renderer/recentClosedQueries';
import type { WorkspaceTab } from '../../src/renderer/store';

const connection = { id: 'connection' };
const scope = { connections: [connection], connectionVersions: { connection: 4 } };
const tab: WorkspaceTab = { id: 'old', kind: 'query', title: '待重开', sql: '-- 原文\r\nSELECT 1;', connectionId: connection.id, database: 'main', databaseContext: { state: 'known', database: 'main' }, queryResultPlacement: 'beside', queryEditorWidth: 510 };

it('保留原文、库和布局，仅投影可重开的草稿字段', () => {
  const input = { ...tab, sourceBinding: {} as WorkspaceTab['sourceBinding'], fileSourceBinding: {} as WorkspaceTab['fileSourceBinding'] };
  const entry = captureRetainedQuery(input, scope)!;
  const { id: _id, ...draft } = tab;
  expect(entry.draft).toEqual(draft);
  expect(entry.draft.databaseContext).not.toBe(tab.databaseContext);
  expect(captureRetainedQuery({ ...tab, sql: '\r\n' }, scope)).toBeUndefined();
  expect(captureRetainedQuery({ ...tab, kind: 'table' }, scope)).toBeUndefined();
  expect(captureRetainedQuery(tab, { ...scope, connections: [] })).toBeUndefined();
});

it('按最新关闭顺序消费且只保留十项，连接变更后旧记录不能复活', () => {
  const recent = new RecentClosedQueries();
  for (let index = 0; index < 12; index++) recent.remember(captureRetainedQuery({ ...tab, title: String(index) }, scope)!);
  for (let index = 11; index >= 2; index--) {
    const entry = recent.peek(scope)!;
    expect(entry.draft.title).toBe(String(index));
    recent.consume(entry);
  }
  expect(recent.peek(scope)).toBeUndefined();
  recent.remember(captureRetainedQuery(tab, scope)!);
  recent.prune({ ...scope, connectionVersions: { connection: 5 } });
  expect(recent.peek(scope)).toBeUndefined();
});
