import type { QueryResultPresetStoredSnapshot, QueryResultPresetValue } from '../../src/shared/queryResultPresets';

export interface QueryResultPresetsRestartAuditTarget { senderId: number; profileId: string; tabId: string; sql: string; deadline: number; phase: 1 | 2; expected?: QueryResultPresetStoredSnapshot; }
/** 本函数直接序列化进Electron主进程；全部校验自包含，仅包裹原处理器，不生成产品成功回包。 */
export function installQueryResultPresetsRestartAudit({ ipcMain }: { ipcMain: any }, target: QueryResultPresetsRestartAuditTarget): void {
  const root = globalThis as any, key = '__dbarkQueryResultPresetsRestartAudit', handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request');
  const fixedSQL = "SELECT CAST('1' AS CHAR) AS id,CAST('18446744073709551615' AS UNSIGNED) AS repeated,CAST('0.12345678901234567890' AS DECIMAL(30,20)) AS repeated,NULL AS null_value,CAST('' AS CHAR) AS empty_value,X'00ff' AS bytes,'HIDDEN_SENTINEL' AS hidden_value UNION ALL SELECT CAST('2' AS CHAR),CAST('2' AS UNSIGNED),CAST('2.00000000000000000000' AS DECIMAL(30,20)),NULL,'',NULL,'HIDDEN_SENTINEL' UNION ALL SELECT CAST('3' AS CHAR),CAST('9007199254740993' AS UNSIGNED),CAST('1.00000000000000000001' AS DECIMAL(30,20)),NULL,'',X'','HIDDEN_SENTINEL' ORDER BY id";
  const initial = { senderId: target.senderId, profileId: target.profileId, tabId: target.tabId, sql: target.sql, deadline: target.deadline, phase: target.phase, expected: target.expected };
  if (!Number.isSafeInteger(initial.senderId) || initial.senderId <= 0 || typeof initial.profileId !== 'string' || !initial.profileId || initial.profileId.length > 200 || typeof initial.tabId !== 'string' || !initial.tabId || initial.tabId.length > 200 || initial.sql !== fixedSQL || !Number.isFinite(initial.deadline) || initial.deadline <= Date.now() || ![1, 2].includes(initial.phase) || (initial.phase === 2) !== !!initial.expected || typeof original !== 'function' || root[key]) throw Error('重启整理审计归属或固定授权无效');
  const state: any = { invalid: false, failure: '', queries: 0, pending: 0, revision: 0, schemeCommands: [], workspaceClosed: false, session: '', sessionClaim: undefined, sessionClosed: false, last: Date.now(), queryColumns: undefined, snapshot: undefined, lastRead: undefined, schemePending: false, check: undefined };
  const steps = initial.phase === 1 ? ['list', 'save'] : ['list', 'read'], tokens = new Set<string>();
  let owner: any;
  /** 首个错误永久关闭授权；只保留固定分类，不回显SQL、路径、凭据或原处理器正文。 */
  const reject = (reason = '既有停链'): never => { state.invalid = true; state.failure ||= reason; throw Error('重启整理审计永久停链：' + state.failure); };
  const record = (value: any, allowed: string[], required = allowed): any => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) reject('对象边界');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) reject('对象原型');
    const keys = Reflect.ownKeys(value);
    if (keys.length > allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) reject('对象字段');
    const output: any = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) reject('访问器');
      Object.defineProperty(output, key, { value: descriptor!.value, enumerable: true, writable: true });
    }
    return output;
  };
  const array = (value: any, maximum: number, minimum = 0): any[] => {
    if (!Array.isArray(value)) reject('数组边界');
    const prototype = Object.getPrototypeOf(value), length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!prototype || !Object.getPrototypeOf(prototype) || Object.getPrototypeOf(Object.getPrototypeOf(prototype)) !== null || !Number.isSafeInteger(length) || length < minimum || length > maximum || Reflect.ownKeys(value).length !== length + 1) reject('数组结构');
    const output = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) reject('数组访问器');
      output.push(descriptor!.value);
    }
    return output;
  };
  const string = (value: any, minimum: number, maximum: number): string => { if (typeof value !== 'string' || value.length < minimum || value.length > maximum) reject('文本边界'); return value; };
  const revision = (value: any): number => { if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) reject('修订边界'); return value; };
  const uuid = (value: any): string => { if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) reject('UUID边界'); return value; };
  const digest = (value: any): string => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) reject('摘要边界'); return value; };
  const source = (value: any): any => { const item = record(value, ['connectionRevision', 'connectionDigest']); return { connectionRevision: revision(item.connectionRevision), connectionDigest: digest(item.connectionDigest) }; };
  const same = (left: any, right: any): boolean => JSON.stringify(left) === JSON.stringify(right);
  /** 与共享schema同样保留全部分组/启停/原值；仅对已准入副本序列化及比较。 */
  const presetValue = (value: any, bindColumns = true): any => {
    const item = record(value, ['columns', 'visible', 'configuration']); let units = 0, groups = 0, rules = 0; const ancestors = new Set();
    const literal = (value: any, minimum = 0, maximum = 4096): string => { const text = string(value, minimum, maximum); units += text.length; if (units > 128 * 1024) reject('方案容量'); return text; };
    const columns = (value: any): any[] => {
      const result = array(value, 1024, 1).map(item => { const column = record(item, ['key', 'name', 'type']); return { key: literal(column.key, 1), name: literal(column.name), type: literal(column.type, 0, 256) }; });
      if (new Set(result.map(column => column.key)).size !== result.length) reject('重复字段'); return result;
    };
    const all = columns(item.columns), visible = columns(item.visible), available = new Set(visible.map(column => column.key));
    if (bindColumns && (!state.queryColumns || !same(all, state.queryColumns)) || visible.some(column => !all.some(other => same(column, other)))) reject('真实查询字段');
    const operators = ['contains', 'notContains', 'startsWith', 'notStartsWith', 'endsWith', 'notEndsWith', 'like', 'notLike', 'empty', 'notEmpty', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'notBetween', 'in', 'notIn', 'null', 'notNull'];
    const group = (value: any, depth: number): any => {
      if (depth > 8 || ++groups > 16 || ancestors.has(value)) reject('分组预算'); ancestors.add(value);
      const node = record(value, ['mode', 'children']); if (!['AND', 'OR'].includes(node.mode)) reject('分组模式');
      const children = array(node.children, 48, depth === 1 ? 0 : 1).map(child => {
        if (child && typeof child === 'object' && Object.hasOwn(child, 'children')) return group(child, depth + 1);
        if (++rules > 32) reject('条件预算');
        const leaf = record(child, ['column', 'operator', 'value', 'upper', 'values', 'ignoreCase', 'enabled'], ['column', 'operator', 'value']);
        const column = literal(leaf.column, 1), operator = string(leaf.operator, 1, 32), output: any = { column, operator, value: literal(leaf.value) };
        if (!available.has(column) || !operators.includes(operator)) reject('条件引用');
        const range = ['between', 'notBetween'].includes(operator), list = ['in', 'notIn'].includes(operator);
        if (range) output.upper = literal(leaf.upper); else if (leaf.upper !== undefined) reject('区间结构');
        if (list) output.values = array(leaf.values, 128, 1).map(item => literal(item)); else if (leaf.values !== undefined) reject('集合结构');
        if ((list || ['null', 'notNull', 'empty', 'notEmpty'].includes(operator)) && output.value !== '') reject('空值结构');
        for (const option of ['ignoreCase', 'enabled']) if (leaf[option] !== undefined) { if (typeof leaf[option] !== 'boolean') reject('布尔选项'); output[option] = leaf[option]; }
        return output;
      });
      ancestors.delete(value); return { mode: node.mode, children };
    };
    const configuration = record(item.configuration, ['expression', 'sort']), expression = group(configuration.expression, 1);
    const sort = array(configuration.sort, 1024).map(item => {
      const rule = record(item, ['column', 'direction', 'nulls', 'ignoreCase'], ['column', 'direction']), column = literal(rule.column, 1), output: any = { column, direction: rule.direction };
      if (!available.has(column) || !['ASC', 'DESC'].includes(rule.direction)) reject('排序引用');
      if (rule.nulls !== undefined) { if (!['FIRST', 'LAST'].includes(rule.nulls)) reject('NULL排序'); output.nulls = rule.nulls; }
      if (rule.ignoreCase !== undefined) { if (typeof rule.ignoreCase !== 'boolean') reject('排序大小写'); output.ignoreCase = rule.ignoreCase; }
      return output;
    });
    if (new Set(sort.map(rule => rule.column)).size !== sort.length) reject('重复排序');
    const output = { columns: all, visible, configuration: { expression, sort } };
    if (JSON.stringify(output).length > 128 * 1024) reject('方案JSON容量'); return output;
  };
  /** 真实回包必须是完整文档，phase2不要求跨Main的临时全局connectionRevision相等。 */
  const snapshot = (value: any, withToken: boolean, bindColumns = true): any => {
    const item = record(value, ['version', 'revision', 'entries', 'source', ...(withToken ? ['bindingToken'] : [])]);
    if (item.version !== 1) reject('方案版本');
    const entries = array(item.entries, 100).map(item => {
      const entry = record(item, ['id', 'name', 'connectionDigest', 'value']), name = string(entry.name, 1, 80);
      if (name !== name.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) reject('方案名');
      return { id: uuid(entry.id), name, connectionDigest: digest(entry.connectionDigest), value: presetValue(entry.value, bindColumns) };
    });
    if (new Set(entries.map(entry => entry.id)).size !== entries.length || new Set(entries.map(entry => entry.name)).size !== entries.length) reject('重复方案');
    return { version: 1, revision: revision(item.revision), entries, source: source(item.source), ...(withToken ? { bindingToken: uuid(item.bindingToken) } : {}) };
  };
  const expected = initial.expected ? snapshot(initial.expected, false, false) : undefined;
  if (expected && (expected.entries.length !== 1 || expected.entries[0].name !== '重启保留整理' || expected.entries[0].connectionDigest !== expected.source.connectionDigest)) reject('重启期望来源');
  const complete = (): boolean => state.schemeCommands.length === 2 && !state.schemePending;
  /** 同URL换文档也永久失效；后续请求不准通过相同数字senderId重新认领。 */
  const assertOwner = (event?: any): void => {
    if (event) {
      const sender = event.sender, frame = event.senderFrame;
      if (sender?.id !== initial.senderId || !frame || sender.mainFrame !== frame || typeof sender.on !== 'function' || typeof sender.isDestroyed !== 'function' || sender.isDestroyed() || frame.detached || typeof frame.url !== 'string' || !frame.url || !Number.isSafeInteger(frame.processId) || !frame.frameToken) reject('原sender或frame');
      if (!owner) {
        owner = { sender, frame, url: frame.url, processId: frame.processId, frameToken: frame.frameToken };
        const revoke = () => { state.invalid = true; state.failure ||= '主文档生命周期'; };
        sender.on('did-start-navigation', (details: any) => { if (details.isMainFrame && !details.isSameDocument) revoke(); });
        for (const event of ['did-navigate', 'render-process-gone', 'destroyed']) sender.on(event, revoke);
      } else if (sender !== owner.sender || frame !== owner.frame) reject('原sender对象');
    }
    if (owner && (owner.sender.id !== initial.senderId || owner.sender.isDestroyed() || owner.sender.mainFrame !== owner.frame || owner.frame.detached || owner.frame.url !== owner.url || owner.frame.processId !== owner.processId || owner.frame.frameToken !== owner.frameToken)) reject('原文档身份');
  };
  let wrapped: any;
  state.check = (): void => {
    if (state.invalid) reject();
    const now = Date.now();
    if (root[key] !== state || ipcMain._invokeHandlers !== handlers || handlers.get('dbark:request') !== wrapped || Object.keys(initial).some(key => (target as any)[key] !== (initial as any)[key])) reject('原审计归属');
    if (!Number.isFinite(now) || now < state.last || now >= initial.deadline) reject('原期限或时钟'); state.last = now; assertOwner();
  };
  wrapped = async (event: any, payload: any): Promise<any> => {
    state.check(); assertOwner(event);
    const packet = record(payload, ['command', 'input']), command = string(packet.command, 1, 100), input = packet.input;
    let claim: any, closeWorkspace = false, query = false, sessionClaim: any;
    if (command.startsWith('result.presets.')) {
      const kind = command.slice(15);
      if (state.workspaceClosed || state.schemePending || state.queries !== 1 || !state.queryColumns || steps[state.schemeCommands.length] !== kind) reject('方案次数或顺序');
      const fields = kind === 'list' ? ['connectionId'] : ['connectionId', 'source', 'expectedRevision', 'bindingToken', ...(kind === 'save' ? ['name', 'value'] : ['id'])];
      const copy = record(input, fields), previous = state.snapshot;
      if (copy.connectionId !== initial.profileId) reject('方案连接');
      if (kind !== 'list') {
        if (!previous || revision(copy.expectedRevision) !== previous.revision || uuid(copy.bindingToken) !== previous.bindingToken || !same(source(copy.source), previous.source)) reject('方案CAS或令牌');
        if (kind === 'save') { if (copy.name !== '重启保留整理') reject('固定方案名'); copy.value = presetValue(copy.value); }
        else if (uuid(copy.id) !== previous.entries[0]?.id) reject('准确方案编号');
      }
      state.schemePending = true; state.schemeCommands.push(kind); claim = { kind, input: copy, previous };
    } else if (command === 'sessions.open') {
      const copy = record(input, ['connectionId', 'database'], ['connectionId']);
      if (copy.connectionId !== initial.profileId || copy.database !== undefined && copy.database !== null || state.sessionClaim || state.workspaceClosed) reject('单次会话');
      sessionClaim = { sender: event.sender, frame: event.senderFrame, revision: state.revision, response: undefined }; state.sessionClaim = sessionClaim;
    } else if (command === 'query.execute') {
      const copy = record(input, ['sessionId', 'sql', 'taskId', 'maxRows'], ['sessionId', 'sql', 'taskId', 'maxRows']);
      if (!state.session || copy.sessionId !== state.session || copy.sql !== initial.sql || state.queries || state.workspaceClosed || !Number.isSafeInteger(copy.maxRows) || copy.maxRows < 3 || copy.maxRows > 100000) reject('准确常量查询');
      uuid(copy.taskId); state.queries++; query = true;
    } else if (command === 'settings.save') {
      const settings = record(input, ['theme', 'sidebarWidth', 'resultLimit', 'pageSize', 'dataTypeColors', 'editorFontSize', 'editorWordWrap', 'editorTabSize', 'editorInsertSpaces', 'sqlKeywordCase', 'tabs', 'activeTabId'], ['tabs']);
      const tabs = array(settings.tabs, 1), active = settings.activeTabId;
      if (!tabs.length) { if (!complete() || active !== undefined && active !== '') reject('关闭工作区阶段'); closeWorkspace = true; }
      else {
        const tab = record(tabs[0], ['id', 'kind', 'title', 'connectionId', 'database', 'databaseContext', 'table', 'sql', 'sourceBinding', 'fileSourceBinding', 'queryEditorHeight'], ['id', 'kind', 'connectionId', 'sql']);
        if (state.workspaceClosed || active !== initial.tabId || tab.id !== initial.tabId || tab.kind !== 'query' || tab.connectionId !== initial.profileId || tab.sql !== initial.sql) { state.revision++; reject('准确工作区目标'); }
      }
    } else if (command === 'connections.open') { const copy = record(input, ['id']); if (copy.id !== initial.profileId || state.workspaceClosed) reject('连接只读目标'); }
    else if (['query.completionState', 'query.sessionState', 'sessions.close'].includes(command)) {
      const copy = record(input, ['sessionId']); if (!state.session || copy.sessionId !== state.session) reject('查询上下文来源');
      if (command === 'sessions.close') { if (!complete() || state.sessionClosed) reject('会话关闭阶段'); state.sessionClosed = true; }
    } else if (command === 'metadata.completion') {
      const copy = record(input, ['connectionId', 'taskId', 'prefix', 'kind', 'database', 'objectKind', 'table', 'details'], ['connectionId', 'taskId', 'prefix', 'kind']);
      if (copy.connectionId !== initial.profileId || !['databases', 'objects', 'columns'].includes(copy.kind) || state.workspaceClosed) reject('补全只读目标');
      uuid(copy.taskId); string(copy.prefix, 0, 64);
      record(input, ['connectionId', 'taskId', 'prefix', 'kind', ...(copy.kind === 'objects' ? ['database', 'objectKind'] : copy.kind === 'columns' ? ['database', 'table', 'details'] : [])], ['connectionId', 'taskId', 'prefix', 'kind', ...(copy.kind === 'objects' ? ['database', 'objectKind'] : copy.kind === 'columns' ? ['database', 'table'] : [])]);
      if (copy.kind !== 'databases') string(copy.database, 1, 256);
      if (copy.kind === 'objects' && !['relation', 'function', 'procedure'].includes(copy.objectKind)) reject('补全对象类型');
      if (copy.kind === 'columns') { string(copy.table, 1, 256); if (copy.details !== undefined && copy.details !== true) reject('补全详情形状'); }
    } else if (['settings.get', 'connections.list', 'tasks.list'].includes(command)) record(input, []);
    else if (command === 'history.list') { const copy = record(input, ['connectionId'], []); if (copy.connectionId !== undefined && copy.connectionId !== initial.profileId) reject('历史只读目标'); }
    else { if (command.startsWith('connections.')) state.revision++; reject('未授权命令'); }
    state.pending++;
    try {
      const response = await original(event, payload);
      if (sessionClaim) sessionClaim.response = response;
      state.check(); assertOwner(event);
      const reply = record(response, ['ok', 'result', 'error'], ['ok']); if (reply.ok !== true) reject('原处理器失败回包');
      if (sessionClaim) { if (state.sessionClaim !== sessionClaim || event.sender !== sessionClaim.sender || event.senderFrame !== sessionClaim.frame || state.revision !== sessionClaim.revision) reject('会话迟到回包'); state.session = string(record(reply.result, ['sessionId']).sessionId, 1, 200); }
      if (query) {
        const outcome = record(reply.result, ['results', 'elapsedMs', 'transactionOpen', 'explain'], ['results', 'elapsedMs']);
        const results = array(outcome.results, 1, 1), result = record(results[0], ['columns', 'rows', 'affectedRows', 'insertId', 'warningCount', 'truncated', 'elapsedMs', 'statement'], ['columns', 'rows', 'truncated', 'elapsedMs', 'statement']);
        if (result.statement !== initial.sql || result.truncated !== false) reject('真实常量查询回包'); array(result.rows, 3, 3);
        state.queryColumns = array(result.columns, 7, 7).map(item => { const column = record(item, ['key', 'name', 'type']); return { key: string(column.key, 1, 4096), name: string(column.name, 0, 4096), type: string(column.type, 0, 256) }; });
        if (new Set(state.queryColumns.map((column: any) => column.key)).size !== 7) reject('查询重复键');
      }
      if (claim) {
        if (claim.kind === 'read') { const next = presetValue(reply.result); if (!same(next, claim.previous.entries[0].value)) reject('重启读取完整值'); state.lastRead = next; }
        else {
          const next = snapshot(reply.result, true);
          if (tokens.has(next.bindingToken)) reject('重复回包令牌'); tokens.add(next.bindingToken);
          if (claim.kind === 'list') {
            if (initial.phase === 1 ? next.entries.length !== 0 || next.revision !== 0 : next.version !== expected.version || next.revision !== expected.revision || next.source.connectionDigest !== expected.source.connectionDigest || !same(next.entries, expected.entries)) reject('重启持久文档');
          } else if (next.revision !== claim.previous.revision + 1 || !same(next.source, claim.previous.source) || next.entries.length !== 1 || next.entries[0].name !== '重启保留整理' || next.entries[0].connectionDigest !== next.source.connectionDigest || !same(next.entries[0].value, claim.input.value)) reject('真实保存完整值');
          state.snapshot = next;
        }
        state.schemePending = false;
      }
      if (closeWorkspace) state.workspaceClosed = true;
      return response;
    } catch { if (!state.invalid) reject('原处理器抛出'); reject(); }
    finally { state.pending--; }
  };
  root[key] = state; handlers.set('dbark:request', wrapped); state.check();
}

/** 仅观察真实处理器已交付事实；快照剥除本代bindingToken，供重启后及只读SQLite核验。 */
export function readQueryResultPresetsRestartAudit(): { queries: number; pending: number; revision: number; schemeCommands: string[]; snapshot?: QueryResultPresetStoredSnapshot; lastRead?: QueryResultPresetValue; workspaceClosed: boolean } {
  const state = (globalThis as any).__dbarkQueryResultPresetsRestartAudit;
  if (!state || typeof state.check !== 'function') throw Error('重启整理审计失去归属'); state.check();
  const snapshot = state.snapshot ? { version: state.snapshot.version, revision: state.snapshot.revision, entries: state.snapshot.entries, source: state.snapshot.source } : undefined;
  return { queries: state.queries, pending: state.pending, revision: state.revision, schemeCommands: [...state.schemeCommands], ...(snapshot ? { snapshot } : {}), ...(state.lastRead ? { lastRead: state.lastRead } : {}), workspaceClosed: state.workspaceClosed };
}
