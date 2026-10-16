import { describe, it } from 'vitest';
import { c02OpenSshEnabled } from './helpers/c02-openssh-policy';
import { c02WrongSshFingerprint } from './helpers/c02-ssh-policy';

// 默认不导入连接、文件或材料夹具；只在ROOT核验独立OpenSSH容器后实际执行。
describe.skipIf(!c02OpenSshEnabled(process.env, 'CORE'))('C02隔离OpenSSH真实认证准备', () => {
  for (const mode of ['password', 'encrypted-key'] as const) it(`${mode}正确/错误认证与错指纹、真实SELECT及精确DB清理`, async () => {
    const { withC02OpenSshLease, rejectC02OpenSsh, selectC02OpenSsh } = await import('./helpers/c02-openssh-fixture');
    const result = await withC02OpenSshLease(process.env, 'CORE', async lease => {
      const profile = lease.profile(mode);
      const wrong = structuredClone(profile);
      if (mode === 'password') wrong.ssh!.password += '-wrong'; else wrong.ssh!.passphrase += '-wrong';
      await rejectC02OpenSsh(wrong, mode === 'password' ? 'password' : 'passphrase');
      if (mode === 'encrypted-key') { const missing = structuredClone(profile); delete missing.ssh!.passphrase; await rejectC02OpenSsh(missing, 'passphrase'); }
      const fingerprint = structuredClone(profile); fingerprint.ssh!.hostFingerprint = c02WrongSshFingerprint(profile.ssh!.hostFingerprint!); await rejectC02OpenSsh(fingerprint, 'fingerprint');
      await selectC02OpenSsh(lease, mode);
      const { verifyC02OpenSshChannels } = await import('./helpers/c02-openssh-protocol'); await verifyC02OpenSshChannels(profile);
    });
    console.info(JSON.stringify({ 验收: 'C02实际OpenSSH核心', mode, ...result }));
  }, 180000);
});
