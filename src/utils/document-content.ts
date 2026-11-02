import * as fs from 'fs';
import * as vscode from 'vscode';

/**
 * Universal content reader that prioritizes in-memory unsaved documents in VS Code.
 * When a developer is typing in an active editor, this reads the live editor text.
 * Falls back to reading from disk for closed or untouched files.
 */
export class DocumentContentReader {
  /**
   * Retrieves the live in-memory text if the document is open in VS Code.
   */
  public static getOpenDocumentText(uri: vscode.Uri): string | undefined {
    if (typeof vscode.workspace?.textDocuments !== 'undefined' && Array.isArray(vscode.workspace.textDocuments)) {
      const openDoc = vscode.workspace.textDocuments.find(
        d => d.uri.toString() === uri.toString() || d.uri.fsPath === uri.fsPath
      );
      if (openDoc) {
        return openDoc.getText();
      }
    }
    return undefined;
  }

  /**
   * Reads content for analysis, prioritizing live in-memory text over saved disk content.
   */
  public static async readContent(uri: vscode.Uri): Promise<string> {
    const memoryText = this.getOpenDocumentText(uri);
    if (memoryText !== undefined) {
      return memoryText;
    }
    return await fs.promises.readFile(uri.fsPath, 'utf8');
  }

  /**
   * Synchronous version for testing or fast AST parsing where async is unavailable.
   */
  public static readContentSync(uri: vscode.Uri): string {
    const memoryText = this.getOpenDocumentText(uri);
    if (memoryText !== undefined) {
      return memoryText;
    }
    return fs.readFileSync(uri.fsPath, 'utf8');
  }
}

