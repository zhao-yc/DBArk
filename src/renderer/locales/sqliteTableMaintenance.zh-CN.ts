import type { SqliteTableMaintenanceInspectOutput } from '../../shared/sqliteTableMaintenance';

/** 清空与删除共用风险确认，所有条数都明确区分只读观测与写锁后事实。 */
export const sqliteTableMaintenanceZh = {
  clearEntry: '清空 SQLite 表', dropEntry: '删除 SQLite 表', dangerGroup: '危险操作',
  entryLabels: { clear: '清空 SQLite 表', drop: '删除 SQLite 表' }, titles: { clear: '清空 SQLite 表', drop: '删除 SQLite 表' }, applyLabels: { clear: '确认清空 SQLite 表', drop: '确认删除 SQLite 表' },
  read: '读取 SQLite 表与依赖', loading: '正在读取或处理 SQLite 表',
  scope: { clear: '执行 DELETE FROM，清空原表的全部当前数据，保留表结构。只有事务提交确认后才更新页面。', drop: '执行原生 DROP TABLE，删除原表、表数据及附属索引和触发器。只有事务提交确认后才关闭原表页面。' },
  currentRowsRisk: '行数仅为只读观测，不是待删除快照。提交将处理执行时的全部当前行，包括预览之后新增的行；不限制为当前分页或已筛选记录。',
  dependenciesHint: { clear: 'DELETE 会执行真实触发器和外键动作，可能级联删除或修改其它表；约束错误或清空后仍有行会整批回滚。', drop: '原生 DROP 不执行目标表的 DELETE 触发器，但外键动作可能级联删改其它表。保留的视图、外键或其它触发器可能失效；本窗口不自动删除或重写这些对象。' },
  fullCatalogueHint: '以下为完整 main 目录和全部触发器定义，供核对影响；不会把名称文本匹配当作精确依赖分析，也不会试执行写语句来预览。',
  readonly: '当前连接为只读：可以读取和预览，不能清空或删除。',
  catalogue: 'SQLite 原字段目录', tableSql: 'SQLite 原表 SQL', related: 'SQLite 完整 main 目录与触发器', relatedSql: (type: string, name: string) => `SQLite 维护关联 ${type} ${name}`,
  foreignKeys: 'SQLite 完整外键目录', noForeignKeys: 'main 目录未发现外键定义。', foreignKey: (key: SqliteTableMaintenanceInspectOutput['foreignKeys'][number]) => `${key.table} [${key.id}:${key.sequence}] ${key.from} → ${key.parent}.${key.to ?? '（父主键）'} · ON UPDATE ${key.onUpdate} · ON DELETE ${key.onDelete} · MATCH ${key.match}`,
  objectKinds: { table: '表', index: '索引', view: '视图', trigger: '触发器' }, noSql: '此对象没有独立 SQL 定义。', noDefault: '（无默认值）',
  name: '字段名称', declaredType: '声明类型', notNull: 'NOT NULL', defaultSql: '原默认值 SQL', primaryKey: '主键顺序', hidden: '隐藏或生成标记', yes: '是', no: '否', strict: 'STRICT', withoutRowid: 'WITHOUT ROWID',
  observedRows: 'SQLite 读取时观测行数', previewRows: 'SQLite 预览时观测行数', observedCount: (rows: string) => `本次只读观测：${rows} 行（不是删除数量承诺）`,
  resetSequence: '清空后重置 AUTOINCREMENT 序列', sequenceDefault: '默认不主动重置 AUTOINCREMENT 高水位；真实触发器仍可能按其定义影响序列。只有明确勾选并再次确认时，本窗口才删除原表的 sqlite_sequence 记录。', noSequence: '此表未使用 AUTOINCREMENT，不能重置序列。', parameters: 'SQLite 序列重置绑定参数', sequenceParameter: (table: string) => `第二句 SQL 的 ? 仅绑定准确原表名：${JSON.stringify(table)}`,
  preview: '预览 SQLite 表维护 SQL', previewTitle: 'SQLite 表维护 SQL 预览', previewHint: '请核对准确原表、全部 SQL 和风险。预览不可编辑；勾选每项风险并输入原表名称后，仅提交一次。',
  acknowledgements: 'SQLite 维护风险确认', acknowledgementLabels: {
    'all-current-data': '我确认操作执行时的全部当前行，包括预览后新增的数据',
    'trigger-foreign-effects': '我已核对触发器和外键动作，接受其它表可能被级联删改',
    'drop-structure': '我确认永久删除此表、数据、附属索引和触发器',
    'retained-dependencies': '我接受保留的视图、外键及其它依赖可能失效，并自行处理',
    'reset-sequence': '我确认删除此表的 AUTOINCREMENT 序列记录，允许后续重新分配编号',
  },
  confirmation: '输入 SQLite 维护原表确认名称', confirmationHint: (name: string) => `请输入 ${name} 确认准确原表`,
  invalid: '原表、操作用途、连接、修订或窗口来源已变化；确认内容保留，不能继续读取、预览或提交。', designInvalid: '维护操作或序列选项无效，未执行写入。', response: 'SQLite 表维护回包的目标、用途、选项或事务事实不一致，请核对原库；不会重放。',
  catalogueExpired: '原目录已过期，请明确放弃确认并重新读取。', previewExpired: '维护预览已过期，请重新预览；不会自动提交。', catalogueExpiredPreview: '原目录已过期，不能重设选项或重预览；原预览仍可在其独立有效期内明确确认。',
  reread: '重新读取会清除当前预览、选项和风险确认。', discardRead: '放弃确认并重新读取表', keep: '保留维护确认', close: '关闭 SQLite 表维护', discard: '关闭会放弃本地维护确认，不能撤销已提交的操作；未知结果必须核对原库。', discardClose: '放弃维护确认并关闭',
  stop: '停止 SQLite 表维护任务', cancelling: '已请求停止，正在等待原任务和取消响应；取消不能撤销已确认的 COMMIT。', commitBoundary: 'COMMIT 已可能发送或结果未知，正在等待原回执；停止不能表示撤销提交。',
  committed: 'SQLite 表维护事务已确认提交。', committedStale: 'SQLite 表维护已确认提交，但原界面来源已失效；请核对原库，不会重放。', unknown: 'SQLite 表维护结果未知，本次确认已锁定，禁止重复提交；请核对原库。',
  cleanupWarning: '已确认的 COMMIT 或 ROLLBACK 回执仍然有效，但本地记录或资源收尾尚未全部确认。请核对原库与任务记录；不会把已确认结果改为未提交，也不会自动重试。',
} as const;
