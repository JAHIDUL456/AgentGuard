import { Finding, FindingCategory, FindingSeverity } from '../core/types';

export interface FindingFilter {
  readonly categories?: readonly FindingCategory[];
  readonly severities?: readonly FindingSeverity[];
  readonly filePath?: string;
}

export interface FindingStats {
  readonly total: number;
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  readonly byCategory: Readonly<Record<FindingCategory, number>>;
}

export interface IFindingManager {
  readonly onDidChangeFindings: (listener: (findings: readonly Finding[]) => unknown) => unknown;
  setFindings(sourceEngine: string, findings: readonly Finding[]): void;
  clear(): void;
  clearByEngine(engineId: string): void;
  getAll(): readonly Finding[];
  filter(filter: FindingFilter): readonly Finding[];
  getStats(): FindingStats;
}

