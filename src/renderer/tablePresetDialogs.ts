/** 只观察模态上下文，不关闭窗口或改动输入；takeRecords覆盖同一轮打开又关闭的ABA。 */
export function createPresetDialogGuard(document:Pick<Document,'body'|'querySelector'>,Observer:typeof MutationObserver|undefined=globalThis.MutationObserver) {
  let invalidated=false;
  /** 只记录dialog节点及role变化，普通表格渲染或文本编辑不会使方案误失效。 */
  function observe(records:MutationRecord[]) {
    const dialog=(node:Node)=>node.nodeType===1&&((node as Element).getAttribute('role')==='dialog'||!!(node as Element).querySelector('[role="dialog"]'));
    if(records.some(record=>record.type==='attributes'?record.oldValue==='dialog'||dialog(record.target):[...record.addedNodes,...record.removedNodes].some(dialog)))invalidated=true;
  }
  const observer=typeof Observer==='function'?new Observer(observe):undefined;
  if(observer&&document.body)observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['role'],attributeOldValue:true});
  return {
    /** 发布前同步排空尚未回调的观察记录，恢复原DOM也不能复活旧请求。 */
    current(){if(observer)observe(observer.takeRecords());if(document.querySelector('[role="dialog"]'))invalidated=true;return !invalidated;},
    /** 只释放本请求的只读观察者。 */
    dispose(){observer?.disconnect();},
  };
}
