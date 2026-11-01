import * as assert from 'assert';
import * as vscode from 'vscode';
import { ChangeQueue } from '../../src/monitoring/change-queue';
import { FileChangeEvent } from '../../src/monitoring/types';

suite('ChangeQueue (Batching, Suppression & Coalescing)', () => {
  let queue: ChangeQueue;

  setup(() => {
    queue = new ChangeQueue(100);
  });

  function makeEvent(
    path: string,
    kind: FileChangeEvent['kind'],
    source: FileChangeEvent['source'] = 'watcher',
    oldPath?: string
  ): FileChangeEvent {
    return {
      uri: vscode.Uri.file(path),
      kind,
      timestamp: Date.now(),
      source,
      oldUri: oldPath ? vscode.Uri.file(oldPath) : undefined,
    };
  }

  test('coalesces create then modify into create', () => {
    queue.enqueue(makeEvent('/app/src/new-file.ts', 'created'));
    queue.enqueue(makeEvent('/app/src/new-file.ts', 'modified'));

    const items = queue.dequeueAll();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0]?.kind, 'created');
  });

  test('coalesces create then delete into net no-op', () => {
    queue.enqueue(makeEvent('/app/src/temp.ts', 'created'));
    assert.strictEqual(queue.size, 1);

    queue.enqueue(makeEvent('/app/src/temp.ts', 'deleted'));
    assert.strictEqual(queue.size, 0);
    assert.strictEqual(queue.dequeueAll().length, 0);
  });

  test('coalesces modify then delete into delete', () => {
    queue.enqueue(makeEvent('/app/src/existing.ts', 'modified'));
    queue.enqueue(makeEvent('/app/src/existing.ts', 'deleted'));

    const items = queue.dequeueAll();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0]?.kind, 'deleted');
  });

  test('coalesces delete then recreate into modify', () => {
    queue.enqueue(makeEvent('/app/src/recreated.ts', 'deleted'));
    queue.enqueue(makeEvent('/app/src/recreated.ts', 'created'));

    const items = queue.dequeueAll();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0]?.kind, 'modified');
  });

  test('suppresses duplicate modifications on the same file', () => {
    for (let i = 0; i < 10; i++) {
      queue.enqueue(makeEvent('/app/src/hot-file.ts', 'modified', 'document'));
    }

    assert.strictEqual(queue.size, 1);
    const items = queue.dequeueAll();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0]?.kind, 'modified');
  });

  test('handles rename events and removes previous oldUri entry', () => {
    queue.enqueue(makeEvent('/app/src/old-name.ts', 'modified'));
    queue.enqueue(makeEvent('/app/src/new-name.ts', 'renamed', 'rename', '/app/src/old-name.ts'));

    const items = queue.dequeueAll();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0]?.kind, 'renamed');
    assert.strictEqual(items[0]?.uri.fsPath, '/app/src/new-name.ts');
    assert.strictEqual(items[0]?.oldUri?.fsPath, '/app/src/old-name.ts');
  });

  test('enforces bounded capacity and backpressure under high volume', () => {
    const smallQueue = new ChangeQueue(10);
    for (let i = 0; i < 25; i++) {
      smallQueue.enqueue(makeEvent(`/app/file-${i}.ts`, 'created'));
    }

    assert.strictEqual(smallQueue.size, 10, 'Queue size should not exceed maxCapacity');
  });
});

