import { describe, expect, it } from 'vitest';
import { bindIndexOptimizerTarget, indexOptimizerIntegrationGate } from '../helpers/indexOptimizerIntegration';

const config = () => ({ DBARK_INTEGRATION_ENABLED:'1', [indexOptimizerIntegrationGate]:'1', DBARK_TEST_HOST:'192.168.31.200', DBARK_TEST_PORT:'13384', DBARK_TEST_TLS:'0', DBARK_TEST_USER:'ram', DBARK_TEST_PASSWORD:'', DBARK_TEST_EXPECTED_SERVER_HOSTNAME:'server-200-ram', DBARK_TEST_EXPECTED_SERVER_ID:'1', DBARK_TEST_EXPECTED_SERVER_PORT:'3306', DBARK_TEST_EXPECTED_SERVER_UUID:'12345678-1234-1234-1234-123456789abc' });
describe('索引优化器实库独立双门和配置漂移',()=>{
  it('只使用显式六实例身份，不读取文件或补认证',()=>{const env=config(),binding=bindIndexOptimizerTarget(()=>env,'ram');expect(binding.profile).toMatchObject({port:13384,host:'192.168.31.200',password:''});binding.assertCurrent();expect(Object.isFrozen(binding.profile)).toBe(true);});
  it.each(Object.keys(config()))('缺少%s禁止绑定',key=>{const env:Record<string,string|undefined>=config();delete env[key];expect(()=>bindIndexOptimizerTarget(()=>env,'ram')).toThrow();});
  it.each(['0','2',undefined])('门值%j不能开启实库',value=>{const env={...config(),[indexOptimizerIntegrationGate]:value};expect(()=>bindIndexOptimizerTarget(()=>env,'ram')).toThrow();});
  it('不接受其它用途门、任意端口和严格TLS缺失；漂移后恢复原值也不能复活',()=>{
    expect(()=>bindIndexOptimizerTarget(()=>({...config(),DBARK_DATABASE_DEFAULT_ENCODING_TEST:'1'}),'ram')).toThrow();
    expect(()=>bindIndexOptimizerTarget(()=>({...config(),DBARK_TEST_PORT:'3306'}),'ram')).toThrow();
    expect(()=>bindIndexOptimizerTarget(()=>({...config(),DBARK_TEST_PORT:'13484',DBARK_TEST_TLS:'1'}),'ram')).toThrow();
    const env=config(),binding=bindIndexOptimizerTarget(()=>env,'ram');env.DBARK_TEST_HOST='other';expect(binding.assertCurrent).toThrow();env.DBARK_TEST_HOST='192.168.31.200';expect(binding.assertCurrent).toThrow();
  });
});
