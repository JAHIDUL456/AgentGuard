import { ChangeKind, FileChangeEvent } from './types';

export const DEFAULT_MAX_QUEUE_CAPACITY = 2000;

export class ChangeQueue {
  private readonly _queue = new Map<string, FileChangeEvent>();
  private readonly _maxCapacity: number;

  constructor(maxCapacity: number = DEFAULT_MAX_QUEUE_CAPACITY) {
    this._maxCapacity = maxCapacity;
  }

  public get size(): number {
    return this._queue.size;
  }

  public clear(): void {
    this._queue.clear();
  }

  public peek(): readonly FileChangeEvent[] {
    return Array.from(this._queue.values());
  }

  public dequeueAll(): FileChangeEvent[] {
    const items = Array.from(this._queue.values());
    this._queue.clear();
    return items;
  }

  public enqueue(incoming: FileChangeEvent): void {
    const key = incoming.uri.toString();

    // Check backpressure limit
    if (!this._queue.has(key) && this._queue.size >= this._maxCapacity) {
      // Drop the oldest entry to bound memory under extreme bursts
      const oldestKey = this._queue.keys().next().value;
      if (oldestKey !== undefined) {
        this._queue.delete(oldestKey);
      }
    }

    // Special handling for rename events
    if (incoming.kind === 'renamed' && incoming.oldUri) {
      const oldKey = incoming.oldUri.toString();
      const existingOld = this._queue.get(oldKey);
      if (existingOld) {
        this._queue.delete(oldKey);
      }
      this._queue.set(key, incoming);
      return;
    }

    const existing = this._queue.get(key);
    if (!existing) {
      this._queue.set(key, incoming);
      return;
    }

    // Coalesce duplicate events on the same file
    const coalescedKind = this._coalesceKinds(existing.kind, incoming.kind);

    if (coalescedKind === null) {
      // Created then deleted within the same uncommitted cycle = net no-op
      this._queue.delete(key);
    } else {
      this._queue.set(key, {
        uri: incoming.uri,
        kind: coalescedKind,
        timestamp: incoming.timestamp,
        source: incoming.source,
        oldUri: incoming.oldUri ?? existing.oldUri,
      });
    }
  }

  private _coalesceKinds(
    existing: ChangeKind,
    incoming: ChangeKind
  ): ChangeKind | null {
    if (existing === 'created') {
      if (incoming === 'deleted') {
        // Created and deleted within same cycle
        return null;
      }
      // If modified or renamed after create, it's still fundamentally 'created'
      return 'created';
    }

    if (existing === 'modified') {
      if (incoming === 'deleted') {
        return 'deleted';
      }
      return 'modified';
    }

    if (existing === 'deleted') {
      if (incoming === 'created') {
        // Deleted and re-created = modified
        return 'modified';
      }
      return 'deleted';
    }

    if (existing === 'renamed') {
      if (incoming === 'deleted') {
        return 'deleted';
      }
      return 'renamed';
    }

    return incoming;
  }
}

