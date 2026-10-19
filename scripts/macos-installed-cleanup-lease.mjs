import assert from 'node:assert/strict';

/** 仅本次原生arm64子进程可要求显示租约恢复确认；普通安装入口不启用此门。 */
export function macInstalledCleanupNonce(args, platform, arch, env, channel) {
  if (!args.length) return undefined;
  assert.equal(args.length, 2); assert.equal(args[0], '--mac-installed-keeper');
  assert.match(args[1], /^[a-f0-9]{64}$/);
  assert.equal(platform, 'darwin'); assert.equal(arch, 'arm64');
  assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.MODE_KEEPER_RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(env.GITHUB_REF, 'refs/heads/codex/v028-serial-closeout-20261019');
  assert.equal(env.GITHUB_JOB, 'arm64-installed'); assert.equal(env.DBARK_NATIVE_EDITOR_CI, '1');
  assert.equal(typeof channel.send, 'function'); assert.equal(channel.connected, true);
  return args[1];
}

/** 原测试全部成功后才请求确认；无确认/错nonce/断线均拒绝卸载，保留安装现场。 */
export function confirmMacInstalledCleanup(channel, nonce) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => finish(Error('显示租约恢复确认超过15秒，保留安装现场')), 15000);
    const disconnected = () => finish(Error('显示保有父通道断开，保留安装现场'));
    const message = value => {
      if (!value || value.type !== 'dbark-mac-cleanup-approved' || value.nonce !== nonce || value.restored !== true || Object.keys(value).length !== 3) return finish(Error('显示恢复确认身份无效，保留安装现场'));
      finish();
    };
    /** 一次终态撤销所有监听；迟到确认不能复活已失败安装。 */
    function finish(error) {
      if (finished) return; finished = true;
      clearTimeout(timer); channel.off('message', message); channel.off('disconnect', disconnected);
      if (error) reject(error); else resolve();
    }
    channel.on('message', message); channel.on('disconnect', disconnected);
    try { channel.send({ type: 'dbark-mac-cleanup-request', nonce }, error => { if (error) finish(error); }); }
    catch (error) { finish(error); }
  });
}
