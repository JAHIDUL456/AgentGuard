import * as path from 'path';

export const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'target',
  'bin',
  'obj',
  '.vscode-test',
  '.agentguard',
]);

const REPORT_FILE_PATTERNS = [
  /^agentguard[-_]report.*\.md$/i,
  /^agentguard[-_]safety[-_]report.*\.md$/i,
  /^\.agentguard.*$/i,
];

export class FileFilter {
  /**
   * Normalizes path separators to standard forward slashes.
   */
  public static normalizePath(filePath: string): string {
    return path.normalize(filePath).replace(/\\/g, '/');
  }

  /**
   * Determines whether a given file path should be ignored by monitoring.
   *
   * Rules:
   * - Ignores standard build, cache, dependency directories.
   * - Ignores AgentGuard self-generated reports to prevent feedback loops.
   * - Does NOT ignore .vscode folder contents (e.g. settings.json, tasks.json).
   */
  public static shouldIgnore(filePath: string): boolean {
    const normalized = this.normalizePath(filePath);
    const segments = normalized.split('/').filter(Boolean);

    for (const segment of segments) {
      if (IGNORED_DIRECTORY_NAMES.has(segment)) {
        return true;
      }
      for (const pattern of REPORT_FILE_PATTERNS) {
        if (pattern.test(segment)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Specifically checks whether a file is an AgentGuard report file or directory.
   */
  public static isAgentGuardReport(filePath: string): boolean {
    const normalized = this.normalizePath(filePath);
    const segments = normalized.split('/').filter(Boolean);
    return segments.some(seg => REPORT_FILE_PATTERNS.some(p => p.test(seg)));
  }
}
