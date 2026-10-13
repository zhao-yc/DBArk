import type { Command } from './contracts';

/** 预加载白名单不引入校验器或 Node 依赖；新增公开命令必须在编译时补齐。 */
export const publicCommands: Record<Command, true> = {
  'app.info': true, 'app.setDirty': true,
  'connections.list': true, 'connections.save': true, 'connections.delete': true, 'connections.test': true, 'connections.open': true, 'connections.close': true,
  'metadata.databases': true, 'metadata.objects': true, 'metadata.table': true, 'metadata.ddl': true,
  'sessions.open': true, 'sessions.close': true, 'query.execute': true, 'query.explain': true, 'query.cancel': true, 'query.transaction': true,
  'query.parameterNames': true, 'query.executeParameterized': true, 'query.sessionState': true,
  'query.exportStream': true,
  'table.page': true, 'table.referencePage': true, 'table.preview': true, 'table.apply': true, 'schema.preview': true, 'schema.apply': true,
  'files.choose': true, 'files.path': true, 'files.preview': true, 'files.import': true, 'files.export': true, 'files.exportResult': true,
  'files.readQuery': true, 'files.writeQuery': true,
  'snippets.list': true, 'snippets.save': true, 'snippets.delete': true,
  'queries.list': true, 'queries.save': true, 'queries.delete': true, 'history.list': true, 'tasks.list': true, 'settings.get': true, 'settings.save': true
};
