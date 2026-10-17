import { readEditorWordWrap } from '../../shared/editorWordWrap';
import { flushSettings, useWorkspace } from '../store';
import { errorMessage } from '../lib';
import { editorWordWrapZh as text } from '../locales/editorWordWrap.zh-CN';

/** 命令栏单项偏好：旧事件也只基于当前store切换，不携带旧SQL或标签快照。 */
export function EditorWordWrapButton() {
  const enabled = useWorkspace(state => readEditorWordWrap(state.settings.editorWordWrap));
  /** 同步合并一个字段后沿既有链路保存；回包不回写settings，失败沿既有通知呈现。 */
  function toggle() {
    const workspace = useWorkspace.getState();
    workspace.updateSettings({ editorWordWrap: !readEditorWordWrap(workspace.settings.editorWordWrap) });
    void flushSettings().catch(reason => useWorkspace.getState().notify(errorMessage(reason), true));
  }
  return <button type="button" aria-pressed={enabled} title={enabled ? text.enabled : text.disabled} onClick={toggle}>{text.action}</button>;
}
