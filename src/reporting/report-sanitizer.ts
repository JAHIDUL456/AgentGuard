/**
 * Secret & Environment Sanitizer
 *
 * Ensures that no credentials, tokens, private keys, or sensitive
 * environment configurations leak into generated reports, logs, or handoffs.
 */

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  // AWS Access Key ID
  {
    name: 'AWS Access Key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_AWS_KEY]',
  },
  // AWS Secret Access Key (heuristics for 40 char base64-like strings near secret keyword)
  {
    name: 'AWS Secret Key',
    pattern: /(aws_secret_access_key\s*[:=]\s*['"])[A-Za-z0-9/+=]{40}(['"])/gi,
    replacement: '$1[REDACTED_AWS_SECRET]$2',
  },
  // GitHub Personal Access Token (classic and fine-grained)
  {
    name: 'GitHub Token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    name: 'GitHub Fine-grained PAT',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g,
    replacement: '[REDACTED_GITHUB_PAT]',
  },
  // Generic Private Keys (RSA, EC, DSA, OPENSSH, etc.)
  {
    name: 'Private Key',
    pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/gi,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  // JWT Tokens (3 base64url segments separated by dots)
  {
    name: 'JWT Token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\b/g,
    replacement: '[REDACTED_JWT_TOKEN]',
  },
  // Bearer Authorization Tokens
  {
    name: 'Bearer Token',
    pattern: /(Bearer\s+)[A-Za-z0-9._~+/-]{20,}/gi,
    replacement: '$1[REDACTED_BEARER_TOKEN]',
  },
  // Slack Tokens
  {
    name: 'Slack Token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,72}\b/gi,
    replacement: '[REDACTED_SLACK_TOKEN]',
  },
  // Common Secret / Password / API Key assignments
  {
    name: 'Password Assignment',
    pattern: /((?:password|passwd|secret|api[_-]?key|auth[_-]?token|private[_-]?token)\s*[:=]\s*['"])[^'"]{4,}(['"])/gi,
    replacement: '$1[REDACTED_CREDENTIAL]$2',
  },
  // Process.env secret assignments
  {
    name: 'Env Secret Assignment',
    pattern: /(process\.env\.(?:[A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD|PASS|AUTH)[A-Z0-9_]*)\s*[:=]\s*['"])[^'"]+(['"])/gi,
    replacement: '$1[REDACTED_ENV_SECRET]$2',
  },
];

export class SecretSanitizer {
  /**
   * Scans text and redacts any detected secrets, tokens, or credentials.
   */
  public static sanitize(text: string): string {
    if (!text || text.length === 0) {
      return '';
    }

    let sanitized = text;
    for (const { pattern, replacement } of SECRET_PATTERNS) {
      sanitized = sanitized.replace(pattern, replacement);
    }

    return sanitized;
  }

  /**
   * Sanitizes a file path so user home directories or raw system roots
   * are not exposed unnecessarily if a relative path can be constructed.
   */
  public static sanitizePath(filePath: string, workspaceRootPath?: string): string {
    if (!filePath) {
      return '';
    }

    if (workspaceRootPath && filePath.startsWith(workspaceRootPath)) {
      const rel = filePath.substring(workspaceRootPath.length).replace(/^[/\\]+/, '');
      return rel.replace(/\\/g, '/');
    }

    return filePath.replace(/\\/g, '/');
  }
}
