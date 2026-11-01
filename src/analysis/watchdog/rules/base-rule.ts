import * as ts from 'typescript';
import { RefactorTracker } from '../refactor-tracker';
import {
  CodeChangeContext,
  CodeLine,
  IWatchdogRule,
  WatchdogCategory,
  WatchdogFindingCandidate,
} from '../watchdog-types';

export abstract class BaseWatchdogRule implements IWatchdogRule {
  public abstract readonly id: string;
  public abstract readonly name: string;
  public abstract readonly category: WatchdogCategory;
  public abstract readonly supportedLanguages: readonly string[];

  public abstract inspect(
    context: CodeChangeContext
  ): Promise<readonly WatchdogFindingCandidate[]>;

  /**
   * Returns executable removed lines after stripping comments and pure logging statements.
   */
  protected getCleanRemovedLines(context: CodeChangeContext): readonly CodeLine[] {
    const cleanLines: CodeLine[] = [];

    for (const line of context.removedLines) {
      if (RefactorTracker.isCommentOnly(line.text)) {
        continue;
      }
      if (RefactorTracker.isLoggingOrStringOnly(line.text)) {
        continue;
      }

      const stripped = RefactorTracker.stripCommentsAndStrings(line.text);
      if (stripped.length > 0) {
        cleanLines.push(line);
      }
    }

    return cleanLines;
  }

  /**
   * Parses a TypeScript or JavaScript source string into a TypeScript AST SourceFile.
   */
  protected parseTsSource(content: string, fileName = 'source.ts'): ts.SourceFile {
    return ts.createSourceFile(
      fileName,
      content,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.tsx') || fileName.endsWith('.jsx')
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS
    );
  }
}

