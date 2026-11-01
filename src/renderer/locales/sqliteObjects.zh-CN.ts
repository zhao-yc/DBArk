import type { SqliteObjectsAction } from '../../shared/sqliteObjects';

/** SQLite对象定义采用原文编辑；预览不执行写入，也不假设后续DML已获验证。 */
export const sqliteObjectsZh = {
  createView: '新建 SQLite 视图', createTrigger: '新建 SQLite 触发器', editDefinition: '编辑 SQLite 对象定义', dropView: '删除 SQLite 视图', dropTrigger: '删除 SQLite 触发器',
  kinds: {view:'视图',trigger:'触发器'}, title: (action: SqliteObjectsAction,kind:'view'|'trigger') => `${action==='create'?'新建':action==='replace'?'替换定义':'删除'} SQLite ${kind==='view'?'视图':'触发器'}`,
  apply: {create:'确认创建 SQLite 对象',replace:'确认替换 SQLite 对象',drop:'确认删除 SQLite 对象'}, read:'读取 SQLite 对象与目录', loading:'正在读取或处理 SQLite 对象', name:'SQLite 对象名称',
  scope: {create:'先明确对象名称并读取目录，再编辑完整 CREATE 定义；预览只核对原文、归属与目录，不试执行写入。',replace:'先读取原定义与完整目录，再编辑完整 CREATE 定义。替换在独立事务内先 DROP 再 CREATE；任一失败整批回滚。',drop:'删除准确 main 对象。删除视图时，SQLite 会一并删除该视图附属的 INSTEAD OF 触发器；其他保留依赖可能失效。'},
  dependenciesHint:'替换视图会重建原附属触发器。完整 main 目录供人工核对，不以名称文本匹配冒充精确依赖分析。系统对象、TEMP、其它库、多个对象及 IF NOT EXISTS 不在此入口执行。',
  futureEffects:'CREATE 成功不代表已验证未来触发器的 DML 行为，也不代表 UPDATE OF 字段一定存在。请核对定义、依赖和使用方式；本窗口不触发合成写入来试运行。',
  fullCatalogueHint:'以下保留完整 main 表、索引、视图及触发器定义，不截断或改写原文。', readonly:'当前连接为只读：可以读取和预览，不能创建、替换或删除对象。',
  exists:'原对象存在。', absent:'准确名称当前不存在。', sourceSql:'SQLite 原对象定义', noSource:'当前没有此对象定义。', related:'SQLite 完整 main 对象目录', relatedSql:(type:string,name:string)=>`SQLite 对象关联 ${type} ${name}`, objectKinds:{table:'表',index:'索引',view:'视图',trigger:'触发器'}, noSql:'此对象没有独立 SQL 定义。', attachedTriggers:'SQLite 视图附属触发器', attachedSql:(name:string)=>`SQLite 视图附属触发器 ${name}`, noAttachedTriggers:'没有附属触发器。',
  editor:'SQLite CREATE 定义编辑区', editorHint:'填写完整且准确命名的 CREATE VIEW 或 CREATE TRIGGER。输入按原文保留，不自动改名、格式化或执行；编辑器不建立查询会话或读取补全元数据。', relation:'SQLite 触发器模板作用对象', chooseRelation:'请选择目录中的普通表或视图', template:'填入无数据副作用模板', templateOverwrite:'模板将替换当前 SQL 文本，尚未执行任何 SQL。', keepSql:'保留当前 SQL', replaceSql:'确认替换为模板',
  preview:'预览 SQLite 对象 SQL', previewTitle:'SQLite 对象 SQL 预览', previewHint:'请核对完整批次与准确原目标；预览不可编辑，所有风险逐项确认后仅提交一次。', acknowledgements:'SQLite 对象风险确认', acknowledgementLabels:{
    'definition-effects':'我已核对定义和使用影响，接受对象及依赖行为变化',
    'native-validation':'我理解预览未试执行；语法和原生约束仅在实际事务中验证',
    'dependent-objects':'我已核对保留依赖，接受其它对象可能失效',
    'attached-view-triggers':'我已核对视图附属触发器，接受替换时重建、删除时一并删除',
    'drop-object':'我确认永久删除此准确对象',
  }, confirmation:'输入 SQLite 对象确认名称', confirmationHint:(name:string)=>`请输入 ${name} 确认准确对象`,
  invalid:'原连接、操作用途、对象名称、修订或窗口来源已变化；SQL保留，不能继续执行旧操作。', designInvalid:'对象定义或归属无效，请核对准确名称和完整单条 CREATE；原文保留，不会自动修改。', response:'SQLite 对象回包的目标、用途、原文或事务事实不一致，请核对原库；不会重放。',
  catalogueExpired:'原目录已过期，请明确放弃预览并重新读取。', previewExpired:'对象预览已过期，请重新预览；不会自动提交。', catalogueExpiredPreview:'原目录已过期，不能重预览；原预览仍可在其独立有效期内明确确认。',
  reread:'重新读取将撤销原预览和风险确认，当前 SQL 原文保留。', discardRead:'重新读取并撤销确认', keep:'保留对象草稿', close:'关闭 SQLite 对象定义', discard:'关闭会放弃本地 SQL 草稿，不能撤销已提交的对象变更；未知结果必须核对原库。', discardClose:'放弃对象草稿并关闭',
  stop:'停止 SQLite 对象任务', cancelling:'已请求停止，正在等待原任务和取消响应；取消不能撤销已确认的 COMMIT。', commitBoundary:'COMMIT 已可能发送或结果未知，正在等待原回执；停止不能表示撤销提交。', committed:'SQLite 对象事务已确认提交。', committedStale:'SQLite 对象事务已确认提交，但原界面来源已失效；请核对原库，不会重放。', unknown:'SQLite 对象结果未知，本次草稿已锁定，禁止重复提交；请核对原库。', cleanupWarning:'已确认的 COMMIT 或 ROLLBACK 回执仍有效，但本地记录或资源收尾尚未全部确认；请核对原库与任务记录，不会自动重试。',
} as const;
