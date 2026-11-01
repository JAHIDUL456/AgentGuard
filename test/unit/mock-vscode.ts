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

  public static joinPath(base: MockUri, ...pathSegments: string[]): MockUri {
    const joined = [base.path, ...pathSegments].join('/').replace(/\/+/g, '/');
    return new MockUri(base.scheme, base.authority, joined);
  }
}

export class MockRange {
  constructor(
    public readonly start: { line: number; character: number },
    public readonly end: { line: number; character: number }
  ) {}
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

// Global state for mock
const onDidChangeWorkspaceFoldersEmitter = new MockEventEmitter<unknown>();
const onDidSaveTextDocumentEmitter = new MockEventEmitter<unknown>();
const onDidChangeTextDocumentEmitter = new MockEventEmitter<unknown>();
const onDidRenameFilesEmitter = new MockEventEmitter<unknown>();
const onDidCreateFilesEmitter = new MockEventEmitter<unknown>();
const onDidDeleteFilesEmitter = new MockEventEmitter<unknown>();
const onDidChangeConfigurationEmitter = new MockEventEmitter<unknown>();

export const mockVscode = {
  EventEmitter: MockEventEmitter,
  Uri: MockUri,
  Range: MockRange,
  Position: MockPosition,
  ThemeIcon: MockThemeIcon,
  ThemeColor: MockThemeColor,
  TreeItem: MockTreeItem,
  TreeItemCollapsibleState: MockTreeItemCollapsibleState,
  StatusBarAlignment: MockStatusBarAlignment,
  CancellationTokenSource: MockCancellationTokenSource,
  ProgressLocation: {
    Notification: 15,
  },
  workspace: {
    workspaceFolders: [] as unknown[],
    onDidChangeWorkspaceFolders: onDidChangeWorkspaceFoldersEmitter.event,
    _fireDidChangeWorkspaceFolders: (data: unknown) => onDidChangeWorkspaceFoldersEmitter.fire(data),
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
    fs: {
      stat: async (_uri: MockUri) => ({ type: 2 }), // 2 = Directory
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
    showTextDocument: async (_doc: unknown) => undefined,
    withProgress: async (_options: unknown, task: () => Promise<unknown>) => task(),
  },
  commands: {
    registerCommand: (_command: string, _callback: (...args: unknown[]) => unknown) => ({
      dispose: () => {
        // no-op
      },
    }),
  },
};

