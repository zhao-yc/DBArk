import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

// 工作区边距只作启动前预算；最终仍须原报告证明完整1400×1000客户区及整个窗口位于workArea内。
// 原job实测模式9可见高度1091，不能沿用低分辨率下菜单栏/Dock占用不变的1100估算。
export const keeperLimits = Object.freeze({ leaseSeconds: 600, minimumVisibleWidth: 1400 + 40, minimumVisibleHeight: 1000 + 50, contentWidth: 1400, contentHeight: 1000 });

/** 只允许已知from/to的CG与AppKit异步过渡；第三种模式/矩形不是可等待状态。 */
export function classifyModeTransition(snapshot, from, to, requireSpace) {
  assert.equal(snapshot.displays.length,1);
  const display=snapshot.displays[0], frame=display.framePoints, visible=display.visibleFramePoints;
  assert.equal(display.mirrored,false); assert.equal(display.backingScaleFactor,1);
  const fromMode=isDeepStrictEqual(display.currentMode,from), toMode=isDeepStrictEqual(display.currentMode,to);
  assert.ok(fromMode || toMode,'CG已漂移到未知模式');
  const fromFrame=frame.width===from.logicalWidth && frame.height===from.logicalHeight;
  const toFrame=frame.width===to.logicalWidth && frame.height===to.logicalHeight;
  assert.ok(fromFrame || toFrame,'AppKit已漂移到未知矩形');
  assert.ok(Number.isFinite(visible.width) && Number.isFinite(visible.height) && visible.width>0 && visible.height>0);
  assert.ok(visible.width<=Math.max(from.logicalWidth,to.logicalWidth) && visible.height<=Math.max(from.logicalHeight,to.logicalHeight));
  const enough=!requireSpace || visible.width>=keeperLimits.minimumVisibleWidth && visible.height>=keeperLimits.minimumVisibleHeight;
  return toMode && toFrame && enough ? 'ready' : 'waiting';
}

/** 仅从当次完整列表提出候选；可见区估算不是模式切换或原生客户区已验。 */
export function selectModeCandidate(inventory) {
  assert.equal(inventory.context.architecture, 'arm64');
  assert.equal(inventory.context.imageOS, 'macos26');
  assert.equal(inventory.context.imageVersion, '20261013.0424.1');
  assert.equal(inventory.displays.length, 1);
  const display = inventory.displays[0], current = display.currentMode;
  assert.ok(Number.isSafeInteger(display.displayID) && display.displayID > 0);
  assert.equal(display.mainDisplay, true); assert.equal(display.backingScaleFactor, 1);
  assert.equal(display.framePoints.width, current.logicalWidth); assert.equal(display.framePoints.height, current.logicalHeight);
  const modes = display.availableModes;
  assert.ok(Array.isArray(modes) && modes.length > 0 && modes.length <= 4096 && display.availableModeCount === modes.length);
  assert.equal(new Set(modes.map(mode => mode.modeID)).size, modes.length);
  assert.deepEqual(modes.find(mode => mode.modeID === current.modeID),current);
  for (const mode of [...modes, current]) {
    for (const key of ['modeID','logicalWidth','logicalHeight','pixelWidth','pixelHeight']) assert.ok(Number.isSafeInteger(mode[key]) && mode[key] >= (key === 'modeID' ? 0 : 1));
    assert.equal(mode.pixelWidth, mode.logicalWidth); assert.equal(mode.pixelHeight, mode.logicalHeight);
    assert.equal(mode.pixelToLogicalScaleX, 1); assert.equal(mode.pixelToLogicalScaleY, 1);
    assert.equal(mode.refreshRate, 60);
  }
  const lostWidth = display.framePoints.width - display.visibleFramePoints.width;
  const lostHeight = display.framePoints.height - display.visibleFramePoints.height;
  assert.ok(Number.isFinite(lostWidth) && lostWidth >= 0 && Number.isFinite(lostHeight) && lostHeight >= 0);
  const candidates = modes.filter(mode => mode.logicalWidth - lostWidth >= keeperLimits.minimumVisibleWidth && mode.logicalHeight - lostHeight >= keeperLimits.minimumVisibleHeight);
  candidates.sort((a,b) => a.logicalWidth*a.logicalHeight-b.logicalWidth*b.logicalHeight || a.modeID-b.modeID);
  assert.ok(candidates.length > 0, '没有满足原1400x1000客户区及保守可见余量的系统候选');
  return Object.freeze({ mode: candidates[0], displayID: display.displayID, estimatedVisible: { width: candidates[0].logicalWidth-lostWidth, height: candidates[0].logicalHeight-lostHeight }, limits: keeperLimits });
}

/** 单次非续期租约，严格接收本keeper帧；故障后不接受成功或补写恢复。 */
export function acceptKeeperEvent(state, event, now) {
  assert.ok(!state.failed && Number.isFinite(now) && now >= state.last && now < state.deadline, '原keeper租约失效');
  assert.equal(event.nonce, state.nonce); assert.equal(event.seq, state.seq + 1);
  assert.ok(['inventory','transition','ready','pulse','restored','failed'].includes(event.type));
  if (event.type === 'failed') throw Error('keeper原失败：' + event.reason);
  if (event.type === 'inventory') assert.equal(state.phase, 'starting');
  else if (event.type === 'transition') {
    assert.ok(['selected','releasing'].includes(state.phase));
    assert.equal(event.snapshot.displays[0].displayID,state.original.displayID);
    assert.equal(classifyModeTransition(event.snapshot,state.phase==='selected'?state.original.currentMode:state.plan.mode,state.phase==='selected'?state.plan.mode:state.original.currentMode,state.phase==='selected'),'waiting');
  }
  else if (event.type === 'ready' || event.type === 'pulse') {
    if (event.type === 'ready') assert.equal(state.phase, 'selected');
    else assert.ok(['ready','releasing'].includes(state.phase));
    const display = event.snapshot.displays[0];
    assert.equal(display.displayID,state.plan.displayID);
    assert.deepEqual(display.currentMode, state.plan.mode); assert.equal(display.backingScaleFactor, 1);
    assert.equal(display.mirrored, false); assert.equal(event.snapshot.displays.length, 1);
    assert.ok(display.visibleFramePoints.width >= keeperLimits.minimumVisibleWidth && display.visibleFramePoints.height >= keeperLimits.minimumVisibleHeight);
  } else {
    assert.equal(state.phase, 'releasing'); assert.equal(event.originalModeRestoredBeforeExit, true);
    assert.equal(event.postExitRestorationObserved, false);
    assert.equal(event.snapshot.displays.length,1);
    assert.deepEqual(event.snapshot.displays[0].currentMode,state.original.currentMode);
    assert.equal(event.snapshot.displays[0].displayID,state.original.displayID);
  }
  return { ...state, seq: event.seq, last: now, phase: event.type === 'inventory' ? 'inventoried' : ['pulse','transition'].includes(event.type) ? state.phase : event.type };
}
