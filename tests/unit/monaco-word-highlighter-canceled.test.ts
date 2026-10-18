import {beforeAll,describe,expect,it}from'vitest';
import {monacoWordHighlighterCore,wordHighlighterHarness}from'../fixtures/monaco-word-highlighter';
let core:Awaited<ReturnType<typeof monacoWordHighlighterCore>>;
beforeAll(async()=>{core=await monacoWordHighlighterCore();});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
describe('Monaco实际WordHighlighter的局部取消归属',()=>{
  it.each([[true,'focus'],[true,'cursor'],[false,'focus'],[false,'cursor']]as const)('只读=%s、%s排队后模型解除：真实取消无未处理拒绝，也不关闭高亮',async(readOnly,event)=>{
    const h=wordHighlighterHarness(core,readOnly),unexpected:unknown[]=[];const capture=(reason:unknown)=>unexpected.push(reason);process.on('unhandledRejection',capture);
    try{h.fire(event);expect(h.highlighter.runDelayer.isTriggered()).toBe(true);expect(h.highlighter.occurrencesHighlightEnablement).toBe('singleFile');h.unbind();await tick();expect(unexpected).toEqual([]);expect(h.reported).toEqual([]);expect(h.requests).toBe(0);expect(h.contribution.wordHighlighter).toBeNull();}finally{h.dispose();process.removeListener('unhandledRejection',capture);}
  });
  it.each([[true,'focus'],[true,'cursor'],[false,'focus'],[false,'cursor']]as const)('只读=%s、%s正常执行保留实际provider请求和两处高亮',async(readOnly,event)=>{
    const h=wordHighlighterHarness(core,readOnly);try{h.fire(event);await new Promise(resolve=>setTimeout(resolve,80));expect(h.requests).toBe(1);expect(h.references).toBe(1);expect(h.ranges).toHaveLength(2);expect(h.hasHighlights).toBe(true);expect(h.reported).toEqual([]);expect(h.ranges[0].range.startColumn).toBe(1);expect(h.ranges[1].range.startColumn).toBe(9);}finally{h.dispose();}
  });
  it.each(['focus','cursor']as const)('%s仅真实CancellationError被消费；普通及同名Canceled错误仍进入官方报告和监听器',async event=>{
    for(const kind of['ordinary','same-name','string','real-cancellation']){
      const h=wordHighlighterHarness(core,true);try{h.fire(event);const error=kind==='real-cancellation'?new h.common.CancellationError():kind==='same-name'?Object.assign(Error('Canceled'),{name:'Canceled'}):kind==='string'?'Canceled':new TypeError('RAM真实非取消错误');
        h.highlighter.runDelayer.doReject(error);await tick();expect(h.reported).toEqual(kind==='real-cancellation'?[]:[error]);expect(h.notifications).toEqual(kind==='real-cancellation'?[]:[error]);
      }finally{h.dispose();await tick();}
    }
  });
  it('focus/cursor共用同一个待执行Promise，连续取消不产生孤立拒绝或额外请求',async()=>{
    const h=wordHighlighterHarness(core,false);try{h.fire('focus');const pending=h.highlighter.runDelayer.completionPromise;h.fire('cursor');expect(h.highlighter.runDelayer.completionPromise).toBe(pending);h.unbind();h.dispose();await tick();expect(h.reported).toEqual([]);expect(h.requests).toBe(0);}finally{h.dispose();}
  });
});
