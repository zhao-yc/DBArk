import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableCheckDefinition } from '../../src/engine/tableCheckDefinition';
import { planTableCheckChange, verifyTableCheckPlan, type TableCheckPlanSnapshot } from '../../src/engine/tableCheckPlan';
import { splitSql } from '../../src/engine/sql';
import type { TableCheckChange, TableCheckView } from '../../src/shared/tableChecks';
import type { TableDefinitionContext } from '../../src/shared/tableColumnPatches';

const base = "CREATE TABLE t (a int NOT NULL,b varchar(50) DEFAULT '' COMMENT '原列',CONSTRAINT ck_a CHECK (a>=0),CONSTRAINT ck_b CHECK (length(b)>0),CONSTRAINT fk FOREIGN KEY(a) REFERENCES p(id),KEY k(b)) ENGINE=InnoDB COMMENT='原表尾'";
/** 模拟reader已按目录核对并签发的ref/access；SQL原定义仍走真实解析入口。 */
function snapshot(source = base, dialect: 'mysql' | 'mariadb' = 'mysql', version = dialect === 'mysql' ? '8.4.11' : '11.4.13'): TableCheckPlanSnapshot {
  const context: TableDefinitionContext = { dialect, mode: { ansiQuotes: false, noBackslashEscapes: false } }, definition = parseTableColumnDefinition(source, context), checkDefinition = readTableCheckDefinition(definition, version), checks: TableCheckPlanSnapshot['checks'] = new Map();
  for (const [index, parsed] of checkDefinition.checks.entries()) {
    const checkRef = 'trusted-' + index, allowed = !!parsed.name && !parsed.opaqueReasons.length, access = () => ({ allowed, reasons: allowed ? [] : ['未核匿名或未知目录'] });
    const view: TableCheckView = { checkRef, name: parsed.name ?? '', expression: parsed.expression, location: parsed.location, ...(parsed.columnName === undefined ? {} : { columnName: parsed.columnName }), enforced: parsed.enforced, reasons: [...parsed.opaqueReasons], access: { drop: access(), replace: access(), enforcement: { allowed: allowed && dialect === 'mysql', reasons: dialect === 'mysql' ? [] : ['不支持逐约束开关'] } } };
    checks.set(checkRef, { parsed, view });
  }
  return { target: { connectionId: 'profile', database: '库`名', table: 't' }, serverVersion: version, definition, checkDefinition, checks, constraintNames: [...checks.values()].map(value => value.view.name).filter(Boolean).concat(source.includes('CONSTRAINT fk ') ? ['fk'] : []), writable: true, allowsNotEnforced: dialect === 'mysql' };
}
const add = (expression = 'a BETWEEN 1 AND 10'): TableCheckChange => ({ op: 'add', name: '新`约束', expression, enforced: true });
const entry = (value: TableCheckPlanSnapshot, name = 'ck_a') => [...value.checks.values()].find(item => item.view.name === name)!;

