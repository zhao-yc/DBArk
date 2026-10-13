import { zh, formatText } from '../locales/zh-CN';
import { useRef, useState } from 'react';
import { FolderOpen, ShieldCheck, PlugZap } from 'lucide-react';
import type { ConnectionProfile } from '../../shared/contracts';
import { errorMessage, invoke, uid } from '../lib';
import { saveConnectionUpdate } from '../connectionChanges';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { connectionsTransferZh } from '../locales/connectionsTransfer.zh-CN';
import { assignAuthorizedConnectionFile } from '../connectionsTransfer';
import { assertConnectionReady } from '../../shared/connectionTransfer';

/** 密码字段缺省表示保持原密码；界面仅提交新值，不读取解密后的保存值。 */
export function ConnectionDialog({ profile, initialProfile, onClose, onTransportChanged }: { profile?: ConnectionProfile; initialProfile?: ConnectionProfile; onClose: () => void; onTransportChanged: (connectionId: string) => void }) {
  const [form, setForm] = useState<ConnectionProfile>(() => profile ? structuredClone(profile) : initialProfile ? structuredClone(initialProfile) : { id: uid(), name: '', group: '', color: '#52c5a2', dialect: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', rememberPassword: true });
  const [section, setSection] = useState<'general' | 'ssh' | 'tls'>('general');
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [result, setResult] = useState('');
  const submitLock = useRef(false);
  const [allowIncomplete, setAllowIncomplete] = useState(false); const pendingFiles = form.pendingFiles ?? [];
  const hasOpenTabs = useWorkspace(state => !!profile && state.settings.tabs.some(tab => tab.connectionId === profile.id));
  /** 表单合并保留未编辑字段；秘密的 undefined 与空字符串语义不做归一化。 */
  const update = (patch: Partial<ConnectionProfile>) => setForm(previous => ({ ...previous, ...patch }));
  const ssh = form.ssh ?? { enabled: false, host: '', port: 22, user: '' };
  const tls = form.tls ?? { enabled: false, rejectUnauthorized: true };
  /** 只更新 SSH 子配置，保留身份验证和指纹等其余字段。 */
  const setSsh = (patch: Partial<NonNullable<ConnectionProfile['ssh']>>) => update({ ssh: { ...ssh, ...patch } });
  /** 只更新 TLS 子配置，证书路径仍由文件选择器提供。 */
  const setTls = (patch: Partial<NonNullable<ConnectionProfile['tls']>>) => update({ tls: { ...tls, ...patch } });
  /** 私钥与证书通过主进程的文件选择器获取，界面不读取文件内容。 */
  async function pick(purpose: 'key' | 'certificate', setter: (path: string) => void) {
    if (submitLock.current) return; submitLock.current = true; setBusy('file');
    try { const file = await invoke('files.choose', { purpose }); if (file) setter(await invoke('files.path', { token: file.token })); } catch (reason) { setError(errorMessage(reason)); }
    finally { submitLock.current = false; setBusy(''); }
  }
  /** 测试连接不会写入配置，保存成功后刷新连接列表再关闭表单。 */
  async function submit(test: boolean) {
    if (submitLock.current) return; submitLock.current = true;
    setError(''); setResult(''); setBusy(test ? 'test' : 'save');
    try {
      if (!form.host.trim() || !form.user.trim()) throw new Error(zh.connections.text001);
      if (!test && pendingFiles.length && !allowIncomplete) throw new Error(connectionsTransferZh.staged);
      if (test) assertConnectionReady(form);
      if (test) { const status = await invoke('connections.test', { ...form, name: form.name.trim() || form.host }); setResult(formatText(zh.connections.text002, status.dialect === 'mysql' ? 'MySQL' : 'MariaDB', status.version)); }
      else {
        // 保存瞬间读取最新标签；不能通过重连或关闭标签绕过保护，否则旧事务和表格草稿可能写往错误服务器。
        await saveConnectionUpdate(profile, { ...form, name: form.name.trim() || form.host }, useWorkspace.getState().settings.tabs, onTransportChanged);
        useWorkspace.getState().setConnections(await invoke('connections.list', {})); onClose();
      }
    } catch (reason) { setError(errorMessage(reason)); } finally { submitLock.current = false; setBusy(''); }
  }
  return <Modal title={profile ? zh.connections.text003 : zh.common.newConnection} onClose={() => { if (!submitLock.current) onClose(); }}><div className="dialog-tabs">{(['general', 'ssh', 'tls'] as const).map((key, index) => <button className={section === key ? 'selected' : ''} key={key} onClick={() => setSection(key)}>{[zh.connections.text004, zh.connections.text005, 'TLS / SSL'][index]}</button>)}</div><form onSubmit={event => { event.preventDefault(); void submit(false); }}><div className="modal-content">
    {initialProfile && <p className="info-strip">{connectionsTransferZh.copyHint}</p>}{pendingFiles.length > 0 && <><p className="warning-text">{connectionsTransferZh.pendingFiles}：{pendingFiles.map(kind => kind === 'sshPrivateKey' ? zh.connections.text022 : kind === 'tlsCa' ? zh.connections.text029 : kind === 'tlsCert' ? zh.connections.text030 : zh.connections.text031).join('、')}</p><label className="check"><input type="checkbox" checked={allowIncomplete} onChange={event => setAllowIncomplete(event.target.checked)}/>{connectionsTransferZh.staged}</label></>}{hasOpenTabs && <p className="info-strip">{zh.connections.openTabsHint}</p>}
    {section === 'general' && <div className="form-grid"><Field label={zh.connections.text006}><input value={form.name} placeholder={zh.connections.text007} onChange={event => update({ name: event.target.value })}/></Field><Field label={zh.connections.text008}><select value={form.dialect} onChange={event => update({ dialect: event.target.value as ConnectionProfile['dialect'] })}><option value="mysql">MySQL</option><option value="mariadb">MariaDB</option></select></Field><Field label={zh.connections.text009}><input required value={form.host} onChange={event => update({ host: event.target.value })}/></Field><Field label={zh.connections.text010}><input type="number" min="1" max="65535" value={form.port} onChange={event => update({ port: Number(event.target.value) })}/></Field><Field label={zh.common.user}><input required value={form.user} autoComplete="off" onChange={event => update({ user: event.target.value })}/></Field><Field label={zh.common.password}><SecretInput label={zh.connections.text011} value={form.password} hasSaved={form.hasPassword} onChange={password => update({ password })}/></Field><Field label={zh.connections.text012}><input value={form.database ?? ''} onChange={event => update({ database: event.target.value || undefined })}/></Field><Field label={zh.connections.text013}><input value={form.group} placeholder={zh.connections.text014} onChange={event => update({ group: event.target.value })}/></Field><Field label={zh.connections.text015}><input type="color" value={form.color} onChange={event => update({ color: event.target.value })}/></Field><label className="check"><input type="checkbox" checked={form.rememberPassword} onChange={event => update({ rememberPassword: event.target.checked })}/>{zh.connections.text016}</label></div>}
    {section === 'ssh' && <><label className="check section-check"><input type="checkbox" checked={ssh.enabled} onChange={event => setSsh({ enabled: event.target.checked })}/>{zh.connections.text017}</label><fieldset disabled={!ssh.enabled} className="form-grid"><Field label={zh.connections.text018}><input value={ssh.host} onChange={event => setSsh({ host: event.target.value })}/></Field><Field label={zh.connections.text019}><input type="number" value={ssh.port} onChange={event => setSsh({ port: Number(event.target.value) })}/></Field><Field label={zh.connections.text020}><input value={ssh.user} onChange={event => setSsh({ user: event.target.value })}/></Field><Field label={zh.connections.text021}><SecretInput label={zh.connections.text021} value={ssh.password} hasSaved={ssh.hasPassword} onChange={password => setSsh({ password })}/></Field><Field label={zh.connections.text022} full><div className="input-action"><input value={ssh.privateKeyPath ?? ''} onChange={event => setSsh({ privateKeyPath: event.target.value })}/><button type="button" onClick={() => void pick('key', path => setForm(current => assignAuthorizedConnectionFile(current, 'sshPrivateKey', path)))} aria-label={zh.connections.text023}><FolderOpen size={16}/></button></div></Field><Field label={zh.connections.text024}><SecretInput label={zh.connections.text024} value={ssh.passphrase} hasSaved={ssh.hasPassphrase} onChange={passphrase => setSsh({ passphrase })}/></Field><Field label={zh.connections.text025}><input value={ssh.hostFingerprint ?? ''} placeholder="SHA256:…" onChange={event => setSsh({ hostFingerprint: event.target.value })}/></Field></fieldset><p className="muted small">{zh.connections.text026}</p></>}
    {section === 'tls' && <><label className="check section-check"><input type="checkbox" checked={tls.enabled} onChange={event => setTls({ enabled: event.target.checked })}/>{zh.connections.text027}</label><fieldset disabled={!tls.enabled} className="form-grid"><label className="check full"><input type="checkbox" checked={tls.rejectUnauthorized} onChange={event => setTls({ rejectUnauthorized: event.target.checked })}/>{zh.connections.text028}</label>{([['caPath', zh.connections.text029], ['certPath', zh.connections.text030], ['keyPath', zh.connections.text031]] as const).map(([key, label]) => <Field key={key} label={label} full><div className="input-action"><input value={tls[key] ?? ''} onChange={event => setTls({ [key]: event.target.value })}/><button type="button" aria-label={formatText(zh.connections.text032, label)} onClick={() => void pick(key === 'keyPath' ? 'key' : 'certificate', path => setForm(current => assignAuthorizedConnectionFile(current, key === 'caPath' ? 'tlsCa' : key === 'certPath' ? 'tlsCert' : 'tlsKey', path)))}><FolderOpen size={16}/></button></div></Field>)}</fieldset></>}
    {!!profile?.pendingFiles?.length && <p className="muted small">{connectionsTransferZh.saveBeforeTest}</p>}<ErrorBox message={error}/>{result && <div className="success-box"><ShieldCheck size={16}/>{result}</div>}
    </div><footer className="modal-footer"><button type="button" disabled={!!busy} onClick={() => void submit(true)}>{busy === 'test' ? <Spinner text={zh.connections.text033}/> : <><PlugZap size={15}/>{zh.connections.text034}</>}</button><span className="grow"/><button type="button" disabled={!!busy} onClick={onClose}>{zh.common.cancel}</button><button type="submit" className="primary" disabled={!!busy}>{busy === 'save' ? zh.connections.text035 : zh.connections.text036}</button></footer></form></Modal>;
}

/** 未编辑的 undefined 保留旧秘密，显式清除传空字符串，保存前始终展示清除状态。 */
function SecretInput({ label, value, hasSaved, onChange }: { label: string; value: string | undefined; hasSaved?: boolean; onChange: (value: string | undefined) => void }) {
  return <><div className="input-action"><input aria-label={label} type="password" autoComplete="new-password" value={value ?? ''} placeholder={value === '' ? zh.connections.text037 : hasSaved ? zh.connections.text038 : ''} onChange={event => onChange(event.target.value)}/><button type="button" aria-label={formatText(zh.connections.text039, label)} onClick={() => onChange('')}>{zh.common.clear}</button>{value !== undefined && hasSaved && <button type="button" aria-label={formatText(zh.connections.text040, label)} onClick={() => onChange(undefined)}>{zh.connections.text041}</button>}</div><small className={value === '' ? 'secret-hint warning-text' : 'secret-hint muted'}>{value === '' ? zh.connections.text042 : hasSaved ? zh.connections.text043 : zh.connections.text044}</small></>;
}
