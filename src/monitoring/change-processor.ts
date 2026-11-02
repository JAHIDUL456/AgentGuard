import * as vscode from 'vscode';
import { Disposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { ChangeQueue } from './change-queue';
import { ChangeBatch, FileChangeEvent } from './types';

export interface ProcessorOptions {
  readonly debounceMs?: number;
  readonly maxWaitMs?: number;
}

const DEFAULT_TYPING_DEBOUNCE_MS = 50;
const DEFAULT_TYPING_MAX_WAIT_MS = 250;
const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_MAX_WAIT_MS = 500;

export class ChangeProcessor extends Disposable {
  private readonly _queue = new ChangeQueue();
  private readonly _customDebounceMs?: number;
  private readonly _customMaxWaitMs?: number;

  private _debounceTimer: NodeJS.Timeout | undefined;
  private _maxWaitTimer: NodeJS.Timeout | undefined;
  private _activeJobTokenSource: vscode.CancellationTokenSource | undefined;
  private _batchSequence = 0;

  private readonly _onDidBatchReady = this._register(
    new vscode.EventEmitter<ChangeBatch>()
  );
  public readonly onDidBatchReady: vscode.Event<ChangeBatch> =
    this._onDidBatchReady.event;

  constructor(
    private readonly _logger: ILogger,
    options: ProcessorOptions = {}
  ) {
    super();
    this._customDebounceMs = options.debounceMs;
    this._customMaxWaitMs = options.maxWaitMs;
  }

  public get pendingCount(): number {
    return this._queue.size;
  }

  public enqueue(event: FileChangeEvent): void {
    this._queue.enqueue(event);
    this._scheduleFlush(event.source === 'document');
  }

  public clear(): void {
    this._cancelTimers();
    this._queue.clear();
    this.cancelActiveJob();
  }

  /**
   * Immediately flushes any pending events and generates a batch.
   */
  public flush(): ChangeBatch | undefined {
    this._cancelTimers();
    if (this._queue.size === 0) {
      return undefined;
    }

    const events = this._queue.dequeueAll();
    const affectedUris = Array.from(new Set(events.map(e => e.uri.toString()))).map(
      str => events.find(e => e.uri.toString() === str)!.uri
    );

    const batch: ChangeBatch = {
      id: `batch-${++this._batchSequence}-${Date.now()}`,
      events,
      affectedUris,
      timestamp: Date.now(),
    };

    // Cancel any previous in-flight processing job before emitting the new batch
    this.cancelActiveJob();

    this._logger.debug(
      `Dispatched change batch ${batch.id} with ${events.length} event(s) across ${affectedUris.length} file(s)`
    );

    this._onDidBatchReady.fire(batch);
    return batch;
  }

  /**
   * Creates a new cancellation token source for the active job.
   * Automatically cancels any previous active job.
   */
  public createJobToken(): vscode.CancellationTokenSource {
    this.cancelActiveJob();
    const source = new vscode.CancellationTokenSource();
    this._activeJobTokenSource = source;
    return source;
  }

  /**
   * Cancels any currently active processing job.
   */
  public cancelActiveJob(): void {
    if (this._activeJobTokenSource) {
      this._logger.debug('Cancelling outdated processing job');
      this._activeJobTokenSource.cancel();
      this._activeJobTokenSource.dispose();
      this._activeJobTokenSource = undefined;
    }
  }

  public override dispose(): void {
    this.clear();
    super.dispose();
  }

  private _scheduleFlush(isTyping = false): void {
    const debounceMs =
      this._customDebounceMs ??
      (isTyping ? DEFAULT_TYPING_DEBOUNCE_MS : DEFAULT_DEBOUNCE_MS);
    const maxWaitMs =
      this._customMaxWaitMs ??
      (isTyping ? DEFAULT_TYPING_MAX_WAIT_MS : DEFAULT_MAX_WAIT_MS);

    // Reset the debounce timer on each incoming event
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined;
      this.flush();
    }, debounceMs);

    // Ensure we don't delay indefinitely during sustained rapid event bursts
    if (this._maxWaitTimer === undefined) {
      this._maxWaitTimer = setTimeout(() => {
        this._maxWaitTimer = undefined;
        this.flush();
      }, maxWaitMs);
    }
  }

  private _cancelTimers(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    if (this._maxWaitTimer !== undefined) {
      clearTimeout(this._maxWaitTimer);
      this._maxWaitTimer = undefined;
    }
  }
}

