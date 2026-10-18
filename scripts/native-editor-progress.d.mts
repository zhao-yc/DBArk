export type NativeProgressStage = 'scan.begin' | 'scan.done' | 'launch.begin' | 'launch.returned' | 'prepare.hook' | 'prepare.window' | 'prepare.statusbar' | 'prepare.metrics' | 'prepare.done' | 'close.source' | 'close.request' | 'close.handshake' | 'close.application' | 'close.event' | 'close.pids' | 'close.done';
export interface NativeProgressState { owners: number; registeredPids: number; pids: number[]; confirmedOwners: number; readyOwners: number; closedOwners: number; retained: boolean; removed: boolean; }
export interface NativeProgressOptions { manifestPath: string; manifestSha256: string; headerSha256?: string; enabled?: boolean; listing?: boolean; guard: () => void; }
export interface NativeProgressWriter { record(stage: NativeProgressStage, state: NativeProgressState): void; }
export const nativeProgressStages: readonly NativeProgressStage[];
export function prepareNativeProgress(options: Omit<NativeProgressOptions, 'guard'> & { guard?: () => void }, io?: unknown): Readonly<{ sha256: string }>;
export function openNativeProgress(options: NativeProgressOptions, io?: unknown): NativeProgressWriter | undefined;