describe('单项CHECK变更只生成一次原生ALTER', () => {
  it('新增复杂表达式原样封装，标识符逐段引用，不重述原表定义', () => {
    const before = snapshot(), expression = "CASE WHEN `a` IS NULL THEN TRUE ELSE CAST(`a` AS DECIMAL(65,10)) BETWEEN 0 AND 18446744073709551615 END /* 普通注释 */ -- 尾注释\n", plan = planTableCheckChange(before, add(expression));
    expect(plan.sql).toBe("ALTER TABLE `库``名`.`t` ADD CONSTRAINT `新``约束` CHECK (\n" + expression + '\n) ENFORCED;');
    expect(splitSql(plan.sql)).toHaveLength(1); expect(plan.sql).not.toMatch(/(?:DROP|MODIFY|CHANGE|ENGINE|FOREIGN KEY|\bck_a\b|\bck_b\b)/);
    expect(plan.after).toEqual({ name: '新`约束', expression, enforced: true }); expect(plan.requiredAcknowledgements).toEqual(['ddl-implicit-commit', 'external-ddl-window', 'check-existing-rows']);
    expect(before.definition.source).toBe(base); expect(before.checks.size).toBe(2);
  });

  it.each(['mysql', 'mariadb'] as const)('%s准确DROP语法，仅使用reader签发的原名称', dialect => {
    const before = snapshot(base, dialect), target = entry(before), plan = planTableCheckChange(before, { op: 'drop', checkRef: target.view.checkRef });
    expect(plan.sql).toBe(`ALTER TABLE \`库\`\`名\`.\`t\` DROP ${dialect === 'mysql' ? 'CHECK' : 'CONSTRAINT'} \`ck_a\`;`);
    expect(plan.before).toEqual(target.view); expect(plan.after).toBeUndefined(); expect(plan.requiredAcknowledgements).toContain('check-removal'); expect(plan.requiredAcknowledgements).not.toContain('check-existing-rows');
  });

  it('替换单约束包含DROP与ADD，但仍只有一条ALTER；停用需独立确认', () => {
    const before = snapshot(), plan = planTableCheckChange(before, { op: 'replace', checkRef: entry(before).view.checkRef, name: 'renamed', expression: 'a>=10 AND a IN (10,20,30)', enforced: false });
    expect(plan.sql).toBe('ALTER TABLE `库``名`.`t` DROP CHECK `ck_a`, ADD CONSTRAINT `renamed` CHECK (\na>=10 AND a IN (10,20,30)\n) NOT ENFORCED;');
    expect(splitSql(plan.sql)).toHaveLength(1); expect(plan.requiredAcknowledgements).toContain('check-removal'); expect(plan.requiredAcknowledgements).toContain('check-disabled');
  });

  it('MySQL原生逐约束开关不重建表达式，已相同的替换/生效状态不发送DDL', () => {
    const before = snapshot(), ref = entry(before).view.checkRef;
    expect(planTableCheckChange(before, { op: 'enforcement', checkRef: ref, enforced: false }).sql).toBe('ALTER TABLE `库``名`.`t` ALTER CHECK `ck_a` NOT ENFORCED;');
    expect(() => planTableCheckChange(before, { op: 'enforcement', checkRef: ref, enforced: true })).toThrow('没有实际变更');
    expect(() => planTableCheckChange(before, { op: 'replace', checkRef: ref, name: 'ck_a', expression: '(((a>=0)))', enforced: true })).toThrow('没有实际变更');
  });

  it('MySQL5.7/8.0.15不可实施，Maria不能借新输入伪造NOT ENFORCED', () => {
    for (const version of ['5.7.44', '8.0.15']) expect(() => planTableCheckChange(snapshot('CREATE TABLE t(a int)', 'mysql', version), add())).toThrow();
    const maria = snapshot(base, 'mariadb'); expect(() => planTableCheckChange(maria, { ...add(), enforced: false } as TableCheckChange)).toThrow();
    expect(() => planTableCheckChange(maria, { op: 'enforcement', checkRef: entry(maria).view.checkRef, enforced: false })).toThrow();
    expect(planTableCheckChange(maria, add()).sql).not.toContain('ENFORCED');
  });

  it('匿名未映射/错误ref/目标/未知覆盖/readonly能力拒绝，不能默认按名称删除', () => {
    expect(() => planTableCheckChange(snapshot('CREATE TABLE t(a int CHECK(a>0))'), { op: 'drop', checkRef: 'trusted-0' })).toThrow();
    expect(() => planTableCheckChange(snapshot(), { op: 'drop', checkRef: 'ck_a' })).toThrow();
    const target = snapshot(); target.target.table = 'other'; expect(() => planTableCheckChange(target, add())).toThrow();
    const unknown = snapshot(base.replace('CHECK (a>=0)', 'CHECK (a>=0) FUTURE')); expect(() => planTableCheckChange(unknown, add())).toThrow();
    const denied = snapshot(); entry(denied).view.access.drop.allowed = false; expect(() => planTableCheckChange(denied, { op: 'drop', checkRef: entry(denied).view.checkRef })).toThrow();
    const readonly = snapshot(); readonly.writable = false; expect(() => planTableCheckChange(readonly, add())).toThrow();
  });

  it('Maria generic DROP遇任何同名其它约束拒绝；新增名称对全部目录约束查重', () => {
    const maria = snapshot(base, 'mariadb'); maria.constraintNames.push('ck_a'); expect(() => planTableCheckChange(maria, { op: 'drop', checkRef: entry(maria).view.checkRef })).toThrow();
    for (const name of ['CK_A', 'fk']) expect(() => planTableCheckChange(snapshot(), { op: 'add', name, expression: 'a>0', enforced: true })).toThrow();
    expect(() => planTableCheckChange(snapshot(), { op: 'replace', checkRef: 'trusted-0', name: 'ck_b', expression: 'a>10', enforced: true })).toThrow();
  });

  it('Maria风险默认值沿旧整表门，CHECK入口不能绕过ALTER重述风险', () => {
    const source = 'CREATE TABLE t(a int DEFAULT (rand()),CONSTRAINT ck_a CHECK (a>=0))';
    expect(() => planTableCheckChange(snapshot(source, 'mariadb'), add())).toThrow('默认值');
  });

  it.each(['a>0);DROP TABLE other;--', 'a>0) ENFORCED, DROP COLUMN b, CHECK(1', '(a>0', 'a>0; UPDATE other SET a=1', '/*!80016 a>0 */', '\0', '\ud800'])('不受控表达式不能逃出括号：%s', expression => { expect(() => planTableCheckChange(snapshot(), add(expression))).toThrow(); });
});

