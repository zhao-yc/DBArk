const prefix = 'postgres-preset:';

/** 标签设置只保存方案编号和独立标签编号，筛选值仍在本机方案库。 */
export function postgresPresetTabId(presetId: string, nonce: string): string {
  return `${prefix}${presetId}:${nonce}`;
}

export function isPostgresPresetTabId(id: string | undefined): boolean { return !!id?.startsWith(prefix); }

export function postgresPresetIdFromTab(id: string | undefined): string | undefined {
  if (!id || !isPostgresPresetTabId(id)) return;
  const pair = id.slice(prefix.length).split(':');
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return pair.length === 2 && pair.every(part => uuid.test(part)) ? pair[0] : undefined;
}
