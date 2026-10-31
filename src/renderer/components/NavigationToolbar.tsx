import type { ReactNode } from 'react';
import { Activity, Blocks, Database, FileCode2, FolderOpen, Search, Table2, Wrench, Workflow } from 'lucide-react';
import type { UiCommandId } from '../../shared/uiCommands';
import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';
import type { ObjectCategory } from '../../shared/objectBrowser';
import { useUiCommands, uiCommands } from '../uiCommands';
import { navigationZh as text } from '../locales/navigation.zh-CN';
import { ActionMenu, ActionMenuSection } from './ActionMenu';
import { AdaptiveToolbar } from './AdaptiveToolbar';

/** 模块工具栏只组织既有命令；对象类别独立使用树上下文，页面命令由当前标签注册。 */
export function NavigationToolbar({ onBrowse, onQueries, onHistory, objectTarget, connectionsAvailable, runningCount, sqliteObjects = false }: {
  onBrowse(category: ObjectCategory): void; onQueries(): void; onHistory(): void; objectTarget: string; connectionsAvailable: boolean; runningCount: number; sqliteObjects?: boolean;
}) {
  const commands = useUiCommands(), revision = commands.snapshot.revision;
  const current = () => uiCommands.getSnapshot().revision === revision;
  const command = (id: UiCommandId) => <button key={id} disabled={!commands.enabled(id)} aria-pressed={id === 'focus-mode' || id === 'editor-word-wrap' ? commands.checked(id) : undefined} onClick={() => commands.run(id)}>{uiCommandLabels[id]}</button>;
  const connectionActions = <>{command('new-connection')}{command('connections-organize')}{command('connections-transfer')}</>;
  const otherActions = <>{(['trigger', 'event'] as const).filter(kind => !sqliteObjects || kind === 'trigger').map(kind => <button key={kind} disabled={!connectionsAvailable} onClick={() => onBrowse(kind)}>{text.categories[kind]}</button>)}</>;
  const queryActions = <><button onClick={onQueries}>{text.savedQueries}</button><button onClick={onHistory}>{text.queryHistory}</button>{command('new-query')}</>;
  const toolActions = <><ActionMenuSection label="数据库工具">{command('schema-compare')}{command('server-monitor')}{command('structure-search')}</ActionMenuSection>
    <ActionMenuSection label="离线快照">{command('explain-snapshot')}{command('result-snapshot')}</ActionMenuSection>
    <ActionMenuSection label="编辑器">{command('editor-font')}{command('editor-word-wrap')}{command('editor-indent')}</ActionMenuSection>
    <ActionMenuSection label="工作区">{command('task-center')}{command('favorites-manage')}{command('tab-search')}{command('focus-mode')}</ActionMenuSection></>;
  const browse = (category: ObjectCategory, label: string, icon: ReactNode) => <button className="module-button" disabled={!connectionsAvailable} onClick={() => onBrowse(category)}>{icon}<span>{label}</span></button>;
  return <div className="navigation-toolbar" aria-label={text.toolbar}>
    <AdaptiveToolbar ariaLabel={text.toolbar} contextKey={String(revision)} isCurrent={current} items={[
      { key: 'connection', content: <ActionMenu className="module-menu" label={text.connection} icon={<Database/>} contextKey={String(revision)} isCurrent={current}>{connectionActions}</ActionMenu>, overflow: <ActionMenuSection label={text.connection}>{connectionActions}</ActionMenuSection> },
      { key: 'new-query', content: <button className="module-button" disabled={!commands.enabled('new-query')} onClick={() => commands.run('new-query')}><FileCode2/><span>{uiCommandLabels['new-query']}</span></button> },
      { key: 'table', content: browse('table', text.table, <Table2/>) },
      { key: 'view', content: browse('view', text.view, <Blocks/>) },
      ...(sqliteObjects ? [] : [{ key: 'routine', content: browse('routine', text.routine, <Workflow/>) }]),
      { key: 'other', content: <ActionMenu className="module-menu" label={text.other} icon={<FolderOpen/>} contextKey={String(revision)} isCurrent={current}>{otherActions}</ActionMenu>, overflow: <ActionMenuSection label={text.other}>{otherActions}</ActionMenuSection> },
      { key: 'query', content: <ActionMenu className="module-menu" label={text.query} icon={<FileCode2/>} contextKey={String(revision)} isCurrent={current}>{queryActions}</ActionMenu>, overflow: <ActionMenuSection label={text.query}>{queryActions}</ActionMenuSection> },
      { key: 'tools', content: <ActionMenu className="module-menu" label={text.tools} icon={<Wrench/>} contextKey={String(revision)} isCurrent={current}>{toolActions}</ActionMenu>, overflow: toolActions }
    ]} more={<><ActionMenuSection label="收藏夹">{command('favorite-toggle')}{command('favorites-manage')}{command('object-link')}</ActionMenuSection><ActionMenuSection label="帮助">{command('help')}{command('shortcuts')}{command('about')}</ActionMenuSection></>}/>
    <span className="navigation-context" title={`${text.context}：${objectTarget}`}>{objectTarget}</span>
    <div className="navigation-utilities"><button className="icon-button" aria-label={uiCommandLabels['structure-search']} title={uiCommandLabels['structure-search']} disabled={!commands.enabled('structure-search')} onClick={() => commands.run('structure-search')}><Search size={17}/></button>
      <button className="icon-button" aria-label={uiCommandLabels['task-center']} title={uiCommandLabels['task-center']} disabled={!commands.enabled('task-center')} onClick={() => commands.run('task-center')}><Activity size={17}/>{runningCount > 0 && <span className="count">{runningCount}</span>}</button></div>
  </div>;
}
