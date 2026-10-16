import { createVitest } from 'vitest/node';

// 此入口只收集，强制关闭双门；即使调用者误带真实开关，也不会执行beforeAll或加载数据库夹具。
process.env.DBARK_INTEGRATION_ENABLED = '0';
process.env.DBARK_D02_COPY_SOURCE_ENABLED = '0';
process.env.TEST = 'true'; process.env.VITEST = 'true'; process.env.NODE_ENV = 'test';
const context = await createVitest('test', { config: 'tests/integration/helpers/d02-copy-source-vitest.config.ts', run: true, watch: false, maxWorkers: 1, reporters: [] }, { envDir: false });
try {
  // Vitest 3.2原生list故意过滤skipped；官方collect API可保留全部实际注册定义，不解开安全门。
  const { testModules, unhandledErrors } = await context.collect(['tests/integration/engine-table-copy-source.integration.test.ts']);
  if (unhandledErrors.length || testModules.some(file => file.errors().length || [...file.children.allSuites()].some(suite => suite.errors().length))) throw new Error('D02用例收集出现错误，未执行真实验收');
  const definitions = testModules.flatMap(file => [...file.children.allTests()].map(test => ({ name: test.fullName, file: test.module.moduleId, state: test.result().state })));
  if (definitions.length !== 8 || definitions.some(test => test.state !== 'skipped')) throw new Error('D02默认八项定义或关闭门状态不正确');
  console.log(JSON.stringify(definitions, null, 2));
} finally { await context.close(); }
