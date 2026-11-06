import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

/** 不经 shell 运行已核验的绝对路径。取消或写入失败均等待原子进程 close。 */
export async function runNativeProcess(executable: string, label: string, args: readonly string[], env: NodeJS.ProcessEnv,
  signal: AbortSignal, write: (chunk: Buffer) => Promise<void>, inputFd?: number, showDetail = false): Promise<string> {
  signal.throwIfAborted();
  const child = spawn(executable, args, { env, cwd: tmpdir(), windowsHide: true, stdio: [inputFd ?? 'ignore', 'pipe', 'pipe'] });
  let launchError: Error | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
  child.on('error', error => { launchError = error; });
  const terminal = new Promise<number | null>(resolve => child.once('close', resolve));
  const stderr: Buffer[] = [];
  let available = 4096;
  child.stderr!.on('data', (chunk: Buffer) => {
    const keep = Math.min(available, chunk.length);
    if (keep) { stderr.push(Buffer.from(chunk.subarray(0, keep))); available -= keep; }
  });
  const stop = () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null || killTimer) return;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 3000);
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    for await (const chunk of child.stdout!) {
      signal.throwIfAborted();
      await write(chunk as Buffer);
    }
    const status = await terminal;
    signal.throwIfAborted();
    const detail = Buffer.concat(stderr).toString('utf8').trim();
    if (launchError || status !== 0) throw Error(label + ' 未正常完成' + (showDetail && detail ? '\n' + detail : ''));
    return detail;
  } catch (error) {
    stop();
    await terminal;
    throw error;
  } finally {
    if (killTimer) clearTimeout(killTimer);
    signal.removeEventListener('abort', stop);
  }
}
