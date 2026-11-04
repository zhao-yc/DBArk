import type { QueryRowDetails, QueryRowDetailsView } from '../queryRowDetails';
import { QueryReadonlyRecord } from '../queryReadonlyRecord';
import { queryReadonlyRecordZh as text } from '../locales/queryReadonlyRecord.zh-CN';
import { ReadonlyRecordView } from './ReadonlyRecordView';
interface Props { controller: QueryRowDetails; view: QueryRowDetailsView; current(): boolean; mode: 'tree' | 'json'; filter: string; }
/** 使用原详情控制器绑定当前结果或固定快照，不从SQL或数据库表构造伪来源。 */
export function QueryReadonlyRecordView({ controller, view, current, mode, filter }: Props) {
  return <ReadonlyRecordView identity={[controller, view]} text={text} mode={mode} filter={filter} capture={() => new QueryReadonlyRecord(controller, view, current)}/>;
}
