import * as vscode from 'vscode';
import { AgentGuardEngine } from '../../core/engine';
import { Finding } from '../../core/types';
import { FindingManager } from '../../findings/finding-manager';
import { LanguageAdapterRegistry } from '../../languages/adapter-registry';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import {
  ActivityTreeItem,
  FindingTreeItem,
  InfoTreeItem,
  LanguageTreeItem,
  SectionTreeItem,
  StatusItem,
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
    private readonly _findingManager: FindingManager,
    private readonly _languageRegistry?: LanguageAdapterRegistry
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
    if (!this._workspaceManager.hasWorkspace()) {
      if (!element) {
        return Promise.resolve([
          new StatusItem(
            'AgentGuard',
            'Waiting for workspace',
            new vscode.ThemeIcon('folder-opened')
          ),
          new InfoTreeItem(
            'No Workspace Open',
            'Open a folder to start monitoring',
            new vscode.ThemeIcon('info')
          ),
        ]);
      }
      return Promise.resolve([]);
    }

    if (!element) {
      return Promise.resolve(this._getRootSections());
    }

    if (element instanceof SectionTreeItem) {
      return Promise.resolve(this._getSectionChildren(element));
    }

    return Promise.resolve([]);
  }

  private _getRootSections(): vscode.TreeItem[] {
    const sections: vscode.TreeItem[] = [];
    const allFindings = this._findingManager.getAll();

    const critical = allFindings.filter(f => f.severity === 'error');
    const warnings = allFindings.filter(f => f.severity === 'warning');
    const review = allFindings.filter(f => f.severity === 'info');

    // 1. STATUS Section (Always shown)
    const gitAvailable = this._engine.gitAvailable;
    const gitRepoCount = this._engine.gitRepoCount;
    const modeDesc =
      gitAvailable && gitRepoCount > 0
        ? `Ready (Git • ${gitRepoCount} repo${gitRepoCount === 1 ? '' : 's'})`
        : `Ready (Fallback)`;

    const statusDesc = allFindings.length === 0 ? `All Clear (${modeDesc})` : `Issues Detected (${modeDesc})`;

    const statusSection = new SectionTreeItem(
      'STATUS',
      'status',
      undefined,
      allFindings.length === 0
        ? new vscode.ThemeIcon('shield', new vscode.ThemeColor('charts.green'))
        : new vscode.ThemeIcon('shield-x', new vscode.ThemeColor('errorForeground'))
    );
    statusSection.description = statusDesc;
    sections.push(statusSection);

    // 2. CRITICAL Section (Hidden if 0)
    if (critical.length > 0) {
      sections.push(
        new SectionTreeItem(
          'CRITICAL',
          'critical',
          critical.length,
          new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
        )
      );
    }

    // 3. WARNINGS Section (Hidden if 0)
    if (warnings.length > 0) {
      sections.push(
        new SectionTreeItem(
          'WARNINGS',
          'warnings',
          warnings.length,
          new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'))
        )
      );
    }

    // 4. REVIEW Section (Hidden if 0)
    if (review.length > 0) {
      sections.push(
        new SectionTreeItem(
          'REVIEW',
          'review',
          review.length,
          new vscode.ThemeIcon('info', new vscode.ThemeColor('problemsInfoIcon.foreground'))
        )
      );
    }

    // 5. LANGUAGES Section (Always shown)
    const adapters = this._languageRegistry?.getAdapters() ?? [];
    sections.push(
      new SectionTreeItem(
        'LANGUAGES',
        'languages',
        adapters.length > 0 ? adapters.length : undefined,
        new vscode.ThemeIcon('code')
      )
    );

    // 6. RECENT ACTIVITY Section (Always shown)
    sections.push(
      new SectionTreeItem(
        'RECENT ACTIVITY',
        'recent-activity',
        undefined,
        new vscode.ThemeIcon('history')
      )
    );

    return sections;
  }

  private _getSectionChildren(section: SectionTreeItem): vscode.TreeItem[] {
    const allFindings = this._findingManager.getAll();

    switch (section.sectionId) {
      case 'status': {
        const items: vscode.TreeItem[] = [];
        const critical = allFindings.filter(f => f.severity === 'error');
        const warnings = allFindings.filter(f => f.severity === 'warning');

        if (this._engine.state === 'analyzing') {
          items.push(
            new StatusItem(
              'Scanning Codebase',
              'Evaluating safety rules...',
              new vscode.ThemeIcon('sync~spin'),
              'Analysis engines are currently evaluating code changes.'
            )
          );
        } else if (allFindings.length === 0) {
          items.push(
            new StatusItem(
              'All Clear',
              'No active safety issues detected',
              new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green')),
              'All analyzed code changes comply with security, logic, and contract safeguards.'
            )
          );
        } else {
          items.push(
            new StatusItem(
              'Issues Detected',
              `${critical.length} Critical, ${warnings.length} Warnings`,
              new vscode.ThemeIcon('alert', new vscode.ThemeColor('errorForeground')),
              'Codebase safety issues detected. Review findings below.'
            )
          );
        }

        // Git / Watcher mode item
        if (this._engine.gitAvailable && this._engine.gitRepoCount > 0) {
          items.push(
            new StatusItem(
              'Git Integration',
              `Active (${this._engine.gitRepoCount} repo${this._engine.gitRepoCount === 1 ? '' : 's'})`,
              new vscode.ThemeIcon('git-branch')
            )
          );
        } else {
          items.push(
            new StatusItem(
              'Monitoring Mode',
              'Fallback file watcher active',
              new vscode.ThemeIcon('eye')
            )
          );
        }

        return items;
      }

      case 'critical': {
        const critical = allFindings.filter(f => f.severity === 'error');
        return critical.map(f => new FindingTreeItem(f));
      }

      case 'warnings': {
        const warnings = allFindings.filter(f => f.severity === 'warning');
        return warnings.map(f => new FindingTreeItem(f));
      }

      case 'review': {
        const review = allFindings.filter(f => f.severity === 'info');
        return review.map(f => new FindingTreeItem(f));
      }

      case 'languages': {
        const adapters = this._languageRegistry?.getAdapters() ?? [];
        return adapters.map(a => new LanguageTreeItem(a));
      }

      case 'recent-activity': {
        const items: vscode.TreeItem[] = [];
        const status = this._engine.getStatus();

        const lastScanStr = status.lastScanTimestamp
          ? new Date(status.lastScanTimestamp).toLocaleTimeString()
          : 'None yet';

        items.push(
          new ActivityTreeItem(
            'Last Scan',
            lastScanStr,
            new vscode.ThemeIcon('clock')
          )
        );

        items.push(
          new ActivityTreeItem(
            'Active Roots',
            `${status.activeWorkspaceFolders} folder(s)`,
            new vscode.ThemeIcon('root-folder')
          )
        );

        items.push(
          new ActivityTreeItem(
            'Engine Status',
            status.state.toUpperCase(),
            new vscode.ThemeIcon('pulse')
          )
        );

        return items;
      }
    }
  }
}
