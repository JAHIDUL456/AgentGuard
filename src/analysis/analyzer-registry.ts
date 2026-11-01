import { Disposable, IDisposable, toDisposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { FindingCategory } from '../core/types';
import { IAnalysisEngine } from './types';

export class AnalysisEngineRegistry extends Disposable {
  private readonly _engines = new Map<string, IAnalysisEngine>();

  constructor(private readonly _logger: ILogger) {
    super();
  }

  public registerEngine(engine: IAnalysisEngine): IDisposable {
    if (this._engines.has(engine.id)) {
      throw new Error(`Analysis engine '${engine.id}' is already registered.`);
    }

    this._engines.set(engine.id, engine);
    this._logger.debug(
      `Registered analysis engine: ${engine.name} [${engine.category}]`
    );

    return toDisposable(() => {
      this._engines.delete(engine.id);
      this._logger.debug(`Unregistered analysis engine: ${engine.id}`);
    });
  }

  public getEngine(id: string): IAnalysisEngine | undefined {
    return this._engines.get(id);
  }

  public getEngines(): readonly IAnalysisEngine[] {
    return Array.from(this._engines.values());
  }

  public getEnginesByCategory(
    category: FindingCategory
  ): readonly IAnalysisEngine[] {
    return Array.from(this._engines.values()).filter(
      e => e.category === category
    );
  }

  public override dispose(): void {
    this._engines.clear();
    super.dispose();
  }
}

