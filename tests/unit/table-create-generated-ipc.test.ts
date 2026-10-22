import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { tableCreateAcknowledgements } from '../../src/shared/tableCreate';
import { generatedColumnAcknowledgement } from '../../src/shared/tableGeneratedColumn';

const apply = { previewToken: 'prepared-token', confirmation: 'test_db.new_table', taskId: 'create-task' };

describe('新建表生成列的受限IPC确认入口', () => {
  it('仅结构化读取开关可进入准备，字符串和私造能力不进入引擎', () => {
    for (const flag of [true, false]) {
      const value = { connectionId: 'c', database: 'test_db', taskId: 'read', includeGeneratedFacts: flag };
      expect(validateCommand('schema.tableCreate.get', value)).toEqual(value);
    }
    for (const patch of [{ includeGeneratedFacts: '1' }, { generatedAccess: { editable: true } }, { generatedFacts: { version: '8.4.11' } }]) {
      expect(() => validateCommand('schema.tableCreate.get', { connectionId: 'c', database: 'test_db', taskId: 'read', ...patch })).toThrow();
    }
  });

  it('普通创建保留两项确认，生成设计允许第三项；准确设计匹配由令牌持有方核对', () => {
    for (const acknowledgements of [[...tableCreateAcknowledgements], [...tableCreateAcknowledgements, generatedColumnAcknowledgement]]) {
      const input = { ...apply, acknowledgements };
      expect(validateCommand('schema.tableCreate.apply', input)).toEqual(input);
    }
  });

  it.each([
    [], ['ddl-implicit-commit'], ['ddl-implicit-commit', generatedColumnAcknowledgement],
    ['create-only-no-replay', generatedColumnAcknowledgement],
    [...tableCreateAcknowledgements, generatedColumnAcknowledgement, generatedColumnAcknowledgement],
    [...tableCreateAcknowledgements, 'generated-expression-recalculation'],
    [...tableCreateAcknowledgements, 'arbitrary-risk-accepted'],
    ['ddl-implicit-commit', 'ddl-implicit-commit'],
  ].map(acknowledgements => ({ acknowledgements })))('拒绝缺少原确认、重复、越权或其它用途确认：%j', ({ acknowledgements }) => {
    expect(() => validateCommand('schema.tableCreate.apply', { ...apply, acknowledgements })).toThrow();
  });

  it('旧schema.preview拒绝生成属性，不能绕过准备与预览令牌', () => {
    const design = { database: 'test_db', name: 'new_table', engine: 'InnoDB', charset: 'utf8mb4', comment: '',
      columns: [{ name: 'n', type: 'INT', nullable: true, autoIncrement: false, comment: '', generated: { storage: 'VIRTUAL', expression: '1 + 2' } }], indexes: [], foreignKeys: [] };
    expect(() => validateCommand('schema.preview', { connectionId: 'c', design })).toThrow();
  });
});
