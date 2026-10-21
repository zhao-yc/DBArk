import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** 运行真实构建后的Worker入口；仅self消息端口替身，既不启动GUI也不读目录。 */
describe('本地Worker窗口能力白名单', () => {
  it('缺省/错误/未知字段关闭，明确布尔能力才交付本地窗口名；握手仍是原版本', () => {
    const bundle = buildSync({ entryPoints: ['src/renderer/completion.worker.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
    const messages: any[] = [], port: any = { postMessage: (value: unknown) => messages.push(structuredClone(value)) };
    runInNewContext(bundle, { self: port, console: { error() { throw Error('不得回显SQL'); }, warn() {}, log() {} }, setTimeout, clearTimeout }, { timeout: 8000 });
    expect(messages).toEqual([{ type: 'dbark-completion-ready', version: 1 }]);
    const marked = 'SELECT ROW_NUMBER() OVER w|suffix WINDOW win AS()', source = marked.replace('|', '');
    for (const [index, capabilities] of [undefined, {}, { windowFunctions: false }, { windowFunctions: 'true' }, { windowFunctions: true, extra: true }, { windowFunctions: true }].entries()) {
      port.onmessage({ data: { id: index + 1, source, offset: marked.indexOf('|'), mode: {}, capabilities } });
      expect(messages.at(-1)).toMatchObject(index === 5 ? { id: index + 1, result: { status: 'ready', windowNames: ['win'], relations: [], syntax: [] } } : { id: index + 1, result: { status: 'blocked', reason: 'capability' } });
    }
  });
  it('真实Worker只交付本地帧关键字和原替换范围，不携带目录来源',()=>{
    const bundle=buildSync({entryPoints:['src/renderer/completion.worker.ts'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',logLevel:'silent'}).outputFiles[0].text;
    const messages:any[]=[],port:any={postMessage:(value:unknown)=>messages.push(structuredClone(value))};
    runInNewContext(bundle,{self:port,console:{error(){throw Error('不得回显SQL');},warn(){},log(){}},setTimeout,clearTimeout},{timeout:8000});
    const marked='SELECT SUM(v) OVER(ORDER BY id ROWS BETWEEN 1 PRECEDING AND CUR|RENT ROW) FROM users';
    port.onmessage({data:{id:1,source:marked.replace('|',''),offset:marked.indexOf('|'),mode:{},capabilities:{windowFunctions:true}}});
    expect(messages.at(-1)).toMatchObject({id:1,result:{status:'ready',syntax:[],relations:[],keywords:['CURRENT']}});
    expect(messages.at(-1).result.target).toMatchObject({start:marked.indexOf('CUR|'),end:marked.indexOf('CUR|')+7,prefix:'CUR',qualifiers:[],quoted:false});
  });
});
