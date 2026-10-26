import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const Packet = require(join(dirname(require.resolve('mysql2')), 'lib/packets/packet.js')) as new (id: number, buffer: Buffer, start: number, end: number) => { eofStatusFlags(): number };

/** 使用实际安装驱动读取二进制EOF，不能由mock数值掩盖高位符号错误。 */
function eof(low: number, high: number) {
  const buffer = Buffer.from([5, 0, 0, 1, 0xfe, 0, 0, low, high]);
  return new Packet(1, buffer, 0, buffer.length).eofStatusFlags();
}

describe('mysql2真实EOF的无符号16位状态', () => {
  it.each([[0, 0, 0], [1, 0, 1], [2, 0, 2], [3, 0, 3], [2, 2, 514], [0, 128, 32768], [2, 130, 33282], [3, 130, 33283], [255, 255, 65535]])('原字节低%#项保持完整无符号状态', (low, high, expected) => {
    expect(eof(low, high)).toBe(expected);
  });
  it('MariaDB ANSI_QUOTES高位共存时事务、自动提交和NBE位独立保留', () => {
    const idle = eof(2, 130), active = eof(3, 130);
    expect(idle).toBeGreaterThanOrEqual(0); expect(idle & 32768).toBe(32768); expect(idle & 512).toBe(512); expect(idle & 2).toBe(2); expect(idle & 1).toBe(0);
    expect(active & 1).toBe(1); expect(active & 32768).toBe(32768);
  });
});
