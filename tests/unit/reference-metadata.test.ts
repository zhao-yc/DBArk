import { describe, expect, it } from 'vitest';
import { foreignKeyActions } from '../../src/engine/references';

describe('SHOW CREATE外键动作补读', () => {
  it('多个外键、跨库、复合列及省略动作按真实约束名匹配', () => {
    const ddl = 'CREATE TABLE `child` (`a` int, `b` int, CONSTRAINT `fk_one` FOREIGN KEY (`a`,`b`) REFERENCES `other`.`parent` (`x`,`y`) ON DELETE SET NULL ON UPDATE CASCADE, CONSTRAINT `fk_two` FOREIGN KEY (`b`) REFERENCES `second` (`id`))';
    expect([...foreignKeyActions(ddl)]).toEqual([['fk_one', { onDelete: 'SET NULL', onUpdate: 'CASCADE' }], ['fk_two', { onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }]]);
  });
  it('反引号双写转义和合法prototype名称正常保存', () => {
    const ddl = 'CREATE TABLE `a` (`a``b` int, CONSTRAINT `fk``x` FOREIGN KEY (`a``b`) REFERENCES `p` (`id`) ON UPDATE NO ACTION, CONSTRAINT `__proto__` FOREIGN KEY (`a``b`) REFERENCES `p` (`id`) ON DELETE RESTRICT)';
    expect(foreignKeyActions(ddl).get('fk`x')?.onUpdate).toBe('NO ACTION'); expect(foreignKeyActions(ddl).get('__proto__')?.onDelete).toBe('RESTRICT');
  });
  it('ANSI_QUOTES和NO_BACKSLASH_ESCAPES正确区分标识符与文字量', () => {
    const ddl = `CREATE TABLE "child" ("a" int COMMENT '反斜线\\', CONSTRAINT "fk" FOREIGN KEY ("a") REFERENCES "parent" ("id") ON UPDATE CASCADE)`;
    expect(foreignKeyActions(ddl, true, true).get('fk')?.onUpdate).toBe('CASCADE');
  });
  it('字符串、注释及字段名中的伪constraint和动作不参与解析', () => {
    const ddl = `CREATE TABLE t (
      a varchar(300) DEFAULT 'CONSTRAINT fake FOREIGN KEY (a) REFERENCES x(id) ON DELETE CASCADE',
      b varchar(20) COMMENT '引号\\\'与括号),',
      /* CONSTRAINT fake2 FOREIGN KEY (a) REFERENCES x(id) */
      \`CONSTRAINT\` int,
      CONSTRAINT real_fk FOREIGN KEY (a) REFERENCES parent(id) # ON UPDATE CASCADE
    )`;
    expect([...foreignKeyActions(ddl).keys()]).toEqual(['real_fk']); expect(foreignKeyActions(ddl).get('real_fk')?.onUpdate).toBe('RESTRICT');
  });
  it('删除后的普通表和视图不会凭文字制造外键', () => { expect(foreignKeyActions('CREATE TABLE t (id int, note text)')).toEqual(new Map()); expect(foreignKeyActions("CREATE VIEW v AS SELECT 'CONSTRAINT f FOREIGN KEY(x) REFERENCES y(z)' AS title")).toEqual(new Map()); });
  it('重复约束、未知动作和未闭合定义明确失败，不能猜规则', () => {
    expect(() => foreignKeyActions('CREATE TABLE t (CONSTRAINT f FOREIGN KEY (a) REFERENCES p(id) ON DELETE SET DEFAULT)')).toThrow('无法确定');
    expect(() => foreignKeyActions('CREATE TABLE t (CONSTRAINT f FOREIGN KEY (a) REFERENCES p(id),CONSTRAINT f FOREIGN KEY (b) REFERENCES p(id))')).toThrow('无法确定');
    expect(() => foreignKeyActions('CREATE TABLE t (id int')).toThrow('未闭合');
  });
});
