import type { DatabaseObject } from '../shared/contracts';
import { workbenchTargetSchema, type WorkbenchTarget } from '../shared/workbench';

export interface WorkbenchResolver {
  connectionExists(id: string): boolean;
  connect(id: string): Promise<void>;
  databases(id: string): Promise<string[]>;
  objects(id: string, database: string): Promise<DatabaseObject[]>;
  assertCurrent(): void;
}

/** 打开前只读核验原连接及完整对象类型；任何失败均不尝试其它连接或执行 SQL。 */
export async function resolveWorkbenchTarget(input: WorkbenchTarget, services: WorkbenchResolver): Promise<WorkbenchTarget> {
  const target = workbenchTargetSchema.parse(input);
  if (!services.connectionExists(target.connectionId)) throw new Error('原连接不存在，无法打开收藏或对象链接；请恢复原连接或移除此收藏');
  try { await services.connect(target.connectionId); }
  catch { throw new Error('无法连接原连接，请检查连接配置、网络和访问权限；未切换到其它连接'); }
  services.assertCurrent();
  let databases: string[];
  try { databases = await services.databases(target.connectionId); }
  catch { throw new Error('无法读取原数据库列表，请检查访问权限'); }
  services.assertCurrent();
  if (!databases.includes(target.database)) throw new Error('原数据库已删除或当前账号无权访问，无法打开此对象');
  if (target.kind !== 'database') {
    let objects: DatabaseObject[];
    try { objects = await services.objects(target.connectionId, target.database); }
    catch { throw new Error('无法读取原数据库对象，请检查访问权限'); }
    services.assertCurrent();
    if (!objects.some(object => object.name === target.name && object.kind === target.kind)) throw new Error('原对象已删除、类型已改变或当前账号无权访问，无法打开此对象');
  }
  return target;
}
