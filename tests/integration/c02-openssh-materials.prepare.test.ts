import { describe, it } from 'vitest';

// 准备与删除另有专项门；核心、GUI和服务器门均不能顺带生成或删除客户端材料。
describe.skipIf(process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_C02_OPENSSH_MATERIALS_ENABLED !== '1')('C02自有临时身份材料（仅ROOT显式准备/归还）', () => {
  it('只处理本片随机目录，不读取或改写既有Root身份', async () => {
    if (process.env.DBARK_C02_OPENSSH_ROOT_CONFIRM !== 'server-200/192.168.31.200/isolated-openssh') throw Error('C02新材料缺少ROOT标记');
    const { generateC02OpenSshMaterials, writeC02OpenSshMaterials, removeC02OpenSshMaterials } = await import('./helpers/c02-openssh-materials');
    if (process.env.DBARK_C02_OPENSSH_MATERIALS_ACTION === 'create') {
      const parent = process.env.DBARK_C02_OPENSSH_NEW_PARENT, port = process.env.DBARK_C02_OPENSSH_NEW_PORT;
      if (!parent || !/^[0-9]{5}$/.test(port ?? '')) throw Error('C02必须显式提供新临时父目录及待ROOT核空闲端口');
      const materials = generateC02OpenSshMaterials(Number(port)); const directory = await writeC02OpenSshMaterials(parent, materials);
      console.info(JSON.stringify({ 准备: '仅生成本片新加密材料，尚未部署或互通', directory, purpose: materials.manifest.purpose, run: materials.manifest.run, user: materials.manifest.user, port: materials.manifest.port, fingerprint: materials.manifest.fingerprint }));
    } else if (process.env.DBARK_C02_OPENSSH_MATERIALS_ACTION === 'remove') {
      const directory = process.env.DBARK_C02_OPENSSH_CLIENT_DIR, run = process.env.DBARK_C02_OPENSSH_REMOVE_RUN;
      if (!directory || !run || process.env.DBARK_C02_OPENSSH_CLEANUP_CONFIRM !== `server-and-clients-closed/${run}`) throw Error('C02必须由ROOT确认本轮服务器及所有客户端已结束');
      await removeC02OpenSshMaterials(directory, run); console.info('C02本轮客户端新材料已精确清理');
    } else throw Error('C02材料动作必须显式create或remove');
  });
});
