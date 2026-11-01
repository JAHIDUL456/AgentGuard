import * as vscode from 'vscode';
import { AgentGuardEngine } from '../../core/engine';
import { FindingCategory } from '../../core/types';
import { FindingManager } from '../../findings/finding-manager';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import {
  CategoryTreeItem,
  FindingTreeItem,
  InfoTreeItem,
  StatusTreeItem,
} from './tree-items';

export class AgentGuardTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  public readonly onDidChangeTreeData: vscode.Event<
    vscode.TreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(
    private readonly _engine: AgentGuardEngine,
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _findingManager: FindingManager
  ) {
    this._engine.onDidChangeState(() => this.refresh());
    this._findingManager.onDidChangeFindings(() => this.refresh());
    this._workspaceManager.onDidChangeRoots(() => this.refresh());
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element instanceof CategoryTreeItem) {
      return Promise.resolve(
        element.findings.map(finding => new FindingTreeItem(finding))
      );
    }

    if (!element) {
      return Promise.resolve(this._getRootItems());
    }

    return Promise.resolve([]);
  }

  private _getRootItems(): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    const roots = this._workspaceManager.getRoots();

    if (roots.length === 0) {
      items.push(
        new StatusTreeItem(
          'AgentGuard',
          'Waiting for workspace',
          new vscode.ThemeIcon('folder-opened'),
          'Open a folder or workspace to enable automated safety monitoring.'
        )
      );
      items.push(
        new InfoTreeItem(
          'No Workspace Open',
          'Open a folder to start monitoring',
          new vscode.ThemeIcon('info')
        )
      );
      return items;
    }

    // Workspace is open, show status
    const engineState = this._engine.state;
    const rootCountDesc = `${roots.length} folder${roots.length === 1 ? '' : 's'}`;

    if (engineState === 'initializing') {
      items.push(
        new StatusTreeItem(
          'AgentGuard',
          `Initializing (${rootCountDesc})`,
          new vscode.ThemeIcon('sync~spin'),
          'AgentGuard engine is initializing workspace listeners.'
        )
      );
    } else if (engineState === 'analyzing') {
      items.push(
        new StatusTreeItem(
          'AgentGuard',
          `Scanning Codebase...`,
          new vscode.ThemeIcon('sync~spin'),
          'Evaluating codebase for risks.'
        )
      );
    } else {
      items.push(
        new StatusTreeItem(
          'AgentGuard',
          `Ready (${rootCountDesc})`,
          new vscode.ThemeIcon('shield'),
          'Continuous offline-first codebase protection active.'
        )
      );
    }

    // Findings section
    const allFindings = this._findingManager.getAll();

    if (allFindings.length === 0) {
      items.push(
        new InfoTreeItem(
          'No Risks Detected',
          'Codebase is clean',
          new vscode.ThemeIcon('check')
        )
      );
    } else {
      const categories: FindingCategory[] = [
        'untouched-file',
        'diagnostic-regression',
        'logic-risk',
        'broken-dependency',
      ];

      for (const cat of categories) {
        const catFindings = allFindings.filter(f => f.category === cat);
        if (catFindings.length > 0) {
          items.push(new CategoryTreeItem(cat, catFindings));
        }
      }
    }

    return items;
  }
}

