import { afterEach, expect, it, vi } from 'vitest';
import { captureQueryResultGridLayout } from '../helpers/queryResultGridLayout';

afterEach(()=>vi.unstubAllGlobals());
/** 用不含业务文本的DOM端口验证采集上限和白名单；不启动真实窗口。 */
function fixture(){
  const target={getBoundingClientRect:()=>({x:30,y:40,width:170,height:40}),getAttribute:(key:string)=>key==='role'?'columnheader':null,contains:(element:unknown)=>element===target,parentElement:null,scrollLeft:0,scrollTop:0,clientWidth:170,clientHeight:40,scrollWidth:170,scrollHeight:40};
  const grid={...target,getAttribute:(key:string)=>key==='role'?'grid':null,querySelector:vi.fn<()=>typeof target|null>(()=>target),contains:(element:unknown)=>element===target||element===grid,parentElement:null as typeof target|null};
  Object.defineProperty(target,'textContent',{get(){throw Error('禁止读取业务文本');}});Object.defineProperty(grid,'innerHTML',{get(){throw Error('禁止读取HTML');}});
  const hit=vi.fn<(...point:number[])=>object|null>(()=>target),style=vi.fn(()=>({display:'grid',position:'sticky',zIndex:'2',pointerEvents:'auto',visibility:'visible',overflowX:'auto',overflowY:'auto',transform:'none'}));
  vi.stubGlobal('innerWidth',1400);vi.stubGlobal('innerHeight',1000);vi.stubGlobal('devicePixelRatio',1);vi.stubGlobal('getComputedStyle',style);vi.stubGlobal('document',{visibilityState:'visible',hasFocus:()=>true,elementFromPoint:hit});
  return{target,grid,hit,style,capture:()=>captureQueryResultGridLayout(grid as unknown as Element,4)};
}
it('只记录固定表头及五个命中点，输出没有单元格、HTML、类名或表单',()=>{
  const f=fixture(),sample=f.capture();expect(f.grid.querySelector).toHaveBeenCalledWith('[role="columnheader"][aria-colindex="4"]');expect(sample.viewport).toEqual({width:1400,height:1000,devicePixelRatio:1,visibility:'visible',focused:true});
  expect(sample.target?.rect).toEqual({x:30,y:40,width:170,height:40});expect(sample.hits).toHaveLength(5);expect(sample.hits[0]).toEqual({x:115,y:60,role:'columnheader',targetContainsHit:true,gridContainsHit:true,hitIsGrid:false});expect(f.hit).toHaveBeenCalledTimes(5);expect(JSON.stringify(sample)).not.toMatch(/textContent|innerHTML|className|value/);
});
it('网格自身拦截可辨认，未知命中角色只输出other',()=>{
  const f=fixture();f.hit.mockReturnValue(f.grid);expect(f.capture().hits.every(hit=>hit.hitIsGrid&&!hit.targetContainsHit&&hit.gridContainsHit)).toBe(true);
  f.hit.mockReturnValue({...f.target,getAttribute:()=> '私有属性'});expect(f.capture().hits.every(hit=>hit.role==='other'&&!hit.gridContainsHit)).toBe(true);
});
it('祖先链最多六层，缺失表头不读取其他目标，也不采样坐标',()=>{
  const f=fixture();f.grid.parentElement=f.grid as unknown as typeof f.target;expect(f.capture().ancestors).toHaveLength(6);f.grid.querySelector.mockReturnValue(null);f.hit.mockClear();expect(f.capture().target).toBeNull();expect(f.hit).not.toHaveBeenCalled();
});
it.each([0,-1,9,1.5,NaN])('非法列序号%s在读取DOM前拒绝',index=>{
  const f=fixture();expect(()=>captureQueryResultGridLayout(f.grid as unknown as Element,index)).toThrow('本例列头序号无效');expect(f.grid.querySelector).not.toHaveBeenCalled();expect(f.style).not.toHaveBeenCalled();
});
