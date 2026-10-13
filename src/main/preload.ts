import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, TaskEvent } from '../shared/contracts';
import { publicCommands } from '../shared/commands';

/** 沙箱页面只能访问固定 API，不暴露原始 IPC、文件系统或 Node 对象。 */
const api: DesktopApi = {
  /** 只发送固定命令并将主进程错误转成可由界面处理的异常。 */
  async invoke(command, input) {
    if (!Object.hasOwn(publicCommands, command)) throw new Error('不支持的客户端操作');
    const response = await ipcRenderer.invoke('dbark:request', { command, input });
    if (!response.ok) throw new Error(response.error);
    return response.result;
  },
  /** 订阅任务事件并返回解绑函数，避免标签销毁后仍接收数据。 */
  onTask(listener) {
    const handler = (_event: Electron.IpcRendererEvent, event: TaskEvent) => listener(event);
    ipcRenderer.on('dbark:task', handler);
    return () => ipcRenderer.removeListener('dbark:task', handler);
  },
  /** 原生菜单只传递动作名称，不能执行任意脚本或暴露 IPC 对象。 */
  onMenu(listener) {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => listener(action);
    ipcRenderer.on('dbark:menu', handler);
    return () => ipcRenderer.removeListener('dbark:menu', handler);
  }
};
contextBridge.exposeInMainWorld('dbark', api);
