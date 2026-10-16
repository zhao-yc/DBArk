/** Monaco公共模型/编辑器的RAM边界，不模拟原生输入、布局、磁盘或撤销栈验收。 */
export class ContentModelPort {
  version = 1; disposed = false; controlledEdits = 0; stackStops = 0; readonly content = new Set<(event: any) => void>(); readonly ending = new Set<() => void>();
  pending: Array<() => void> = []; deferred = false; uri = { path: 'ram-model' };
  constructor(public value = '', public eol = '\n') { this.value = this.normalize(value); }
  normalize(value: string) { return value.replace(/\r\n|\r|\n/g, this.eol); }
  getValue() { return this.value; } getEOL() { return this.eol; } getVersionId() { return this.version; }
  getValueLength() { return this.value.length; } isDisposed() { return this.disposed; }
  getFullModelRange() { return { startLineNumber: 1, startColumn: 1, endLineNumber: this.value.split(this.eol).length, endColumn: this.value.split(this.eol).at(-1)!.length + 1 }; }
  onDidChangeContent(callback: (event: any) => void) { this.content.add(callback); return { dispose: () => this.content.delete(callback) }; }
  onWillDispose(callback: () => void) { this.ending.add(callback); return { dispose: () => this.ending.delete(callback) }; }
  pushEditOperations(_before: unknown, edits: Array<{ text: string }>, cursor: Function) { this.controlledEdits++; this.edit(edits[0].text); return cursor([]); }
  pushStackElement() { this.stackStops++; }
  /** 延迟模式保留已排队的原回调，用于验证解绑后仍到达的旧世代事件。 */
  edit(value: string) {
    this.value = this.normalize(value); const event = { versionId: ++this.version }, targets = [...this.content];
    const deliver = () => { for (const callback of targets) callback(event); };
    if (this.deferred) this.pending.push(deliver); else deliver();
  }
  flush() { for (const callback of this.pending.splice(0)) callback(); }
  dispose() { if (this.disposed) return; for (const callback of [...this.ending]) callback(); this.disposed = true; this.content.clear(); this.ending.clear(); }
}

export class ContentEditorPort {
  readOnly = true; disposed = false; edits: string[] = []; undoStops = 0; actions: any[] = [];
  modelChanges = new Set<() => void>(); ending = new Set<() => void>(); libraryChanges = new Set<(event: any) => void>();
  unlocks: number[] = []; modelSubscription?: { dispose(): void }; setValueCalls = 0;
  constructor(public model: ContentModelPort | null, options: any = {}) { this.readOnly = options.readOnly ?? false; this.attachLibraryEvents(); }
  getModel() { return this.model; } getValue() { return this.model?.getValue() ?? ''; }
  getSelections() { return null; }
  getOption() { return this.readOnly; } getRawOptions() { return { readOnly: this.readOnly }; }
  updateOptions(options: any) { if (this.disposed) throw Error('不能更新已销毁编辑器'); if ('readOnly' in options) { if (!options.readOnly) this.unlocks.push(this.model?.content.size ?? 0); this.readOnly = options.readOnly; } }
  onDidChangeModel(callback: () => void) { this.modelChanges.add(callback); return { dispose: () => this.modelChanges.delete(callback) }; }
  onDidDispose(callback: () => void) { this.ending.add(callback); return { dispose: () => this.ending.delete(callback) }; }
  onDidChangeModelContent(callback: (event: any) => void) { this.libraryChanges.add(callback); return { dispose: () => this.libraryChanges.delete(callback) }; }
  /** 库的Editor事件与产品的Model事件独立计数，防止同时走两条onChange路径。 */
  attachLibraryEvents() { this.modelSubscription?.dispose(); this.modelSubscription = this.model?.onDidChangeContent(event => { for (const callback of [...this.libraryChanges]) callback(event); }); }
  setModel(model: ContentModelPort | null) { this.model = model; this.attachLibraryEvents(); for (const callback of [...this.modelChanges]) callback(); }
  executeEdits(source: string, edits: Array<{ text: string }>) { if (!this.model || this.readOnly) return false; this.edits.push(source); this.model.edit(edits[0].text); return true; }
  pushUndoStop() { this.undoStops++; return true; }
  setValue(value: string) { this.setValueCalls++; this.model?.edit(value); }
  nativeInput(value: string) { if (this.readOnly || !this.model || this.disposed) return false; this.model.edit(value); return true; }
  addAction(action: any) { this.actions.push(action); return { dispose() {} }; }
  saveViewState() { return null; } restoreViewState() {} revealLine() {}
  dispose() { if (this.disposed) return; this.disposed = true; for (const callback of [...this.ending]) callback(); this.modelSubscription?.dispose(); this.modelChanges.clear(); this.ending.clear(); this.libraryChanges.clear(); }
}
