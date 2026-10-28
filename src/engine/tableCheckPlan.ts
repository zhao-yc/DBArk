import { tableCheckChangeSchema, tableCheckLimits, tableCheckMessages as text, tableCheckRequiredAcknowledgements, tableCheckTargetSchema, type TableCheckAcknowledgement, type TableCheckChange, type TableCheckTarget, type TableCheckView } from '../shared/tableChecks';
import { tableColumnDefaultRisks, tableColumnDefaultRiskMessage, type TableColumnDefinitionDocument } from '../shared/tableColumnPatches';
import { assertTableCheckExpression, tableCheckVersionCapabilities, type ParsedTableCheck, type TableCheckDefinitionRead } from './tableCheckDefinition';
import { identifier, qualified, SqlScriptScanner } from './sql';

export interface TableCheckPlanSnapshot {
  target: TableCheckTarget; serverVersion: string; definition: TableColumnDefinitionDocument; checkDefinition: TableCheckDefinitionRead;
  checks: Map<string, { view: TableCheckView; parsed: ParsedTableCheck }>; constraintNames: string[];
  writable: boolean; allowsNotEnforced: boolean;
}
interface ExpectedCheck { name: string; key: string; enforced: boolean; location: 'table' | 'column'; columnName?: string; rawSql?: string; }
export interface TableCheckPlan {
  target: TableCheckTarget; sql: string; change: TableCheckChange; before?: TableCheckView; after?: { name: string; expression: string; enforced: boolean };
  warnings: string[]; requiredAcknowledgements: TableCheckAcknowledgement[];
  /** 仅Engine持有后核验依据，不进入renderer可提交的输入或令牌定位合同。 */
  verification: { preserved: string; beforeSignature: string; expected: ExpectedCheck[]; dialect: 'mysql' | 'mariadb'; serverVersion: string; mode: string };
}

/** 引用由reader签发；目录、原片段和view不一致时不能靠renderer名称定位DROP。 */
function entries(snapshot: TableCheckPlanSnapshot): [string, { view: TableCheckView; parsed: ParsedTableCheck }][] {
  if (snapshot.checkDefinition.coverage !== 'complete' || snapshot.checkDefinition.source !== snapshot.definition.source || snapshot.checks.size !== snapshot.checkDefinition.checks.length || snapshot.checks.size > tableCheckLimits.checks) throw Error(text.incomplete);
  const result = [...snapshot.checks], names = new Set<string>();
  for (const [ref, { view, parsed }] of result) {
    if (!ref || view.checkRef !== ref || !view.name || view.enforced === null || parsed.opaqueReasons.length || view.location !== parsed.location || view.columnName !== parsed.columnName || parsed.name !== undefined && parsed.name !== view.name || parsed.enforced !== null && parsed.enforced !== view.enforced || snapshot.definition.source.slice(parsed.range.start, parsed.range.end) !== parsed.rawSql || !snapshot.checkDefinition.checks.some(item => item.range.start === parsed.range.start && item.range.end === parsed.range.end)) throw Error(text.incomplete);
    const name = view.name.toLowerCase(); if (names.has(name)) throw Error(text.incomplete); names.add(name);
    if (assertTableCheckExpression(view.expression, snapshot.definition.context).key !== assertTableCheckExpression(parsed.expression, snapshot.definition.context).key) throw Error(text.incomplete);
  }
  return result;
}

/** 表级项移到逗号前后时仅布局边缘会改变；列内范围及约束内部原文仍逐字保留。 */
function comparisonSql(parsed: ParsedTableCheck): string {
  return parsed.location === 'table' ? parsed.rawSql.trim() : parsed.rawSql;
}

/** 不按源名称文本替换；每个真实旧约束都按name/表达式/生效标记独立核验。 */
function expectation(snapshot: TableCheckPlanSnapshot, value: { view: TableCheckView; parsed: ParsedTableCheck }, keepRaw: boolean): ExpectedCheck {
  return { name: value.view.name, key: assertTableCheckExpression(value.view.expression, snapshot.definition.context).key, enforced: value.view.enforced!, location: value.view.location, ...(value.view.columnName === undefined ? {} : { columnName: value.view.columnName }), ...(keepRaw ? { rawSql: comparisonSql(value.parsed) } : {}) };
}
function signature(snapshot: TableCheckPlanSnapshot): string {
  return JSON.stringify(entries(snapshot).map(([, value]) => expectation(snapshot, value, true)).sort((a, b) => a.name.localeCompare(b.name)));
}
function sameTarget(left: TableCheckTarget, right: TableCheckTarget): boolean { return left.connectionId === right.connectionId && left.database === right.database && left.table === right.table; }