describe('DDL后核验只排除目标CHECK，其他约束和原字段仍核原片段', () => {
  it.each(['mysql', 'mariadb'] as const)('%s多行SHOW旧末项成为中项仅忽略表级布局边缘，内部注释仍拒变更', dialect => {
    const source = 'CREATE TABLE t (\n  a int NOT NULL,\n  KEY k(a),\n  CONSTRAINT ck_keep CHECK (a>0 /* 原旁约束注释 */)\n) ENGINE=InnoDB';
    const before = snapshot(source, dialect), plan = planTableCheckChange(before, { op: 'add', name: 'ck_new', expression: 'a<100', enforced: true });
    const afterSource = source.replace(' /* 原旁约束注释 */)\n)', ' /* 原旁约束注释 */),\n  CONSTRAINT ck_new CHECK (a<100)\n)'), after = snapshot(afterSource, dialect);
    expect(entry(before, 'ck_keep').parsed.rawSql).toBe('\n  CONSTRAINT ck_keep CHECK (a>0 /* 原旁约束注释 */)\n');
    expect(entry(after, 'ck_keep').parsed.rawSql).toBe('\n  CONSTRAINT ck_keep CHECK (a>0 /* 原旁约束注释 */)');
    expect(verifyTableCheckPlan(plan, before, after)).toBe(true);
    // key可忽略普通注释，但未修改的真实约束仍按其内部原文独立核验。
    expect(verifyTableCheckPlan(plan, before, snapshot(afterSource.replace('原旁约束注释', '已变更旁约束注释'), dialect))).toBe(false);
    const changedBefore = snapshot(source.replace('原旁约束注释', '已变更旁约束注释'), dialect);
    expect(verifyTableCheckPlan(plan, changedBefore, after)).toBe(false);
  });

  it('新增后允许服务器增加外括号，随机ref变化不替代真实name/表达式/生效状态', () => {
    const before = snapshot(), plan = planTableCheckChange(before, add('a BETWEEN 1 AND 10'));
    const after = snapshot(base.replace(') ENGINE', ',CONSTRAINT `新``约束` CHECK (((a BETWEEN 1 AND 10)))) ENGINE'));
    expect(verifyTableCheckPlan(plan, before, after)).toBe(true);
    const changedRef = new Map([...after.checks].map(([ref, value]) => { const next = 'fresh-' + ref; return [next, { ...value, view: { ...value.view, checkRef: next } }] as const; })); after.checks = changedRef;
    expect(verifyTableCheckPlan(plan, before, after)).toBe(true);
  });

  it('删除、替换和开关各自要求最终完整约束集合，不接受缺其它约束或相似名字', () => {
    const before = snapshot(), drop = planTableCheckChange(before, { op: 'drop', checkRef: entry(before).view.checkRef });
    const dropped = snapshot(base.replace('CONSTRAINT ck_a CHECK (a>=0),', '')); expect(verifyTableCheckPlan(drop, before, dropped)).toBe(true);
    expect(verifyTableCheckPlan(drop, before, snapshot(base.replace('CONSTRAINT ck_b CHECK (length(b)>0),', '')))).toBe(false);
    const replace = planTableCheckChange(before, { op: 'replace', checkRef: entry(before).view.checkRef, name: 'other', expression: 'a>=1', enforced: false });
    expect(verifyTableCheckPlan(replace, before, snapshot(base.replace('CONSTRAINT ck_a CHECK (a>=0)', 'CONSTRAINT other CHECK ((a>=1)) /*!80016 NOT ENFORCED */')))).toBe(true);
    const toggle = planTableCheckChange(before, { op: 'enforcement', checkRef: entry(before).view.checkRef, enforced: false });
    expect(verifyTableCheckPlan(toggle, before, snapshot(base.replace('CONSTRAINT ck_a CHECK (a>=0)', 'CONSTRAINT ck_a CHECK (a>=0) /*!80016 NOT ENFORCED */')))).toBe(true);
    expect(verifyTableCheckPlan(toggle, before, snapshot())).toBe(false);
  });

  it('列内目标删除仅排除准确属性区间，不丢列和旁边CHECK', () => {
    const source = "CREATE TABLE t(a int CONSTRAINT first CHECK(a>0) COMMENT '原',b int CONSTRAINT second CHECK(b<9)) ENGINE=InnoDB";
    const before = snapshot(source), plan = planTableCheckChange(before, { op: 'drop', checkRef: entry(before, 'first').view.checkRef });
    expect(verifyTableCheckPlan(plan, before, snapshot(source.replace('CONSTRAINT first CHECK(a>0) ', '')))).toBe(true);
    expect(verifyTableCheckPlan(plan, before, snapshot(source.replace('CONSTRAINT first CHECK(a>0) ', '').replace("COMMENT '原'", "COMMENT '新'")))).toBe(false);
  });

  it('任一未改字段/FK/索引/表选项/旁约束变动或来源过期，不能宣称核验成功', () => {
    const before = snapshot(), plan = planTableCheckChange(before, { op: 'drop', checkRef: entry(before).view.checkRef }), actual = base.replace('CONSTRAINT ck_a CHECK (a>=0),', '');
    for (const changed of [actual.replace("COMMENT '原列'", "COMMENT '变更'"), actual.replace('REFERENCES p(id)', 'REFERENCES other(id)'), actual.replace('KEY k(b)', 'KEY k(a)'), actual.replace("COMMENT='原表尾'", "COMMENT='新表尾'"), actual.replace('CHECK (length(b)>0)', 'CHECK (length(b)>=0)')]) expect(verifyTableCheckPlan(plan, before, snapshot(changed))).toBe(false);
    const freshBefore = snapshot(base.replace('CHECK (a>=0)', 'CHECK (a>=1)')); expect(verifyTableCheckPlan(plan, freshBefore, snapshot(actual))).toBe(false);
    const wrong = snapshot(actual); wrong.target.database = 'other'; expect(verifyTableCheckPlan(plan, before, wrong)).toBe(false);
    const mode = snapshot(actual); mode.definition.context.mode.ansiQuotes = true; expect(verifyTableCheckPlan(plan, before, mode)).toBe(false);
  });
});
