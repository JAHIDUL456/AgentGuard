import { CodeLine } from './watchdog-types';

export class RefactorTracker {
  /**
   * Checks if a line consists solely of comments or empty space.
   */
  public static isCommentOnly(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
      return true;
    }

    // Single-line comment starts
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('--') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.endsWith('*/')
    ) {
      return true;
    }

    // Python docstring or block comments
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      return true;
    }

    return false;
  }

  /**
   * Checks if the line is purely a logging or print call with a string.
   */
  public static isLoggingOrStringOnly(text: string): boolean {
    const trimmed = text.trim();
    // Common loggers: console.log, logger.info, print, fmt.Println, etc.
    const logPattern = /^(?:console\.(?:log|debug|info|warn|error)|logger\.(?:debug|info|warn|error)|print|logging\.(?:debug|info|warning|error)|fmt\.Print(?:ln|f)?|log\.Print(?:ln|f)?)\s*\([^)]*\);?$/;
    return logPattern.test(trimmed);
  }

  /**
   * Strips string literals and inline comments from a code line,
   * leaving only structural identifiers and punctuation.
   */
  public static stripCommentsAndStrings(text: string): string {
    let result = text;

    // Strip inline single-line comments // ... or # ...
    result = result.replace(/\/\/.*$/, '');
    result = result.replace(/(?<!['"])#.*$/, '');

    // Strip double-quoted strings
    result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');

    // Strip single-quoted strings
    result = result.replace(/'(?:[^'\\]|\\.)*'/g, "''");

    // Strip backtick template literals
    result = result.replace(/`(?:[^`\\]|\\.)*`/g, '``');

    return result.trim();
  }

  /**
   * Determines if a removed construct/pattern was simply moved elsewhere in the file.
   */
  public static isLogicPreserved(
    cleanRemovedPattern: string,
    newContent: string
  ): boolean {
    if (!cleanRemovedPattern || cleanRemovedPattern.length < 5) {
      return false;
    }

    // Normalize whitespace for fuzzy comparison
    const normalizedRemoved = cleanRemovedPattern.replace(/\s+/g, ' ').trim();
    const normalizedNew = newContent.replace(/\s+/g, ' ');

    return normalizedNew.includes(normalizedRemoved);
  }

  /**
   * Checks if an identifier was replaced by a renamed equivalent in the added lines.
   */
  public static isEquivalentReplacementPresent(
    oldSymbol: string,
    addedLines: readonly CodeLine[],
    equivalentSymbols: readonly string[]
  ): boolean {
    for (const added of addedLines) {
      for (const eq of equivalentSymbols) {
        if (added.text.includes(eq)) {
          return true;
        }
      }
    }
    return false;
  }
}
