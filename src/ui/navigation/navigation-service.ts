import * as vscode from 'vscode';
import { Finding, FindingLocation } from '../../core/types';

export class NavigationService {
  private static _decorationType: vscode.TextEditorDecorationType | undefined;

  private static getDecorationType(): vscode.TextEditorDecorationType {
    if (!this._decorationType) {
      this._decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid var(--vscode-editorError-foreground, #f14c4c)',
        borderRadius: '3px',
        isWholeLine: false,
      });
    }
    return this._decorationType;
  }

  /**
   * Opens the file associated with the finding, navigates to the exact source range,
   * highlights the entire identifier/expression, and centers the editor.
   */
  public static async openFinding(finding: Finding): Promise<vscode.TextEditor | undefined> {
    try {
      const uri = finding.location.uri;
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: false,
      });

      const range = this.resolveAccurateRange(doc, finding);
      if (range) {
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

        // Flash decoration to clearly communicate the finding location
        const decoration = this.getDecorationType();
        editor.setDecorations(decoration, [range]);
        setTimeout(() => {
          try {
            editor.setDecorations(decoration, []);
          } catch {
            // editor might be closed
          }
        }, 1800);
      }

      return editor;
    } catch (err) {
      vscode.window.showErrorMessage(
        `AgentGuard: Unable to open file ${finding.location.filePath}: ${err}`
      );
      return undefined;
    }
  }

  /**
   * Navigates to a related downstream location (e.g. untouched consumer file).
   */
  public static async openLocation(loc: FindingLocation): Promise<vscode.TextEditor | undefined> {
    try {
      const doc = await vscode.workspace.openTextDocument(loc.uri);
      const editor = await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: false,
      });

      if (loc.range) {
        const startLine = Math.min(Math.max(0, loc.range.start.line), Math.max(0, doc.lineCount - 1));
        const endLine = Math.min(Math.max(startLine, loc.range.end.line), Math.max(0, doc.lineCount - 1));
        const clampedRange = new vscode.Range(
          startLine,
          loc.range.start.character,
          endLine,
          loc.range.end.character
        );
        editor.selection = new vscode.Selection(clampedRange.start, clampedRange.end);
        editor.revealRange(clampedRange, vscode.TextEditorRevealType.InCenter);
      }
      return editor;
    } catch (err) {
      vscode.window.showErrorMessage(
        `AgentGuard: Unable to open location ${loc.filePath}: ${err}`
      );
      return undefined;
    }
  }

  /**
   * Resolves the exact range in the document, clamping to line bounds and ensuring
   * whole identifier tokens are matched without partial cuts.
   */
  public static resolveAccurateRange(
    doc: vscode.TextDocument,
    finding: Finding
  ): vscode.Range | undefined {
    const rawRange = finding.location.range;
    if (!rawRange) {
      return new vscode.Range(0, 0, 0, 0);
    }

    if (!doc || typeof doc.lineAt !== 'function' || !doc.lineCount) {
      return rawRange;
    }

    const startLine = Math.min(Math.max(0, rawRange.start.line), doc.lineCount - 1);
    const endLine = Math.min(Math.max(startLine, rawRange.end.line), doc.lineCount - 1);
    const lineText = doc.lineAt(startLine).text;

    // Check if the range already covers characters
    if (rawRange.end.character > rawRange.start.character) {
      const startChar = Math.min(rawRange.start.character, lineText.length);
      const endChar = Math.min(rawRange.end.character, lineText.length);
      return new vscode.Range(startLine, startChar, endLine, endChar);
    }

    // Attempt to extract target identifier from finding title or evidence
    const identifierMatch =
      finding.title.match(/'([^']+)'/) ||
      finding.title.match(/`([^`]+)`/) ||
      finding.title.match(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/);

    if (identifierMatch && identifierMatch[1]) {
      const symbol = identifierMatch[1];
      // Search target line first
      let charIdx = lineText.indexOf(symbol);
      if (charIdx !== -1) {
        return new vscode.Range(startLine, charIdx, startLine, charIdx + symbol.length);
      }

      // Search up to 5 lines above/below if line shifted
      const searchRadius = 5;
      for (let offset = 1; offset <= searchRadius; offset++) {
        const up = startLine - offset;
        if (up >= 0 && doc.lineAt(up).text.includes(symbol)) {
          const idx = doc.lineAt(up).text.indexOf(symbol);
          return new vscode.Range(up, idx, up, idx + symbol.length);
        }
        const down = startLine + offset;
        if (down < doc.lineCount && doc.lineAt(down).text.includes(symbol)) {
          const idx = doc.lineAt(down).text.indexOf(symbol);
          return new vscode.Range(down, idx, down, idx + symbol.length);
        }
      }
    }

    // Default to the full line or raw coordinates
    return new vscode.Range(
      startLine,
      0,
      startLine,
      Math.max(0, lineText.length)
    );
  }
}
