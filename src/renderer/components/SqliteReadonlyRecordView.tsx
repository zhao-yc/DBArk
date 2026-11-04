import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import type { QueryRowDetails, QueryRowDetailsView } from '../queryRowDetails';
import { SqliteReadonlyRecord } from '../sqliteReadonlyRecord';
import { sqliteReadonlyRecordZh as text } from '../locales/sqliteReadonlyRecord.zh-CN';
import { ReadonlyRecordView } from './ReadonlyRecordView';
interface Props { controller: QueryRowDetails; view: QueryRowDetailsView; page: SqliteTablePage; current(): boolean; mode: 'tree' | 'json'; filter: string; }
/** SQLite原完整页保持独立类型事实模型，只共用无编辑能力的呈现层。 */
export function SqliteReadonlyRecordView({ controller, view, page, current, mode, filter }: Props) {
  return <ReadonlyRecordView identity={[page, view]} text={text} mode={mode} filter={filter} capture={() => {
    const record = new SqliteReadonlyRecord(page, controller, view, current);
    return { current: () => record.current(), json: () => record.json(), fields: Object.freeze(record.fields.map(field => Object.freeze({ name: field.name, type: field.declaredType, generated: field.generated, kind: field.value.kind, raw: field.value.kind === 'null' ? null : field.value.value, parse: field.value.kind === 'text', ...(field.value.kind === 'blob' ? { bytes: field.value.bytes } : {}) }))) };
  }}/>;
}
