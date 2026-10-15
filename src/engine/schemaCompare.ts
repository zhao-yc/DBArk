import { schemaCompareTargetSchema, type SchemaCompareTarget } from '../shared/schemaCompare';
import { readStructureDefinition, assertStructureDefinitionUnchanged, structureTaskQuery, type StructureDefinitionRead, type StructureTaskContext } from './structureDefinition';

export interface SchemaComparisonSnapshot extends StructureDefinitionRead { target: SchemaCompareTarget; }

/** 调用方必须提供私有结构短会话；所有 SET 仅规范该短会话，不能借用查询标签会话。 */
export async function readSchemaComparisonTarget(context: StructureTaskContext, input: SchemaCompareTarget): Promise<SchemaComparisonSnapshot> {
  const target = schemaCompareTargetSchema.parse(input);
  context.checkCancelled();
  if (!['mysql', 'mariadb'].includes(context.managed.status.dialect)) throw new Error('首阶段结构比较仅支持 MySQL 和 MariaDB');
  // MySQL 隐藏生成主键会造成虚假的零差异；开启并验证专用会话显示开关。
  if (context.managed.status.dialect === 'mysql') {
    const version = /^(\d+)\.(\d+)\.(\d+)(?:$|-)/.exec(context.managed.status.version);
    if (!version) throw new Error('无法确认 MySQL 版本，不能证明结构显示完整');
    const [major, minor, patch] = version.slice(1).map(Number);
    if (major > 8 || (major === 8 && (minor > 0 || patch >= 30))) {
      await structureTaskQuery(context, 'SET SESSION show_gipk_in_create_table_and_information_schema = ON');
      const rows = (await structureTaskQuery<{ visible: unknown }[]>(context, 'SELECT @@SESSION.show_gipk_in_create_table_and_information_schema AS visible')).rows;
      if (rows.length !== 1 || ![1, '1', 'ON'].includes(rows[0].visible as string | number)) throw new Error('无法确认生成不可见主键显示状态');
    }
  }
  const read = await readStructureDefinition(context, target, true);
  context.checkCancelled();
  // SHOW CREATE 与目录不是原子快照；读取结束再核对，拒绝观察到的并发结构变化。
  const recheck = await readStructureDefinition(context, target, false);
  // 第一次读取可能移除了会隐藏定义的原模式；重核的是规范化后的同一短会话。
  assertStructureDefinitionUnchanged({ ...read, originalMode: read.normalizedMode }, recheck);
  context.checkCancelled();
  return { ...read, target: { ...target } };
}
