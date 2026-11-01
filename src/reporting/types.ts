export interface ReportLanguageInfo {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly levelName: string;
  readonly extensions: readonly string[];
}

export interface ReportWorkspaceFolder {
  readonly name: string;
  readonly path: string;
}

export interface ReportOptions {
  readonly includeStats?: boolean;
  readonly workspaceName?: string;
  readonly workspaceRoots?: readonly ReportWorkspaceFolder[];
  readonly generatedAt?: Date;
  readonly languages?: readonly ReportLanguageInfo[];
  readonly gitInfo?: {
    readonly available: boolean;
    readonly repoCount: number;
  };
  readonly engines?: readonly string[];
}
