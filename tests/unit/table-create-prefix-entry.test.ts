import { sidebarMenuRegistrationPort } from '../helpers/sidebarMenuRamPort';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it } from 'vitest';
const code = (file: string) => ts.transpileModule(readFileSync(new URL('../e2e/' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
/** 关闭门执行真实入口；拒绝桌面、数据库和认证helper加载，不启动任何外部资源。 */
it.each([[['--list']], [['--list=true']], [[]]])('默认关闭及列举%s不读取目标或加载正式模块', argv => {
  const loads: string[] = []; let skipped = 0;
  const env = new Proxy({}, { get(_target, key) { if (argv.length || key !== 'DBARK_INTEGRATION_ENABLED') throw Error('关闭门不能读取目标'); return undefined; } });
  vm.runInNewContext(code('table-create-prefix.spec.ts'), { exports: {}, process: { argv, env }, require(name: string) { loads.push(name); if (name !== '@playwright/test') throw Error('默认关闭不可加载夹具'); return { test: { skip() { skipped++; } } }; } }); expect(loads).toEqual(['@playwright/test']); expect(skipped).toBe(1);
});
it('双门开启但隔离库/UUID不明确时不加载正式例', () => {
  const loads: string[] = []; expect(() => vm.runInNewContext(code('table-create-prefix.spec.ts'), { exports: {}, process: { argv: [], env: { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_CREATE_PREFIX_UI: '1' } }, require(name: string) { loads.push(name); if (name === '@playwright/test') return { test: {} }; if (name.endsWith('/tableDefaultEncodingTarget')) return { assertDefaultEncodingLiveTarget() {} }; throw Error('尚未核对目标不得加载'); } })).toThrow('专用隔离库'); expect(loads).not.toContain('./table-create-prefix-live');
});
it('正式模块仅注册真实场景，关闭轨迹并保持原90秒期限', () => {
  const names: string[] = [], options: unknown[] = [], timeouts: number[] = []; let hooks = 0;
  const test = Object.assign((name: string, _body: unknown) => names.push(name), { use: (value: unknown) => options.push(value), setTimeout: (value: number) => timeouts.push(value), afterEach() { hooks++; } });
  const exports: any = {}; vm.runInNewContext(code('table-create-prefix-live.ts'), { exports, require(name: string) {
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRegistrationPort; if (name === './desktop-fixture') return { test }; if (name === 'node:crypto' || name === './definition-navigation-live' || name.endsWith('/tableDefaultEncodingTarget') || name.endsWith('/zh-CN') || name.endsWith('/tableCreate.zh-CN') || name.endsWith('/tableCreatePrefix.zh-CN')) return {}; throw Error('仅注册不得加载其它模块：' + name); } }); exports.registerTableCreatePrefixTests(); expect(names).toHaveLength(1); expect(options).toEqual([{ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true }]); expect(timeouts).toEqual([90000]); expect(hooks).toBe(1);
});

it('本用途双门与完整显式参数通过后才加载注册模块，不读取回填文件', () => {
  const loads:string[]=[], env={DBARK_INTEGRATION_ENABLED:'1',DBARK_TABLE_CREATE_PREFIX_UI:'1',DBARK_TEST_HOST:'已核对目标',DBARK_TEST_PORT:'13384',DBARK_TEST_TLS:'0',DBARK_TEST_USER:'既有账号',DBARK_TEST_DATABASE:'dbark_e2e_prefix_'+'a'.repeat(32),DBARK_TEST_EXPECTED_SERVER_UUID:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};let registered=0;
  vm.runInNewContext(code('table-create-prefix.spec.ts'),{exports:{},process:{argv:[],env},require(name:string){loads.push(name);if(name==='@playwright/test')return{test:{}};if(name.endsWith('/tableDefaultEncodingTarget'))return{assertDefaultEncodingLiveTarget(){}};if(name==='./table-create-prefix-live')return{registerTableCreatePrefixTests(){registered++;}};throw Error('禁止其它模块');}});expect(registered).toBe(1);expect(loads.at(-1)).toBe('./table-create-prefix-live');
});
