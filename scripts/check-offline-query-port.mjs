import { Socket } from 'node:net';

/** 单次检查唯一固定离线目标；只有原error报告ECONNREFUSED且原close到达才允许通过。 */
async function requireOfflineQueryPort() {
  const socket = new Socket();
  return new Promise((resolve, reject) => {
    let refused = false, connected = false, closed = false, settled = false, failure;
    let finalizer;
    /** 首个失败粘性保留，清理只作用于这个原socket，不合成任何原生事件。 */
    function fail(message) {
      failure ??= '固定离线预检失败：' + message;
      if (!closed && !socket.destroyed) { try { socket.destroy(); } catch { /* 截止时间仍负责拒绝，不能把清理异常当作close。 */ } }
    }
    /** 截止时间始终保持引用；终态清理计时器，error监听留在原socket上吸收迟到错误。 */
    function finish() {
      if (settled) return;
      settled = true; clearTimeout(deadline); if (finalizer !== undefined) clearImmediate(finalizer);
      if (!failure && refused && closed && !connected) resolve();
      else reject(Error(failure ?? '固定离线预检失败：未取得原socket拒连后关闭的完整证明。'));
    }
    const deadline = setTimeout(() => {
      fail(closed ? '3000毫秒内未完成原socket关闭后的终态确认，未放行。' : refused ? '127.0.0.1:1已拒连，但3000毫秒内未收到原socket close，未放行。' : '3000毫秒内未取得127.0.0.1:1拒连后关闭证明，未放行。');
      finish();
    }, 3000);
    // 必须先登记同一个原socket的全部事件，再调用connect；不用createConnection或重试。
    socket.on('connect', () => { if (!settled) { connected = true; fail('127.0.0.1:1连接成功，目标存在监听，未放行。'); } });
    socket.on('error', error => {
      if (settled) return;
      if (error?.code === 'ECONNREFUSED' && !closed && !connected) refused = true;
      else { const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : '未知错误'; fail('原socket出现非预期拒连顺序或其它错误（' + code + '），未放行。'); }
    });
    socket.on('close', () => {
      if (settled || closed) return;
      closed = true;
      if (!refused) failure ??= '固定离线预检失败：原socket close前未收到ECONNREFUSED，未放行。';
      // 原close是必要条件；下一轮确认前的迟到error/connect也必须记入同一个结果。
      finalizer = setImmediate(finish);
    });
    socket.on('timeout', () => { if (!settled) fail('原socket报告超时，未放行。'); });
    try { socket.connect({ host: '127.0.0.1', port: 1, family: 4 }); }
    catch { fail('固定目标connect调用同步失败，未放行。'); }
  });
}

// CLI不接受任何参数，也不从环境读取目标、端口或认证信息。
if (process.argv.length !== 2) {
  console.error('固定离线预检失败：只检查127.0.0.1:1，不接受任何命令行参数。'); process.exitCode = 1;
} else {
  try { await requireOfflineQueryPort(); console.log('固定离线预检通过：127.0.0.1:1报告ECONNREFUSED，原socket已关闭；仅单次检查。'); }
  catch (error) { console.error(typeof error?.message === 'string' && error.message.startsWith('固定离线预检失败：') ? error.message : '固定离线预检失败：检查未完成，未放行。'); process.exitCode = 1; }
}
