import { dataSearchInputSchema, dataSearchLimits, type DataSearchReply } from '../shared/dataSearch';
import type { TaskEvent } from '../shared/contracts';
import type { ManagedConnection } from './connection';
import type { StructureTaskContext } from './structureDefinition';
import { readDataSearchTarget, buildDataSearchPlan, decodeDataSearchRow } from './dataSearchPlan';
import { consumeQueryFrames } from './queryStreamProtocol';
import { completionQuery } from './completionQuery';
import { DataSearchRecords, prepareDataSearchRecord, type RecordPreparation } from './dataSearchRecords';
import { DataSearchScans } from './dataSearchScans';

export type { DataSearchScanSource } from './dataSearchScans';

export interface DataSearchTaskControl extends Pick<StructureTaskContext,'checkCancelled'|'commandStarted'>{managed:ManagedConnection;stop():Promise<void>}
export type DataSearchRun=(action:(control:DataSearchTaskControl)=>Promise<void>)=>Promise<void>;
export class DataSearchTasks extends DataSearchScans {
  constructor(emit: (event: TaskEvent) => void, acknowledgementMs: number = dataSearchLimits.acknowledgementMs, private readonly networkRecords?: DataSearchRecords) {
    super(emit, acknowledgementMs, networkRecords);
  }
  /** 首批或终态回复只在对应阶段发布；异常回复必须等后台连接实际收尾。 */
  async start(raw:unknown,run:DataSearchRun):Promise<DataSearchReply>{
    const input = dataSearchInputSchema.parse(raw);
    if (input.dialect) throw Error('数据搜索方言与保存的连接不匹配');
    return this.startScan(input, scan => run(async control => {
      const { managed } = control;
      if (this.networkRecords) await completionQuery(managed, control, 'START TRANSACTION READ ONLY', []);
      const preparations = new Map<string, RecordPreparation>();
      await scan({
        checkCancelled: () => control.checkCancelled(), broken: () => managed.broken,
        read: async (target, rows, open, peak) => {
          const metadata = await readDataSearchTarget(managed, target, control, { allowViews: input.allowViews });
          const key = JSON.stringify([target.database, target.table]);
          let prepared = preparations.get(key);
          if (this.networkRecords && !prepared) {
            prepared = metadata.keyColumns.length ? await prepareDataSearchRecord(control, target) : { reason: 'no-key' };
            preparations.set(key, prepared);
          }
          const captured = prepared;
          const receive = open(metadata, captured && this.networkRecords ? row => this.networkRecords!.capture(input.connectionId, input.taskId, metadata, row, captured) : undefined);
          const plan = buildDataSearchPlan(metadata, input.matcher, rows);
          await consumeQueryFrames(managed, plan.sql, 'binary', {
            statementOrdinal: 1, ordinals: { results: 0, rows: 0 }, checkCancelled: () => control.checkCancelled(),
            commandStarted: () => control.commandStarted(), stop: () => control.stop(), queuePeak: peak,
            consume: async frame => { if (frame.kind === 'row') await receive(decodeDataSearchRow(metadata, frame.values)); },
          }, plan.params);
        },
      });
    }));
  }

}
