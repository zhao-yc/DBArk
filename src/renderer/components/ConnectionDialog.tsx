import { zh, formatText } from '../locales/zh-CN';
import { connectionProfileFromUri, connectionUriLimits } from '../../shared/connectionUri';
import { connectionUriZh } from '../locales/connectionUri.zh-CN';
import { tlsCredentialsZh } from '../locales/tlsCredentials.zh-CN';
import { assertTlsPassphrase, tlsPassphraseMaxLength } from '../../shared/tlsCredentials';
import { useRef, useState } from 'react';
import { FolderOpen, ShieldCheck, PlugZap } from 'lucide-react';
import { sqliteZh } from '../locales/sqlite.zh-CN';
import { sqliteFileName } from '../sqliteWorkspace';
import type { ConnectionProfile, NetworkConnectionProfile } from '../../shared/contracts';
import { errorMessage, invoke, uid } from '../lib';
import { saveConnectionUpdate } from '../connectionChanges';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import { connectionsTransferZh } from '../locales/connectionsTransfer.zh-CN';
import { assignAuthorizedConnectionFile } from '../connectionsTransfer';
import { assertConnectionReady } from '../../shared/connectionTransfer';

/** 密码字段缺省表示保持原密码；界面仅提交新值，不读取解密后的保存值。 */
export function ConnectionDialog({ profile, initialProfile, onClose, onTransportChanged }: { profile?: ConnectionProfile; initialProfile?: ConnectionProfile; onClose: () => void; onTransportChanged: (connectionId: string) => void }) {
  const [form, setForm] = useState<ConnectionProfile>(() => profile ? structuredClone(profile) : initialProfile ? { ...structuredClone(initialProfile), id: initialProfile.dialect === 'sqlite' && !initialProfile.id ? uid() : initialProfile.id } : { id: uid(), name: '', group: '', color: '#52c5a2', dialect: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', rememberPassword: true });
  const [section, setSection] = useState<'general' | 'ssh' | 'tls'>('general');
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [result, setResult] = useState('');
  const submitLock = useRef(false);
  const [uriDraft, setUriDraft] = useState<string | null>(null), uriDraftRef = useRef<string | null>(null);
  /** URI仅在当前对话框内存保留，取消和成功填入立即清除。 */
  function changeUri(value: string | null) { uriDraftRef.current = value; setUriDraft(value); }
  /** 先完整解析再替换新连接配置；未知参数、失败及忙态均保留原表单。 */
  function applyUri() {
    if (submitLock.current || profile || form.dialect === 'sqlite' || uriDraftRef.current === null) return;
    try { const next = connectionProfileFromUri(form, uriDraftRef.current); setForm(next); changeUri(null); setSection('general'); setError(''); setResult(connectionUriZh.applied); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  const [allowIncomplete, setAllowIncomplete] = useState(false); const pendingFiles = form.pendingFiles ?? [];
  const hasOpenTabs = useWorkspace(state => !!profile && state.settings.tabs.some(tab => tab.connectionId === profile.id));
  /** 表单合并保留未编辑字段；秘密的 undefined 与空字符串语义不做归一化。 */
  const update = (patch: Partial<ConnectionProfile>) => setForm(previous => ({ ...previous, ...patch }) as ConnectionProfile);
  const ssh = (form.dialect !== 'sqlite' ? form.ssh : undefined) ?? { enabled: false, host: '', port: 22, user: '' };
  const tls = (form.dialect !== 'sqlite' ? form.tls : undefined) ?? { enabled: false, rejectUnauthorized: true };
  /** 只更新 SSH 子配置，保留身份验证和指纹等其余字段。 */
  const setSsh = (patch: Partial<NonNullable<NetworkConnectionProfile['ssh']>>) => update({ ssh: { ...ssh, ...patch } });
  /** 只更新 TLS 子配置，证书路径仍由文件选择器提供。 */
  const setTls = (patch: Partial<NonNullable<NetworkConnectionProfile['tls']>>) => update({ tls: { ...tls, ...patch } });
  /** 私钥与证书通过主进程的文件选择器获取，界面不读取文件内容。 */
  async function pick(purpose: 'key' | 'certificate', setter: (path: string) => void) {
    if (submitLock.current) return; submitLock.current = true; setBusy('file');
    try { const file = await invoke('files.choose', { purpose }); if (file) setter(await invoke('files.path', { token: file.token })); } catch (reason) { setError(errorMessage(reason)); }
    finally { submitLock.current = false; setBusy(''); }
  }
  /** 新连接切换方言时重建完整变体，避免网络凭据残留在文件连接中。 */
  function switchDialect(dialect: ConnectionProfile['dialect']) {
    if (submitLock.current || dialect === form.dialect) return;
    // 已有网络连接仅切换兼容方言，原地址、凭据与传输配置全部保留。
    if (profile) {
      if (profile.dialect === 'sqlite' || form.dialect === 'sqlite' || dialect === 'sqlite') return;
      setForm({ ...form, dialect }); setError(''); setResult(''); return;
    }
    const common = { id: form.id, name: form.name, group: form.group, color: form.color };
    setForm(dialect === 'sqlite' ? { ...common, dialect, sqlite: { readOnly: true, busyTimeoutMs: 1000 } }
      : { ...common, dialect, host: '127.0.0.1', port: 3306, user: 'root', rememberPassword: true });
    changeUri(null); setSection('general'); setError(''); setResult('');
  }
  /** 文件连接只保留用途令牌和文件名，不向主进程索取本机路径。 */
  async function pickSqlite() {
    if (submitLock.current || form.dialect !== 'sqlite') return;
    submitLock.current = true; setBusy('file'); setError('');
    try {
      const file = await invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: form.id });
      if (file) setForm(current => current.dialect === 'sqlite' ? { ...current, sqlite: { ...current.sqlite, filePath: undefined, fileToken: file.token, fileName: file.name }, pendingFiles: current.pendingFiles?.filter(kind => kind !== 'sqliteDatabase') } : current);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { submitLock.current = false; setBusy(''); }
  }
  /** 测试连接不会写入配置，保存成功后刷新连接列表再关闭表单。 */
  async function submit(test: boolean) {
    if (submitLock.current || uriDraftRef.current !== null) return; submitLock.current = true;
    setError(''); setResult(''); setBusy(test ? 'test' : 'save');
    try {
      if (form.dialect !== 'sqlite') { assertTlsPassphrase(form.tls?.passphrase); if (!form.host.trim() || !form.user.trim()) throw new Error(zh.connections.text001); }
      else if (!form.sqlite.filePath && !form.sqlite.fileToken && (!pendingFiles.length || test || !allowIncomplete)) throw new Error(sqliteZh.required);
      const next = { ...form, name: form.name.trim() || (form.dialect === 'sqlite' ? form.sqlite.fileName || sqliteFileName(form.sqlite.filePath) : form.host) };
      if (!test && pendingFiles.length && !allowIncomplete) throw new Error(connectionsTransferZh.staged);
      // 新选文件由 Main 解析用途令牌并验证；renderer 不取得路径，也不把令牌误判为缺文件。
      if (test && (form.dialect !== 'sqlite' || !form.sqlite.fileToken)) assertConnectionReady(form);
      if (test) { const status = await invoke('connections.test', next); setResult(formatText(zh.connections.text002, status.dialect === 'sqlite' ? 'SQLite' : status.dialect === 'mysql' ? 'MySQL' : 'MariaDB', status.version)); }
      else {
        // 保存瞬间读取最新标签；不能通过重连或关闭标签绕过保护，否则旧事务和表格草稿可能写往错误服务器。
        await saveConnectionUpdate(profile, next, useWorkspace.getState().settings.tabs, onTransportChanged);
        useWorkspace.getState().setConnections(await invoke('connections.list', {})); onClose();
      }
    } catch (reason) { setError(errorMessage(reason)); } finally { submitLock.current = false; setBusy(''); }
  }
  return <Modal title={profile ? zh.connections.text003 : zh.common.newConnection} onClose={() => { if (!submitLock.current) onClose(); }}><div className="dialog-tabs">{(form.dialect === 'sqlite' ? ['general'] as const : ['general', 'ssh', 'tls'] as const).map((key, index) => <button className={section === key ? 'selected' : ''} key={key} onClick={() => setSection(key)}>{[zh.connections.text004, zh.connections.text005, 'TLS / SSL'][index]}</button>)}</div><form onSubmit={event => { event.preventDefault(); void submit(false); }}><div className="modal-content">
    {initialProfile && <p className="info-strip">{connectionsTransferZh.copyHint}</p>}{pendingFiles.length > 0 && <><p className="warning-text">{connectionsTransferZh.pendingFiles}：{pendingFiles.map(kind => kind === 'sqliteDatabase' ? sqliteZh.file : kind === 'sshPrivateKey' ? zh.connections.text022 : kind === 'tlsCa' ? zh.connections.text029 : kind === 'tlsCert' ? zh.connections.text030 : zh.connections.text031).join('、')}</p><label className="check"><input type="checkbox" checked={allowIncomplete} onChange={event => setAllowIncomplete(event.target.checked)}/>{connectionsTransferZh.staged}</label></>}{hasOpenTabs && <p className="info-strip">{zh.connections.openTabsHint}</p>}
    {!profile && form.dialect !== 'sqlite' && <section aria-label={connectionUriZh.open}>
      {uriDraft === null ? <button type="button" disabled={!!busy} onClick={() => { if (submitLock.current) return; setError(''); setResult(''); changeUri(''); }}>{connectionUriZh.open}</button> : <><UsageHelp><p>{connectionUriZh.hint}</p></UsageHelp><Field label={connectionUriZh.title} full><input type="password" autoComplete="new-password" spellCheck={false} maxLength={connectionUriLimits.units} value={uriDraft} placeholder={connectionUriZh.placeholder} disabled={!!busy} onChange={event => changeUri(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}/></Field><div className="connection-uri-actions"><button type="button" disabled={!!busy} onClick={applyUri}>{connectionUriZh.apply}</button><button type="button" disabled={!!busy} onClick={() => { changeUri(null); setError(''); }}>{connectionUriZh.cancel}</button></div></>}
    </section>}
    {section === 'general' && <div className="form-grid"><Field label={zh.connections.text006}><input value={form.name} placeholder={zh.connections.text007} onChange={event => update({ name: event.target.value })}/></Field><Field label={zh.connections.text008}><select value={form.dialect} disabled={profile?.dialect === 'sqlite' || !!busy} onChange={event => switchDialect(event.target.value as ConnectionProfile['dialect'])}><option value="mysql">MySQL</option><option value="mariadb">MariaDB</option><option value="sqlite" disabled={!!profile && profile.dialect !== 'sqlite'}>SQLite</option></select></Field>{form.dialect === 'sqlite' ? <><Field label={sqliteZh.file} full><div className="input-action"><input readOnly value={form.sqlite.fileName || form.sqlite.filePath || ''} placeholder={sqliteZh.noFile}/><button type="button" disabled={!!busy} onClick={() => void pickSqlite()} aria-label={sqliteZh.choose}><FolderOpen size={16}/></button></div><small className="muted small">{sqliteZh.hint}</small></Field><label className="check"><input type="checkbox" checked={form.sqlite.readOnly} onChange={event => { if (form.dialect === 'sqlite') update({ sqlite: { ...form.sqlite, readOnly: event.target.checked } }); }}/>{sqliteZh.readOnly}</label><Field label={sqliteZh.busyTimeout}><input type="number" min="0" max="5000" value={form.sqlite.busyTimeoutMs} onChange={event => { if (form.dialect === 'sqlite') update({ sqlite: { ...form.sqlite, busyTimeoutMs: Number(event.target.value) } }); }}/></Field></> : <><Field label={zh.connections.text009}><input required value={form.host} onChange={event => update({ host: event.target.value })}/></Field><Field label={zh.connections.text010}><input type="number" min="1" max="65535" value={form.port} onChange={event => update({ port: Number(event.target.value) })}/></Field><Field label={zh.common.user}><input required value={form.user} autoComplete="off" onChange={event => update({ user: event.target.value })}/></Field><Field label={zh.common.password}><SecretInput label={zh.connections.text011} value={form.password} hasSaved={form.hasPassword} onChange={password => update({ password })}/></Field><Field label={zh.connections.text012}><input value={form.database ?? ''} onChange={event => update({ database: event.target.value || undefined })}/></Field></>}<Field label={zh.connections.text013}><input value={form.group} placeholder={zh.connections.text014} onChange={event => update({ group: event.target.value })}/></Field><Field label={zh.connections.text015}><input type="color" value={form.color} onChange={event => update({ color: event.target.value })}/></Field>{form.dialect !== 'sqlite' && <label className="check"><input type="checkbox" checked={form.rememberPassword} onChange={event => update({ rememberPassword: event.target.checked })}/>{zh.connections.text016}</label>}</div>}
    {form.dialect !== 'sqlite' && section === 'ssh' && <><label className="check section-check"><input type="checkbox" checked={ssh.enabled} onChange={event => setSsh({ enabled: event.target.checked })}/>{zh.connections.text017}</label><fieldset disabled={!ssh.enabled} className="form-grid"><Field label={zh.connections.text018}><input value={ssh.host} onChange={event => setSsh({ host: event.target.value })}/></Field><Field label={zh.connections.text019}><input type="number" value={ssh.port} onChange={event => setSsh({ port: Number(event.target.value) })}/></Field><Field label={zh.connections.text020}><input value={ssh.user} onChange={event => setSsh({ user: event.target.value })}/></Field><Field label={zh.connections.text021}><SecretInput label={zh.connections.text021} value={ssh.password} hasSaved={ssh.hasPassword} onChange={password => setSsh({ password })}/></Field><Field label={zh.connections.text022} full><div className="input-action"><input value={ssh.privateKeyPath ?? ''} onChange={event => setSsh({ privateKeyPath: event.target.value })}/><button type="button" onClick={() => void pick('key', path => setForm(current => assignAuthorizedConnectionFile(current, 'sshPrivateKey', path)))} aria-label={zh.connections.text023}><FolderOpen size={16}/></button></div></Field><Field label={zh.connections.text024}><SecretInput label={zh.connections.text024} value={ssh.passphrase} hasSaved={ssh.hasPassphrase} onChange={passphrase => setSsh({ passphrase })}/></Field><Field label={zh.connections.text025}><input value={ssh.hostFingerprint ?? ''} placeholder="SHA256:…" onChange={event => setSsh({ hostFingerprint: event.target.value })}/></Field></fieldset><p className="muted small">{zh.connections.text026}</p></>}
    {form.dialect !== 'sqlite' && section === 'tls' && <><label className="check section-check"><input type="checkbox" checked={tls.enabled} onChange={event => setTls({ enabled: event.target.checked })}/>{zh.connections.text027}</label><fieldset disabled={!tls.enabled} className="form-grid"><label className="check full"><input type="checkbox" checked={tls.rejectUnauthorized} onChange={event => setTls({ rejectUnauthorized: event.target.checked })}/>{zh.connections.text028}</label>{([['caPath', zh.connections.text029], ['certPath', zh.connections.text030], ['keyPath', zh.connections.text031]] as const).map(([key, label]) => <Field key={key} label={label} full><div className="input-action"><input value={tls[key] ?? ''} onChange={event => setTls({ [key]: event.target.value })}/><button type="button" aria-label={formatText(zh.connections.text032, label)} onClick={() => void pick(key === 'keyPath' ? 'key' : 'certificate', path => setForm(current => assignAuthorizedConnectionFile(current, key === 'caPath' ? 'tlsCa' : key === 'certPath' ? 'tlsCert' : 'tlsKey', path)))}><FolderOpen size={16}/></button></div></Field>)}<Field label={tlsCredentialsZh.passphrase} full><SecretInput label={tlsCredentialsZh.passphrase} value={tls.passphrase} hasSaved={tls.hasPassphrase} maxLength={tlsPassphraseMaxLength} onChange={passphrase => setTls({ passphrase })}/><small className="muted small">{tlsCredentialsZh.hint}</small></Field></fieldset></>}
    {!!profile?.pendingFiles?.length && <p className="muted small">{connectionsTransferZh.saveBeforeTest}</p>}<ErrorBox message={error}/>{result && <div className="success-box"><ShieldCheck size={16}/>{result}</div>}
    </div><footer className="modal-footer"><button type="button" disabled={!!busy || uriDraft !== null} onClick={() => void submit(true)}>{busy === 'test' ? <Spinner text={zh.connections.text033}/> : <><PlugZap size={15}/>{zh.connections.text034}</>}</button><span className="grow"/><button type="button" disabled={!!busy} onClick={onClose}>{zh.common.cancel}</button><button type="submit" className="primary" disabled={!!busy || uriDraft !== null}>{busy === 'save' ? zh.connections.text035 : zh.connections.text036}</button></footer></form></Modal>;
}

/** 未编辑的 undefined 保留旧秘密，显式清除传空字符串，保存前始终展示清除状态。 */
function SecretInput({ label, value, hasSaved, maxLength, onChange }: { label: string; value: string | undefined; hasSaved?: boolean; maxLength?: number; onChange: (value: string | undefined) => void }) {
  return <><div className="input-action"><input aria-label={label} type="password" autoComplete="new-password" maxLength={maxLength} value={value ?? ''} placeholder={value === '' ? zh.connections.text037 : hasSaved ? zh.connections.text038 : ''} onChange={event => onChange(event.target.value)}/><button type="button" aria-label={formatText(zh.connections.text039, label)} onClick={() => onChange('')}>{zh.common.clear}</button>{value !== undefined && hasSaved && <button type="button" aria-label={formatText(zh.connections.text040, label)} onClick={() => onChange(undefined)}>{zh.connections.text041}</button>}</div><small className={value === '' ? 'secret-hint warning-text' : 'secret-hint muted'}>{value === '' ? zh.connections.text042 : hasSaved ? zh.connections.text043 : zh.connections.text044}</small></>;
}
