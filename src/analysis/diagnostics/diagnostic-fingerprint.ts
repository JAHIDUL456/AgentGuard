import * as path from 'path';
import * as vscode from 'vscode';
import { DiagnosticClassification, DiagnosticFingerprint } from './diagnostic-types';

/**
 * Normalizes a diagnostic message to make it resilient against
 * environment-dependent paths, absolute paths, and shifting line/col numbers.
 */
export function normalizeDiagnosticMessage(message: string): string {
  if (!message) {
    return '';
  }

  let normalized = message.trim();

  // Normalize Windows backslashes in paths
  normalized = normalized.replace(/\\/g, '/');

  // Strip dynamic line/col mentions often appended by compilers: e.g., "(line 12, col 4)", ":12:4:", "at line 12"
  normalized = normalized.replace(/\(line \d+, (?:col|column) \d+\)/gi, '');
  normalized = normalized.replace(/:\d+:\d+:/g, '');
  normalized = normalized.replace(/at line \d+/gi, '');

  // Strip dynamic memory addresses or object ids: e.g., 0x7fff5fbff8c0
  normalized = normalized.replace(/0x[0-9a-fA-F]+/g, '0x...');

  // Collapse multiple whitespaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Extracts a normalized string code from a VS Code diagnostic code property.
 */
export function extractDiagnosticCode(
  code: string | number | { value: string | number; target: vscode.Uri } | undefined
): string {
  if (code === undefined || code === null) {
    return '';
  }
  if (typeof code === 'object') {
    return String(code.value ?? '');
  }
  return String(code);
}

/**
 * Creates a deterministic diagnostic fingerprint.
 */
export function createDiagnosticFingerprint(
  uri: vscode.Uri,
  diag: vscode.Diagnostic,
  workspaceRootUri?: vscode.Uri
): DiagnosticFingerprint {
  let relativeFilePath = uri.fsPath;
  if (workspaceRootUri) {
    try {
      relativeFilePath = path.relative(workspaceRootUri.fsPath, uri.fsPath).replace(/\\/g, '/');
    } catch {
      relativeFilePath = uri.fsPath.replace(/\\/g, '/');
    }
  } else {
    relativeFilePath = uri.path.replace(/\\/g, '/');
  }

  const source = (diag.source || 'compiler').trim();
  const code = extractDiagnosticCode(diag.code);
  const normalizedMessage = normalizeDiagnosticMessage(diag.message);

  // Primary structural key: independent of line number so line shifts do not break identity
  const primaryKey = `${relativeFilePath}::${source}::${code}::${normalizedMessage}`;

  // Unique instance ID incorporating line & character for instance-level tracking
  const id = `${primaryKey}::${diag.range.start.line}:${diag.range.start.character}`;

  const related = diag.relatedInformation
    ? diag.relatedInformation.map(r => ({
        message: r.message,
        uri: r.location.uri,
        range: r.location.range,
      }))
    : undefined;

  return {
    id,
    primaryKey,
    fileUri: uri,
    relativeFilePath,
    source,
    code,
    severity: diag.severity,
    message: diag.message,
    normalizedMessage,
    range: diag.range,
    line: diag.range.start.line,
    character: diag.range.start.character,
    relatedInformation: related,
  };
}

export interface ClassifiedGroup {
  readonly classification: DiagnosticClassification;
  readonly fingerprint: DiagnosticFingerprint;
  readonly matchedBaseline?: DiagnosticFingerprint;
}

/**
 * Compares current diagnostics against baseline diagnostics for a set of files,
 * using shifted-range and primary-key correlation.
 */
export function correlateDiagnostics(
  baselineFingerprints: readonly DiagnosticFingerprint[],
  currentFingerprints: readonly DiagnosticFingerprint[],
  isBaselineReady: boolean
): ClassifiedGroup[] {
  if (!isBaselineReady) {
    // If baseline is not ready, classify all current diagnostics as uncertain
    return currentFingerprints.map(fp => ({
      classification: 'uncertain' as DiagnosticClassification,
      fingerprint: fp,
    }));
  }

  const results: ClassifiedGroup[] = [];

  // Group by file relative path
  const baselineByFile = new Map<string, DiagnosticFingerprint[]>();
  for (const b of baselineFingerprints) {
    const list = baselineByFile.get(b.relativeFilePath) ?? [];
    list.push(b);
    baselineByFile.set(b.relativeFilePath, list);
  }

  const currentByFile = new Map<string, DiagnosticFingerprint[]>();
  for (const c of currentFingerprints) {
    const list = currentByFile.get(c.relativeFilePath) ?? [];
    list.push(c);
    currentByFile.set(c.relativeFilePath, list);
  }

  const allFileKeys = new Set([...baselineByFile.keys(), ...currentByFile.keys()]);

  for (const fileKey of allFileKeys) {
    const bFile = baselineByFile.get(fileKey) ?? [];
    const cFile = currentByFile.get(fileKey) ?? [];

    // Group by primaryKey within this file
    const bByPrimary = new Map<string, DiagnosticFingerprint[]>();
    for (const b of bFile) {
      const list = bByPrimary.get(b.primaryKey) ?? [];
      list.push(b);
      bByPrimary.set(b.primaryKey, list);
    }

    const cByPrimary = new Map<string, DiagnosticFingerprint[]>();
    for (const c of cFile) {
      const list = cByPrimary.get(c.primaryKey) ?? [];
      list.push(c);
      cByPrimary.set(c.primaryKey, list);
    }

    const allPrimaryKeys = new Set([...bByPrimary.keys(), ...cByPrimary.keys()]);

    const unmatchedCurrent: DiagnosticFingerprint[] = [];
    const unmatchedBaseline: DiagnosticFingerprint[] = [];

    for (const pKey of allPrimaryKeys) {
      const bItems = bByPrimary.get(pKey) ?? [];
      const cItems = cByPrimary.get(pKey) ?? [];

      if (bItems.length === 0) {
        unmatchedCurrent.push(...cItems);
        continue;
      }
      if (cItems.length === 0) {
        unmatchedBaseline.push(...bItems);
        continue;
      }

      // Greedily pair baseline and current by minimum line distance
      const remainingBaseline = [...bItems];
      const remainingCurrent = [...cItems];

      // Sort both by line
      remainingBaseline.sort((a, b) => a.line - b.line);
      remainingCurrent.sort((a, b) => a.line - b.line);

      while (remainingBaseline.length > 0 && remainingCurrent.length > 0) {
        let bestBIdx = 0;
        let bestCIdx = 0;
        let minDiff = Infinity;

        for (let bi = 0; bi < remainingBaseline.length; bi++) {
          const b = remainingBaseline[bi];
          if (!b) {
            continue;
          }
          for (let ci = 0; ci < remainingCurrent.length; ci++) {
            const c = remainingCurrent[ci];
            if (!c) {
              continue;
            }
            const diff = Math.abs(b.line - c.line);
            if (diff < minDiff) {
              minDiff = diff;
              bestBIdx = bi;
              bestCIdx = ci;
            }
          }
        }

        const matchedB = remainingBaseline.splice(bestBIdx, 1)[0];
        const matchedC = remainingCurrent.splice(bestCIdx, 1)[0];

        if (matchedB && matchedC) {
          results.push({
            classification: 'existing',
            fingerprint: matchedC,
            matchedBaseline: matchedB,
          });
        }
      }

      // Any remaining in current with this primary key are NEW instances
      for (const extraCurrent of remainingCurrent) {
        results.push({
          classification: 'confirmed-new-diagnostic',
          fingerprint: extraCurrent,
        });
      }

      // Any remaining in baseline with this primary key are RESOLVED
      for (const extraBaseline of remainingBaseline) {
        results.push({
          classification: 'resolved',
          fingerprint: extraBaseline,
        });
      }
    }

    // Now check unmatchedCurrent vs unmatchedBaseline for possible 'changed' diagnostics
    // (e.g. same line or near line, but code or message changed)
    const stillUnmatchedCurrent: DiagnosticFingerprint[] = [];
    const remainingUnmatchedBaseline = [...unmatchedBaseline];

    for (const c of unmatchedCurrent) {
      const matchIdx = remainingUnmatchedBaseline.findIndex(
        b => Math.abs(b.line - c.line) <= 2 && b.source === c.source
      );
      if (matchIdx >= 0) {
        const matchedB = remainingUnmatchedBaseline.splice(matchIdx, 1)[0];
        results.push({
          classification: 'changed',
          fingerprint: c,
          matchedBaseline: matchedB,
        });
      } else {
        stillUnmatchedCurrent.push(c);
      }
    }

    for (const c of stillUnmatchedCurrent) {
      results.push({
        classification: 'confirmed-new-diagnostic',
        fingerprint: c,
      });
    }

    for (const b of remainingUnmatchedBaseline) {
      results.push({
        classification: 'resolved',
        fingerprint: b,
      });
    }
  }

  return results;
}
