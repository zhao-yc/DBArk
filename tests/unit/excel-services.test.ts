import { describe, expect, it, vi } from 'vitest';
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../src/renderer/lib', () => bridge);
import { excelTransferServices } from '../../src/renderer/excelTransferServices';

describe('Excel 目标元数据的正式 IPC 接线', () => {
  it('独立任务编号随目标发送给可取消 metadata.table，而不复用文件编号', async () => {
    bridge.invoke.mockResolvedValueOnce({ columns: [{ name: '普通列', type: 'TEXT', generated: false }, { name: '生成列', type: 'TEXT', generated: true }] });
    const target = { connectionId: '连接', database: '库', table: '表' };
    await expect(excelTransferServices.targetColumns(target, '元数据编号')).resolves.toEqual([{ name: '普通列', type: 'TEXT', generated: false }]);
    expect(bridge.invoke).toHaveBeenCalledWith('metadata.table', { ...target, taskId: '元数据编号' });
    bridge.invoke.mockResolvedValueOnce(undefined); await excelTransferServices.cancel('元数据编号'); expect(bridge.invoke).toHaveBeenLastCalledWith('query.cancel', { taskId: '元数据编号' });
  });
});
