import * as assert from 'assert';
import * as vscode from 'vscode';
import { NullLogger } from '../../src/core/logger';
import { ChangeProcessor } from '../../src/monitoring/change-processor';
import { ChangeBatch, FileChangeEvent } from '../../src/monitoring/types';

suite('ChangeProcessor (Debouncing, Batching & Cancellation)', () => {
  let processor: ChangeProcessor;

  setup(() => {
    processor = new ChangeProcessor(new NullLogger(), {
      debounceMs: 30,
      maxWaitMs: 80,
    });
  });

  teardown(() => {
    processor.dispose();
  });

  function makeEvent(path: string, kind: FileChangeEvent['kind'] = 'modified'): FileChangeEvent {
    return {
      uri: vscode.Uri.file(path),
      kind,
      timestamp: Date.now(),
      source: 'watcher',
    };
  }

  test('batches rapid events into a single ChangeBatch after debounce window', done => {
    let batchCount = 0;
    let receivedBatch: ChangeBatch | undefined;

    processor.onDidBatchReady(batch => {
      batchCount++;
      receivedBatch = batch;
    });

    processor.enqueue(makeEvent('/app/a.ts'));
    processor.enqueue(makeEvent('/app/b.ts'));
    processor.enqueue(makeEvent('/app/c.ts'));

    assert.strictEqual(batchCount, 0);

    setTimeout(() => {
      assert.strictEqual(batchCount, 1);
      assert.ok(receivedBatch);
      assert.strictEqual(receivedBatch.events.length, 3);
      assert.strictEqual(receivedBatch.affectedUris.length, 3);
      done();
    }, 60);
  });

  test('maxWaitMs forces flush even under continuous incoming changes', done => {
    let batchCount = 0;
    processor.onDidBatchReady(() => {
      batchCount++;
    });

    // Fire events every 15ms (faster than 30ms debounce)
    const interval = setInterval(() => {
      processor.enqueue(makeEvent('/app/stream.ts'));
    }, 15);

    // Max wait is 80ms, so by 110ms a batch must have flushed despite continuous streaming
    setTimeout(() => {
      clearInterval(interval);
      assert.ok(batchCount >= 1, `Expected at least 1 batch to flush, got: ${batchCount}`);
      done();
    }, 110);
  });

  test('cancels active job token when a new job token is requested or new batch flushes', () => {
    const tokenSource1 = processor.createJobToken();
    assert.strictEqual(tokenSource1.token.isCancellationRequested, false);

    // Creating a second job token automatically cancels the first
    const tokenSource2 = processor.createJobToken();
    assert.strictEqual(tokenSource1.token.isCancellationRequested, true);
    assert.strictEqual(tokenSource2.token.isCancellationRequested, false);

    // Flushing a batch also cancels any active job
    processor.enqueue(makeEvent('/app/x.ts'));
    processor.flush();
    assert.strictEqual(tokenSource2.token.isCancellationRequested, true);
  });
});