/** 一次只接受一个受控变更，生成单条原生ALTER，不重述其它列、索引、CHECK或表选项。 */
export function planTableCheckChange(snapshot: TableCheckPlanSnapshot, supplied: TableCheckChange): TableCheckPlan {
  const target = tableCheckTargetSchema.parse(snapshot.target), change = tableCheckChangeSchema.parse(supplied), definition = snapshot.definition;
  if (definition.table !== target.table || definition.database !== undefined && definition.database !== target.database) throw Error(text.invalid);
  const version = tableCheckVersionCapabilities(definition.context.dialect, snapshot.serverVersion);
  if (!version.writable) throw Error(text.unsupported);
  if (snapshot.writable !== true) throw Error(text.readonly);
  const oldEntries = entries(snapshot), risks = tableColumnDefaultRisks(definition);
  if (risks.length) throw Error(tableColumnDefaultRiskMessage(risks));
  const old = change.op === 'add' ? undefined : snapshot.checks.get(change.checkRef);
  if (change.op !== 'add' && !old) throw Error(text.stale);
  if (old) {
    const access = old.view.access[change.op === 'drop' ? 'drop' : change.op === 'replace' ? 'replace' : 'enforcement'];
    if (access.allowed !== true) throw Error(text.readonly);
    // Maria的DROP CONSTRAINT是通用名称操作，不能误中同名非CHECK约束。
    if (definition.context.dialect === 'mariadb' && snapshot.constraintNames.filter(name => name.toLowerCase() === old.view.name.toLowerCase()).length !== 1) throw Error(text.incomplete);
  }
  if (change.op !== 'drop' && !change.enforced && (!version.allowsNotEnforced || snapshot.allowsNotEnforced !== true)) throw Error(text.unsupported);
  if (change.op === 'enforcement' && !version.allowsNotEnforced) throw Error(text.unsupported);
  let after: TableCheckPlan['after'];
  if (change.op === 'add' || change.op === 'replace') {
    assertTableCheckExpression(change.expression, definition.context);
    const remaining = [...snapshot.constraintNames];
    if (old) { const index = remaining.findIndex(name => name === old.view.name); if (index < 0) throw Error(text.incomplete); remaining.splice(index, 1); }
    if (remaining.some(name => name.toLowerCase() === change.name.toLowerCase())) throw Error(text.invalid);
    if (change.op === 'add' && oldEntries.length >= tableCheckLimits.checks) throw Error(text.incomplete);
    after = { name: change.name, expression: change.expression, enforced: change.enforced };
  } else if (change.op === 'enforcement') after = { name: old!.view.name, expression: old!.view.expression, enforced: change.enforced };
  if (old && after && old.view.name === after.name && old.view.enforced === after.enforced && assertTableCheckExpression(old.view.expression, definition.context).key === assertTableCheckExpression(after.expression, definition.context).key) throw Error(text.noChange);
  const drop = old ? (definition.context.dialect === 'mysql' ? 'DROP CHECK ' : 'DROP CONSTRAINT ') + identifier(old.view.name) : undefined;
  const add = after ? `ADD CONSTRAINT ${identifier(after.name)} CHECK (\n${after.expression}\n)` + (definition.context.dialect === 'mysql' ? after.enforced ? ' ENFORCED' : ' NOT ENFORCED' : '') : undefined;
  const clauses = change.op === 'add' ? [add!] : change.op === 'drop' ? [drop!] : change.op === 'replace' ? [drop!, add!] : [`ALTER CHECK ${identifier(old!.view.name)} ${change.enforced ? 'ENFORCED' : 'NOT ENFORCED'}`];
  const sql = `ALTER TABLE ${qualified(target.database, target.table)} ${clauses.join(', ')};`;
  if (Buffer.byteLength(sql) > tableCheckLimits.ddlBytes) throw Error(text.expression);
  const scanner = new SqlScriptScanner(definition.context.mode.noBackslashEscapes, definition.context.mode.ansiQuotes);
  if (scanner.push(sql, true).length !== 1) throw Error(text.expression);
  const expected = oldEntries.filter(([, value]) => value !== old).map(([, value]) => expectation(snapshot, value, true));
  if (after) expected.push({ name: after.name, key: assertTableCheckExpression(after.expression, definition.context).key, enforced: after.enforced, location: change.op === 'enforcement' ? old!.view.location : 'table', ...(change.op === 'enforcement' && old!.view.columnName !== undefined ? { columnName: old!.view.columnName } : {}) });
  // Tasks统一追加共享通用警告；本层仅返回本次计划的附加警告，避免重复展示同一说明。
  return { target, sql, change, ...(old ? { before: structuredClone(old.view) } : {}), ...(after ? { after } : {}), warnings: [], requiredAcknowledgements: tableCheckRequiredAcknowledgements(change), verification: { preserved: snapshot.checkDefinition.preserved, beforeSignature: signature(snapshot), expected, dialect: definition.context.dialect, serverVersion: snapshot.serverVersion, mode: JSON.stringify(definition.context.mode) } };
}

/** 只核约束及排除真实CHECK范围后的原定义；物理表身份/模式/编码由reader的base verifier另核。 */
export function verifyTableCheckPlan(plan: TableCheckPlan, before: TableCheckPlanSnapshot, after: TableCheckPlanSnapshot): boolean {
  try {
    if (!sameTarget(plan.target, before.target) || !sameTarget(plan.target, after.target) || plan.verification.beforeSignature !== signature(before) || before.checkDefinition.preserved !== plan.verification.preserved || after.checkDefinition.preserved !== plan.verification.preserved || after.definition.context.dialect !== plan.verification.dialect || after.serverVersion !== plan.verification.serverVersion || JSON.stringify(after.definition.context.mode) !== plan.verification.mode) return false;
    const actual = entries(after).map(([, value]) => ({ ...expectation(after, value, false), rawSql: comparisonSql(value.parsed) }));
    if (actual.length !== plan.verification.expected.length) return false;
    return plan.verification.expected.every(expected => {
      const matches = actual.filter(value => value.name === expected.name);
      return matches.length === 1 && matches[0].key === expected.key && matches[0].enforced === expected.enforced && matches[0].location === expected.location && matches[0].columnName === expected.columnName && (expected.rawSql === undefined || matches[0].rawSql === expected.rawSql);
    });
  } catch { return false; }
}
