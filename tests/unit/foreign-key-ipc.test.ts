import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { foreignKeyAcknowledgementIds } from '../../src/shared/tableForeignKeyTasks';

const get = { connectionId: 'profile', database: '开发库', table: 'child', taskId: 'read-fk' };
const definition = { name: 'fk_child_parent', parentRef: 'opaque-parent', pairs: [{ childColumnRef: 'opaque-child-column', parentColumnRef: 'opaque-parent-column' }], onUpdate: 'CASCADE', onDelete: 'RESTRICT' };
const preview = () => ({ snapshotId: 'opaque-snapshot', taskId: 'preview-fk', patches: [{ op: 'add', clientKey: 'draft', definition: structuredClone(definition) }] });

describe('外键差异公开 IPC 边界', () => {
  it('只提供四个专用命令，普通目标不需要 SQL 或连接凭据', () => {
    for (const suffix of ['get', 'preview', 'apply', 'release']) expect(publicCommands).toHaveProperty('schema.foreignKeys.' + suffix, true);
    expect(validateCommand('schema.foreignKeys.get', { ...get, parentTargets: [{ database: '另一个库', table: '父表' }] })).toEqual({ ...get, parentTargets: [{ database: '另一个库', table: '父表' }] });
  });
  it.each(['retainedParents', 'refs', 'connectionRevision', 'profile', 'sql'])('界面不能注入内部字段 %s 扩大读取或执行范围', key => {
    expect(() => validateCommand('schema.foreignKeys.get', { ...get, [key]: key === 'sql' ? 'DROP DATABASE x' : [] })).toThrow();
  });
  it('父目标必须有界且每个目标只有库、表两个字段', () => {
    expect(() => validateCommand('schema.foreignKeys.get', { ...get, parentTargets: Array.from({ length: 17 }, (_, index) => ({ database: 'd', table: 'p' + index })) })).toThrow();
    expect(() => validateCommand('schema.foreignKeys.get', { ...get, parentTargets: [{ database: 'd', table: 'p', connectionId: 'another' }] })).toThrow();
    expect(() => validateCommand('schema.foreignKeys.get', { ...get, parentTargets: [{ database: 'd', table: 'p\0x' }] })).toThrow();
  });
  it('有序父子元组只允许 opaque 引用，不接受补丁中的 SQL', () => {
    expect(validateCommand('schema.foreignKeys.preview', preview())).toEqual(preview());
    const input = preview();
    expect(() => validateCommand('schema.foreignKeys.preview', { ...input, sql: 'ALTER TABLE p DROP PRIMARY KEY' })).toThrow();
    expect(() => validateCommand('schema.foreignKeys.preview', { ...input, patches: [{ ...input.patches[0], sql: 'DROP FOREIGN KEY arbitrary' }] })).toThrow();
  });
  it('补丁访问器不会在校验时运行，无法以 getter 伪造已核对定义', () => {
    let called = false;
    const patch = { op: 'add', clientKey: 'draft', get definition() { called = true; return definition; } };
    expect(() => validateCommand('schema.foreignKeys.preview', { snapshotId: 's', taskId: 'p', patches: [patch] })).toThrow();
    expect(called).toBe(false);
  });
  it('确认项仅接受外键集合且拒绝重复，不接受其它结构编辑器的授权项', () => {
    const apply = { previewToken: 'token', taskId: 'apply-fk', acknowledgements: [...foreignKeyAcknowledgementIds] };
    expect(validateCommand('schema.foreignKeys.apply', apply)).toEqual(apply);
    expect(() => validateCommand('schema.foreignKeys.apply', { ...apply, acknowledgements: ['ddl-implicit-commit', 'ddl-implicit-commit'] })).toThrow();
    expect(() => validateCommand('schema.foreignKeys.apply', { ...apply, acknowledgements: ['primary-key-change'] })).toThrow();
    expect(() => validateCommand('schema.foreignKeys.apply', { ...apply, sql: 'ALTER TABLE child ADD x INT' })).toThrow();
  });
  it('只能释放明确令牌，释放入口不能兼作取消其它任务', () => {
    expect(validateCommand('schema.foreignKeys.release', { snapshotId: 's', previewToken: 'p' })).toEqual({ snapshotId: 's', previewToken: 'p' });
    expect(() => validateCommand('schema.foreignKeys.release', {})).toThrow();
    expect(() => validateCommand('schema.foreignKeys.release', { snapshotId: 's', taskId: 'other' })).toThrow();
  });
});
