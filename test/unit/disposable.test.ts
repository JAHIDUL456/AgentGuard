import * as assert from 'assert';
import { DisposableStore, toDisposable } from '../../src/core/disposable';

suite('DisposableStore', () => {
  test('disposes all added disposables upon dispose()', () => {
    const store = new DisposableStore();
    let disposedCount = 0;

    store.add(toDisposable(() => disposedCount++));
    store.add(toDisposable(() => disposedCount++));
    store.add(toDisposable(() => disposedCount++));

    assert.strictEqual(disposedCount, 0);
    assert.strictEqual(store.isDisposed, false);

    store.dispose();

    assert.strictEqual(disposedCount, 3);
    assert.strictEqual(store.isDisposed, true);
  });

  test('immediately disposes item added after store is already disposed', () => {
    const store = new DisposableStore();
    store.dispose();

    let disposed = false;
    store.add(toDisposable(() => { disposed = true; }));

    assert.strictEqual(disposed, true);
  });

  test('clear() disposes items but does not mark store as permanently disposed', () => {
    const store = new DisposableStore();
    let disposed1 = false;
    let disposed2 = false;

    store.add(toDisposable(() => { disposed1 = true; }));
    store.clear();

    assert.strictEqual(disposed1, true);
    assert.strictEqual(store.isDisposed, false);

    store.add(toDisposable(() => { disposed2 = true; }));
    assert.strictEqual(disposed2, false);

    store.dispose();
    assert.strictEqual(disposed2, true);
  });
});

