/**
 * Disposable resource management.
 * Follows VS Code's deterministic disposal pattern.
 */

export interface IDisposable {
  dispose(): void;
}

export class DisposableStore implements IDisposable {
  private readonly _disposables = new Set<IDisposable>();
  private _isDisposed = false;

  public get isDisposed(): boolean {
    return this._isDisposed;
  }

  public add<T extends IDisposable>(disposable: T): T {
    if (this._isDisposed) {
      disposable.dispose();
      return disposable;
    }
    this._disposables.add(disposable);
    return disposable;
  }

  public clear(): void {
    for (const disposable of this._disposables) {
      try {
        disposable.dispose();
      } catch (err) {
        console.error('Error disposing resource:', err);
      }
    }
    this._disposables.clear();
  }

  public dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    this.clear();
  }
}

export abstract class Disposable implements IDisposable {
  protected readonly _disposables = new DisposableStore();

  protected _register<T extends IDisposable>(disposable: T): T {
    return this._disposables.add(disposable);
  }

  public dispose(): void {
    this._disposables.dispose();
  }
}

export function toDisposable(fn: () => void): IDisposable {
  return {
    dispose: fn,
  };
}

