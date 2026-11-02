/**
 * Lightweight mock of the VS Code API for fast, standalone Node unit tests.
 */

export class MockEventEmitter<T> {
  private _listeners: Array<(e: T) => void> = [];

  public event = (listener: (e: T) => void) => {
    this._listeners.push(listener);
    return {
      dispose: () => {
        this._listeners = this._listeners.filter(l => l !== listener);
      },
    };
  };

  public fire(data: T): void {
    for (const listener of this._listeners) {
      listener(data);
    }
  }

  public dispose(): void {
    this._listeners = [];
  }
}

export class MockUri {
  constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string = '',
    public readonly fragment: string = ''
  ) {}

  public get fsPath(): string {
    return this.path;
  }

  public toString(): string {
    return `${this.scheme}://${this.path}`;
  }

  public static file(filePath: string): MockUri {
    return new MockUri('file', '', filePath);
  }

  public static parse(urlString: string): MockUri {
    const match = urlString.match(/^([a-z0-9+.-]+):\/\/([^/]*)(.*)$/i);
    if (match) {
      return new MockUri(match[1]!, match[2]!, match[3]!);
    }
    return new MockUri('file', '', urlString);
  }

  public static joinPath(base: MockUri, ...pathSegments: string[]): MockUri {
    const joined = [base.path, ...pathSegments].join('/').replace(/\/+/g, '/');
    return new MockUri(base.scheme, base.authority, joined);
  }
}

export class MockRange {
  public readonly start: { line: number; character: number };
  public readonly end: { line: number; character: number };

  constructor(
    startOrStartLine: { line: number; character: number } | number,
    endOrStartChar: { line: number; character: number } | number,
    endLine?: number,
    endCharacter?: number
  ) {
    if (typeof startOrStartLine === 'number') {
      this.start = { line: startOrStartLine, character: (endOrStartChar as number) ?? 0 };
      this.end = { line: endLine ?? startOrStartLine, character: endCharacter ?? 0 };
    } else {
      this.start = startOrStartLine;
      this.end = endOrStartChar as { line: number; character: number };
    }
  }
}

export class MockPosition {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class MockThemeIcon {
  constructor(public readonly id: string, public readonly color?: unknown) {}
}

export class MockThemeColor {
  constructor(public readonly id: string) {}
}

export class MockRelativePattern {
  constructor(public readonly base: MockUri | string, public readonly pattern: string) {}
  public get baseUri(): MockUri {
    return typeof this.base === 'string' ? MockUri.file(this.base) : this.base;
  }
}

export class MockMarkdownString {
  public value: string;
  public isTrusted: boolean = false;

  constructor(value: string = '') {
    this.value = value;
  }

  public appendMarkdown(value: string): MockMarkdownString {
    this.value += value;
    return this;
  }

  public appendCodeblock(value: string, language?: string): MockMarkdownString {
    this.value += `\n\`\`\`${language ?? ''}\n${value}\n\`\`\`\n`;
    return this;
  }

  public appendText(value: string): MockMarkdownString {
    this.value += value;
    return this;
  }
}

export enum MockTreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class MockTreeItem {
  public description?: string;
  public iconPath?: unknown;
  public tooltip?: unknown;
  public contextValue?: string;
  public command?: unknown;

  constructor(
    public label: string,
    public collapsibleState: MockTreeItemCollapsibleState = MockTreeItemCollapsibleState.None
  ) {}
}

export enum MockStatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class MockStatusBarItem {
  public text = '';
  public tooltip?: unknown;
  public command?: string;
  public backgroundColor?: unknown;
  public isVisible = false;

  constructor(
    public readonly alignment: MockStatusBarAlignment,
    public readonly priority?: number
  ) {}

  public show(): void {
    this.isVisible = true;
  }

  public hide(): void {
    this.isVisible = false;
  }

  public dispose(): void {
    this.isVisible = false;
  }
}

export class MockOutputChannel {
  public lines: string[] = [];
  public isShown = false;
  public isDisposed = false;

  constructor(public readonly name: string) {}

  public appendLine(value: string): void {
    this.lines.push(value);
  }

  public show(): void {
    this.isShown = true;
  }

  public dispose(): void {
    this.isDisposed = true;
  }
}

export class MockFileSystemWatcher {
  private readonly _onDidCreate = new MockEventEmitter<MockUri>();
  private readonly _onDidChange = new MockEventEmitter<MockUri>();
  private readonly _onDidDelete = new MockEventEmitter<MockUri>();

  public onDidCreate = this._onDidCreate.event;
  public onDidChange = this._onDidChange.event;
  public onDidDelete = this._onDidDelete.event;

  public fireCreate(uri: MockUri): void {
    this._onDidCreate.fire(uri);
  }

  public fireChange(uri: MockUri): void {
    this._onDidChange.fire(uri);
  }

