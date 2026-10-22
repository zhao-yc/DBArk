import type { TableCreateDraft } from '../shared/tableCreate';
import { tableCreateNumericType } from '../shared/tableCreateGenerated';

type Column = TableCreateDraft['columns'][number];
export type NewTableColumnMode = 'ordinary' | 'VIRTUAL' | 'STORED';

/** 备份仅属于原草稿列身份，不能把undefined、空字符串、SQL NULL或未指定键互相转换。 */
export class NewTableGeneratedDrafts {
  private readonly ordinary = new WeakMap<Column, Column>();
  private readonly generated = new WeakMap<Column, NonNullable<Column['generated']>>();

  /** 父表单产生新列对象时转交同一备份，重排则继续使用原对象。 */
  transfer(previous: Column, next: Column): void {
    const ordinary = this.ordinary.get(previous), generated = this.generated.get(previous);
    if (ordinary) this.ordinary.set(next, ordinary);
    if (generated) this.generated.set(next, generated);
  }

  /** 模式切换只改变当前列，不重写其它列名、表达式、索引或外键。 */
  switch(column: Column, mode: NewTableColumnMode): Column {
    if (mode === 'ordinary') {
      if (!column.generated) return column;
      const next = { ...(this.ordinary.get(column) ?? column), name: column.name, comment: column.comment };
      delete next.generated;
      this.transfer(column, next); this.generated.set(next, { ...column.generated });
      return next;
    }
    if (column.generated?.storage === mode) return column;
    const next: Column = { ...column, type: column.generated || tableCreateNumericType(column.type) ? column.type : 'decimal(30,6)', nullable: true, autoIncrement: false, generated: { ...(column.generated ?? this.generated.get(column) ?? { expression: '' }), storage: mode } };
    delete next.defaultValue; delete next.onUpdate;
    this.transfer(column, next);
    if (!column.generated) this.ordinary.set(next, { ...column });
    return next;
  }
}
