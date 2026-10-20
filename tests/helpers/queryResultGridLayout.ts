/** 仅投影本例网格几何及命中关系；可直接序列化到浏览器，不读取单元格、SQL、表单或HTML。 */
export function captureQueryResultGridLayout(grid:Element,columnIndex:number){
  if(!Number.isSafeInteger(columnIndex)||columnIndex<1||columnIndex>8)throw Error('本例列头序号无效');
  /** 属性只保留有限角色枚举，其他节点不保存用户自定义属性或类名。 */
  function role(element:Element|null){const value=element?.getAttribute('role');return ['grid','columnheader','gridcell','row','dialog'].includes(value??'')?value:'other';}
  /** 矩形及少量样式反映命中/裁剪，不序列化节点或文本。 */
  function geometry(element:Element){const box=element.getBoundingClientRect(),style=getComputedStyle(element);return{rect:{x:box.x,y:box.y,width:box.width,height:box.height},role:role(element),display:style.display,position:style.position,zIndex:style.zIndex,pointerEvents:style.pointerEvents,visibility:style.visibility,overflowX:style.overflowX,overflowY:style.overflowY,transform:style.transform,scrollLeft:element.scrollLeft,scrollTop:element.scrollTop,clientWidth:element.clientWidth,clientHeight:element.clientHeight,scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight};}
  const target=grid.querySelector(`[role="columnheader"][aria-colindex="${columnIndex}"]`),ancestors=[];let ancestor:Element|null=grid;
  for(let index=0;index<6&&ancestor;index++){ancestors.push(geometry(ancestor));ancestor=ancestor.parentElement;}
  const viewport={width:innerWidth,height:innerHeight,devicePixelRatio,visibility:document.visibilityState,focused:document.hasFocus()};
  if(!target)return{columnIndex,viewport,ancestors,target:null,hits:[]};
  const box=target.getBoundingClientRect(),positions=[[box.x+box.width/2,box.y+box.height/2],[box.x+1,box.y+1],[box.x+box.width-1,box.y+1],[box.x+1,box.y+box.height-1],[box.x+box.width-1,box.y+box.height-1]];
  const hits=positions.map(([x,y])=>{const hit=document.elementFromPoint(x,y);return{x,y,role:role(hit),targetContainsHit:!!hit&&target.contains(hit),gridContainsHit:!!hit&&grid.contains(hit),hitIsGrid:hit===grid};});
  return{columnIndex,viewport,ancestors,target:geometry(target),hits};
}
