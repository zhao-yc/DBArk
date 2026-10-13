import { Engine } from '../engine';
import type { EngineCommand } from '../shared/contracts';

const parent = process.parentPort;
if (!parent) throw new Error('数据库引擎只能由客户端启动');
const engine = new Engine(event => parent.postMessage({ type: 'task', event }));

/** 每个请求独立返回结果；引擎内部负责同一会话的串行化与取消控制。 */
parent.on('message', async ({ data }) => {
  const { id, command, input } = data;
  try {
    const result = command === '__shutdown' ? await engine.closeAll() : await engine.handle(command as EngineCommand, input);
    parent.postMessage({ type: 'response', id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '数据库操作失败';
    parent.postMessage({ type: 'response', id, error: message });
  }
});