  public fireDelete(uri: MockUri): void {
    this._onDidDelete.fire(uri);
  }

  public dispose(): void {
    this._onDidCreate.dispose();
    this._onDidChange.dispose();
    this._onDidDelete.dispose();
  }
}

export class MockCancellationToken {
  private _isCancelled = false;
  private readonly _onCancelled = new MockEventEmitter<void>();

  public get isCancellationRequested(): boolean {
    return this._isCancelled;
  }

  public get onCancellationRequested() {
    return this._onCancelled.event;
  }

  public _cancel(): void {
    if (!this._isCancelled) {
      this._isCancelled = true;
      this._onCancelled.fire();
    }
  }
}

export class MockCancellationTokenSource {
  public readonly token = new MockCancellationToken();

  public cancel(): void {
    this.token._cancel();
  }

  public dispose(): void {
    // no-op
  }
}

export enum MockDiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class MockDiagnostic {
  public source?: string;
  public code?: string | number | { value: string | number; target: MockUri };
  public relatedInformation?: Array<{ message: string; location: { uri: MockUri; range: MockRange } }>;

  constructor(
    public range: MockRange,
    public message: string,
    public severity: MockDiagnosticSeverity = MockDiagnosticSeverity.Error
  ) {}
}

export class MockLocation {
  constructor(public readonly uri: MockUri, public readonly range: MockRange) {}
}

export class MockDiagnosticRelatedInformation {
  constructor(public readonly location: MockLocation, public readonly message: string) {}
}

export class MockHover {
  constructor(public readonly contents: MockMarkdownString | MockMarkdownString[], public readonly range?: MockRange) {}
}

export class MockDiagnosticCollection {
  private readonly _diagnostics = new Map<string, MockDiagnostic[]>();

  constructor(public readonly name: string) {}

  public set(uri: MockUri, diagnostics: MockDiagnostic[]): void {
    this._diagnostics.set(uri.toString(), diagnostics);
  }

  public get(uri: MockUri): MockDiagnostic[] | undefined {
    return this._diagnostics.get(uri.toString());
  }

  public delete(uri: MockUri): void {
    this._diagnostics.delete(uri.toString());
  }

  public clear(): void {
    this._diagnostics.clear();
  }

