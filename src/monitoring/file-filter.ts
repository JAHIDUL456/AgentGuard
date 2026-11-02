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

export const IGNORED_FILE_EXTENSIONS = new Set([
  '.min.js',
  '.min.css',
  '.map',
  '.snap',
  '.lock',
]);

export const IGNORED_LOCK_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'flake.lock',
]);

export const MAX_ANALYSIS_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB limit

const REPORT_FILE_PATTERNS = [
  /^agentguard[-_]report.*\.(md|tmp)$/i,
  /^agentguard[-_]safety[-_]report.*\.(md|tmp)$/i,
  /^\.?agentguard[-_]report.*\.(md|tmp)$/i,
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
   * - Ignores AgentGuard self-generated reports and caches to prevent feedback loops.
   * - Does NOT ignore .vscode folder contents (e.g. settings.json, tasks.json).
   */
  public static shouldIgnore(filePath: string): boolean {
    const normalized = this.normalizePath(filePath);
    const baseName = path.basename(normalized);

    // Fast check for lock files
    if (IGNORED_LOCK_FILES.has(baseName)) {
      return true;
    }

    // Fast check for minified/sourcemap extensions
    for (const ext of IGNORED_FILE_EXTENSIONS) {
      if (baseName.endsWith(ext)) {
        return true;
      }
    }

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
   * Checks whether a file exceeds the maximum safe analysis file size (default: 2MB).
   */
  public static isFileSizeExceeded(
    sizeInBytes: number,
    limitBytes: number = MAX_ANALYSIS_FILE_SIZE_BYTES
  ): boolean {
    return sizeInBytes > limitBytes;
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
