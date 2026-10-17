import { describe, expect, it, vi } from 'vitest';
import { tableCopyStructureServerProfile } from '../../src/shared/tableCopyStructureProfiles';
import { readTableCopyStructureCounter } from '../../src/engine/tableCopyStructureCounter';
import { assertTableCopyStructureUnchanged, type TableCopyStructureRead } from '../../src/engine/tableCopyStructureSql';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import type { TableCommentRead } from '../../src/engine/tableCommentRead';

describe('复制结构准确版本合同：8.0.46独占证据激活阶段', () => {
  it('两个准确补丁分别激活已核规则，合同不可运行时篡改', () => {
    expect(tableCopyStructureServerProfile('mysql', '8.4.11')).toMatchObject({ state: 'verified', canWrite: true, expectedNewCounter: '1' });
    const verified = tableCopyStructureServerProfile('mysql', '8.0.46'); expect(verified).toMatchObject({ id: 'mysql-8.0.46-like-v1', state: 'verified', canReadFacts: true, canWrite: true, expectedNewCounter: '1' }); expect(Object.isFrozen(verified)).toBe(true); expect(Reflect.set(verified, 'expectedNewCounter', '42')).toBe(false);
  });
  it.each(['8.0.46-commercial', '8.0.46+vendor'])('准确补丁后缀%s仅命中本版本独立合同', version => expect(tableCopyStructureServerProfile('mysql', version)).toMatchObject({ id: 'mysql-8.0.46-like-v1', canWrite: true, expectedNewCounter: '1' }));
  it.each(['8.0.30', '8.0.45', '8.0.47', '8.0.460', '8.4.12', '5.7.44', '11.4.13', '8.0.46.1'])('未证明版本%s不因能力相近而放行', version => expect(tableCopyStructureServerProfile('mysql', version)).toMatchObject({ state: 'unsupported', canReadFacts: false, canWrite: false, expectedNewCounter: null }));
  it('方言不能仅靠版本字符串伪装成MySQL，合同切换使旧快照拒绝', () => {
    expect(tableCopyStructureServerProfile('mariadb', '8.0.46').canWrite).toBe(false);
    expect(() => assertTableCopyStructureUnchanged({ serverProfileId: 'mysql-8.4.11-like-v1' } as TableCopyStructureRead, { serverProfileId: 'mysql-8.0.46-like-v1' } as TableCopyStructureRead)).toThrow('合同已变化');
  });
  it.each(['8.0.45', '8.0.47', '5.7.44'])('计数读取内层门在%s的任何SQL前拒绝，不构造预期1', async version => {
    const query = vi.fn(), started = vi.fn();
    const context = { managed: { status: { dialect: 'mysql', version }, connection: { query } }, checkCancelled: vi.fn(), report: vi.fn(), commandStarted: started } as unknown as StructureTaskContext;
    await expect(readTableCopyStructureCounter(context, { connectionId: 'c', database: 'db', table: 't' }, {} as TableCommentRead)).rejects.toThrow(); expect(query).not.toHaveBeenCalled(); expect(started).not.toHaveBeenCalled();
  });
});