  public dispose(): void {
    this._diagnostics.clear();
  }
}

const onDidChangeWorkspaceFoldersEmitter = new MockEventEmitter<unknown>();
const onDidOpenTextDocumentEmitter = new MockEventEmitter<unknown>();
const onDidCloseTextDocumentEmitter = new MockEventEmitter<unknown>();
const onDidSaveTextDocumentEmitter = new MockEventEmitter<unknown>();
const onDidChangeTextDocumentEmitter = new MockEventEmitter<unknown>();
const onDidRenameFilesEmitter = new MockEventEmitter<unknown>();
const onDidCreateFilesEmitter = new MockEventEmitter<unknown>();
const onDidDeleteFilesEmitter = new MockEventEmitter<unknown>();
const onDidChangeConfigurationEmitter = new MockEventEmitter<unknown>();
const onDidChangeDiagnosticsEmitter = new MockEventEmitter<{ uris: readonly MockUri[] }>();

export const mockVscode = {
  EventEmitter: MockEventEmitter,
  Uri: MockUri,
  Range: MockRange,
  Position: MockPosition,
  ThemeIcon: MockThemeIcon,
  ThemeColor: MockThemeColor,
  RelativePattern: MockRelativePattern,
  MarkdownString: MockMarkdownString,
  TreeItem: MockTreeItem,
  TreeItemCollapsibleState: MockTreeItemCollapsibleState,
  StatusBarAlignment: MockStatusBarAlignment,
  CancellationTokenSource: MockCancellationTokenSource,
  DiagnosticSeverity: MockDiagnosticSeverity,
  Diagnostic: MockDiagnostic,
  Location: MockLocation,
  DiagnosticRelatedInformation: MockDiagnosticRelatedInformation,
  Hover: MockHover,
  languages: {
    getDiagnostics: (_uri?: MockUri) => [] as Array<[MockUri, MockDiagnostic[]]>,
    createDiagnosticCollection: (name?: string) => new MockDiagnosticCollection(name ?? 'default'),
    onDidChangeDiagnostics: onDidChangeDiagnosticsEmitter.event,
    _fireDidChangeDiagnostics: (data: { uris: readonly MockUri[] }) => onDidChangeDiagnosticsEmitter.fire(data),
    registerHoverProvider: (_selector: unknown, _provider: unknown) => ({ dispose: () => {} }),
  },
  FileType: {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
  },
  ProgressLocation: {
    Notification: 15,
  },
  workspace: {
    workspaceFolders: [] as unknown[],
    textDocuments: [] as any[],
    onDidChangeWorkspaceFolders: onDidChangeWorkspaceFoldersEmitter.event,
    _fireDidChangeWorkspaceFolders: (data: unknown) => onDidChangeWorkspaceFoldersEmitter.fire(data),
    onDidOpenTextDocument: onDidOpenTextDocumentEmitter.event,
    _fireDidOpenTextDocument: (data: unknown) => onDidOpenTextDocumentEmitter.fire(data),
    onDidCloseTextDocument: onDidCloseTextDocumentEmitter.event,
    _fireDidCloseTextDocument: (data: unknown) => onDidCloseTextDocumentEmitter.fire(data),
    onDidSaveTextDocument: onDidSaveTextDocumentEmitter.event,
    _fireDidSaveTextDocument: (data: unknown) => onDidSaveTextDocumentEmitter.fire(data),
    onDidChangeTextDocument: onDidChangeTextDocumentEmitter.event,
    _fireDidChangeTextDocument: (data: unknown) => onDidChangeTextDocumentEmitter.fire(data),
    onDidRenameFiles: onDidRenameFilesEmitter.event,
    _fireDidRenameFiles: (data: unknown) => onDidRenameFilesEmitter.fire(data),
    onDidCreateFiles: onDidCreateFilesEmitter.event,
    _fireDidCreateFiles: (data: unknown) => onDidCreateFilesEmitter.fire(data),
    onDidDeleteFiles: onDidDeleteFilesEmitter.event,
    _fireDidDeleteFiles: (data: unknown) => onDidDeleteFilesEmitter.fire(data),
    onDidChangeConfiguration: onDidChangeConfigurationEmitter.event,
    _fireDidChangeConfiguration: (data: unknown) => onDidChangeConfigurationEmitter.fire(data),
    createFileSystemWatcher: (_glob: string) => new MockFileSystemWatcher(),
    getConfiguration: (_section?: string) => ({
      get: <T>(_key: string, defaultValue?: T): T => defaultValue as T,
    }),
    findFiles: async (include: any, _exclude?: any, _maxResults?: number, _token?: any) => {
      const fsMod = require('fs');
      const pathMod = require('path');
      const rootPath =
        typeof include === 'string'
          ? include
          : include?.baseUri?.fsPath ?? include?.base?.fsPath ?? include?.base;
      if (!rootPath || !fsMod.existsSync(rootPath)) {
        return [] as MockUri[];
      }
      const results: MockUri[] = [];
      const walk = (dir: string) => {
        try {
          const entries = fsMod.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = pathMod.join(dir, e.name);
            if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
              walk(full);
            } else if (e.isFile()) {
              results.push(MockUri.file(full));
            }
          }
        } catch {}
      };
      walk(rootPath);
      return results;
    },
    fs: {
      stat: async (uri: MockUri) => {
        const fsMod = require('fs');
        try {
          const s = fsMod.statSync(uri.fsPath);
          return { type: s.isDirectory() ? 2 : s.isFile() ? 1 : 0 };
        } catch {
          return { type: 2 };
        }
      },
      readDirectory: async (uri: MockUri) => {
        const fsMod = require('fs');
        try {
          const entries = fsMod.readdirSync(uri.fsPath, { withFileTypes: true });
          return entries.map((e: any) => [
            e.name,
            e.isDirectory() ? 2 : e.isFile() ? 1 : 0,
          ]);
        } catch {
          return [];
        }
      },
    },
    openTextDocument: async (options: { content: string; language: string }) => ({
      getText: () => options.content,
      languageId: options.language,
    }),
  },
  window: {
    createOutputChannel: (name: string) => new MockOutputChannel(name),
    createStatusBarItem: (alignment: MockStatusBarAlignment, priority?: number) =>
      new MockStatusBarItem(alignment, priority),
    createTreeView: (_viewId: string, options: unknown) => ({
      dispose: () => {
        // no-op
      },
      ...options as object,
    }),
    showInformationMessage: async (_msg: string) => undefined,
    showWarningMessage: async (_msg: string) => undefined,
    showErrorMessage: async (_msg: string) => undefined,
    showTextDocument: async (_doc: unknown) => undefined,
    withProgress: async (_options: unknown, task: () => Promise<unknown>) => task(),
    createTextEditorDecorationType: (_options: unknown) => ({ dispose: () => {} }),
    registerWebviewViewProvider: (_viewId: string, _provider: unknown) => ({ dispose: () => {} }),
  },
  commands: {
    _registeredCommands: new Map<string, (...args: unknown[]) => unknown>(),
    registerCommand: (command: string, callback: (...args: unknown[]) => unknown) => {
      mockVscode.commands._registeredCommands.set(command, callback);
      return {
        dispose: () => {
          mockVscode.commands._registeredCommands.delete(command);
        },
      };
    },
    executeCommand: async (command: string, ...args: unknown[]) => {
      const handler = mockVscode.commands._registeredCommands.get(command);
      if (handler) {
        return handler(...args);
      }
      return undefined;
    },
  },
};

