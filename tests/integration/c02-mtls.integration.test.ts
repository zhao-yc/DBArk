import { describe, it } from 'vitest';
import { c02Enabled } from './helpers/c02-mtls-policy';

// 默认不导入实库夹具，跳过时不读取证书/凭据文件、不运行 OpenSSL、不访问 200。
describe.skipIf(!c02Enabled(process.env))('C02 13484 真实 mTLS 核心验收（仅 ROOT 显式开启）', () => {
  it('严格 CA/IP SAN、REQUIRE X509、加密私钥正负例及精确收尾', async () => {
    const { runC02MtlS } = await import('./helpers/c02-mtls-fixture');
    const evidence = await runC02MtlS(process.env);
    // 仅在所有连接、账号、数据库与临时文件收尾成功后输出无秘密的证据。
    console.info(JSON.stringify({ 验收: 'C02 真实 mTLS', ...evidence, 严格CA及IPSAN: true, 精确清理完成: true }));
  }, 180000);
});
