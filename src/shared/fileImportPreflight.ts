import type { CsvImportDelimiter } from './csvImport';

export interface FileImportPreflightInput {
  connectionId: string; database: string; table: string; fileToken: string;
  format: 'csv' | 'json'; encoding: 'utf8' | 'utf16le' | 'gb18030';
  csvDelimiter?: CsvImportDelimiter; csvHasHeader?: boolean;
  /** 新表导入绑定最初完整扫描的原字节，样本及映射不能替代该指纹。 */
  expectedSource?: import('./importNewTable').ImportFileSource;
  mapping: Record<string, string>; taskId: string;
}
export interface FileImportPreflightIssue {
  record?: number; source?: string; target?: string;
  code: 'missing-source' | 'invalid-value' | 'parse-error' | 'source-changed' | 'schema-changed';
  message: string;
}
export interface FileImportPreflightReport {
  taskId: string; target: { connectionId: string; database: string; table: string };
  format: 'csv' | 'json'; encoding: FileImportPreflightInput['encoding'];
  checkedRecords: number; validRecords: number; invalidRecords: number; issueCount: number;
  issues: FileImportPreflightIssue[]; truncated: boolean; complete: boolean;
  termination: 'complete' | 'parse-error' | 'source-changed' | 'schema-changed';
  sourceFingerprint: string | null; sourceBytes: number; schemaFingerprint: string; warnings: string[];
}
export const fileImportPreflightIssueLimit = 200;
export interface FileImportPreflightProgress { checkedRecords: number; validRecords: number; invalidRecords: number; issueCount: number; sourceBytes: number; }
