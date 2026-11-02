import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentGuardEngine } from '../../core/engine';
import { Finding } from '../../core/types';
import { FindingManager } from '../../findings/finding-manager';
import { ChangeMonitor } from '../../monitoring/change-monitor';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import {
  COMMAND_COPY_FIX_PROMPT,
  COMMAND_OPEN_PROBLEMS_PANEL,
  COMMAND_SCAN_WORKSPACE,
  COMMAND_TOGGLE_MONITORING,
} from '../commands/command-ids';
import { NavigationService } from '../navigation/navigation-service';

export interface SidebarFilterState {
  cardFilter?: 'new' | 'critical' | 'files' | 'resolved' | 'review';
  categoryFilter?: string;
  searchQuery?: string;
}

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentguard.findingsView';

  private _view?: vscode.WebviewView;
  private _filterState: SidebarFilterState = {};

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _engine: AgentGuardEngine,
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _findingManager: FindingManager,
    private readonly _changeMonitor: ChangeMonitor
  ) {
    this._engine.onDidChangeState(() => this.update());
    this._findingManager.onDidChangeFindings(() => this.update());
    this._workspaceManager.onDidChangeRoots(() => this.update());
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message: any) => {
      switch (message.type) {
        case 'refresh':
          await vscode.commands.executeCommand(COMMAND_SCAN_WORKSPACE);
          break;
        case 'toggleMonitoring':
          await vscode.commands.executeCommand(COMMAND_TOGGLE_MONITORING);
          break;
        case 'openSettings':
          await vscode.commands.executeCommand('workbench.action.openSettings', 'agentguard');
          break;
        case 'openProblemsPanel':
          await vscode.commands.executeCommand(COMMAND_OPEN_PROBLEMS_PANEL, message.findingId);
          break;
        case 'openFinding': {
          const finding = this._findFinding(message.findingId);
          if (finding) {
            await NavigationService.openFinding(finding);
          }
          break;
        }
        case 'copyFixPrompt': {
          const finding = this._findFinding(message.findingId);
          if (finding) {
            await vscode.commands.executeCommand(COMMAND_COPY_FIX_PROMPT, finding);
          }
          break;
        }
        case 'setCardFilter':
          this._filterState.cardFilter =
            this._filterState.cardFilter === message.filter ? undefined : message.filter;
          this.update();
          break;
        case 'setSearch':
          this._filterState.searchQuery = message.query;
          this.update();
          break;
        case 'clearFilters':
          this._filterState = {};
          this.update();
          break;
      }
    });

    this.update();
  }

  public update(): void {
    if (!this._view) {
      return;
    }
    this._view.webview.html = this._getHtmlForWebview(this._view.webview);
  }

  private _findFinding(id: string): Finding | undefined {
    return (
      this._findingManager.getAll().find(f => f.id === id) ??
      this._findingManager.getResolvedHistory().find(f => f.id === id)
    );
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const allFindings = this._findingManager.getAll();
    const resolvedFindings = this._findingManager.getResolvedHistory();

    // 1. Determine System Status
    const isMonitoring = this._changeMonitor.isEnabled();
    const isAnalyzing = this._engine.state === 'analyzing';
    const hasWorkspace = this._workspaceManager.hasWorkspace();

    let statusText = 'Monitoring workspace';
    let statusClass = 'status-monitoring';
    if (!hasWorkspace) {
      statusText = 'No workspace open';
      statusClass = 'status-paused';
    } else if (isAnalyzing) {
      statusText = 'Checking changes...';
      statusClass = 'status-checking';
    } else if (!isMonitoring) {
      statusText = 'Paused';
      statusClass = 'status-paused';
    } else if (!this._engine.gitAvailable) {
      statusText = 'Analysis limited (no Git)';
      statusClass = 'status-limited';
    }

    // 2. Compute Summary Metrics
    const criticalCount = allFindings.filter(f => f.severity === 'error').length;
    const newIssuesCount = allFindings.filter(
      f =>
        f.category === 'confirmed-new-diagnostic' ||
        f.category === 'diagnostic-regression' ||
        f.evidenceClassification === 'confirmed-regression'
    ).length;
    const uniqueFiles = new Set(allFindings.map(f => f.location.filePath)).size;
    const resolvedCount = resolvedFindings.length;
    const reviewCount = allFindings.filter(
      f =>
        f.severity === 'info' ||
        f.category === 'unresolved-reference' ||
        f.category === 'analysis-incomplete' ||
        f.confidence === 'low'
    ).length;

    // 3. Filter Findings Based on Selection
    let displayedFindings = [...allFindings];
    const cardFilter = this._filterState.cardFilter;

    if (cardFilter === 'new') {
      displayedFindings = displayedFindings.filter(
        f =>
          f.category === 'confirmed-new-diagnostic' ||
          f.category === 'diagnostic-regression' ||
          f.evidenceClassification === 'confirmed-regression'
      );
    } else if (cardFilter === 'critical') {
      displayedFindings = displayedFindings.filter(f => f.severity === 'error');
    } else if (cardFilter === 'files') {
      // Keep all, ordered by file
      displayedFindings.sort((a, b) => a.location.filePath.localeCompare(b.location.filePath));
    } else if (cardFilter === 'resolved') {
      displayedFindings = [...resolvedFindings];
    } else if (cardFilter === 'review') {
      displayedFindings = displayedFindings.filter(
        f =>
          f.severity === 'info' ||
          f.category === 'unresolved-reference' ||
          f.category === 'analysis-incomplete' ||
          f.confidence === 'low'
      );
    }

    if (this._filterState.searchQuery && this._filterState.searchQuery.trim().length > 0) {
      const q = this._filterState.searchQuery.toLowerCase();
      displayedFindings = displayedFindings.filter(
        f =>
          f.title.toLowerCase().includes(q) ||
          f.location.filePath.toLowerCase().includes(q) ||
          f.explanation.toLowerCase().includes(q)
      );
    }

    // 4. Categorize Findings
    const breaking = displayedFindings.filter(f =>
      [
        'untouched-file',
        'potentially-broken-contract',
        'broken-dependency',
        'potentially-affected-dependency',
      ].includes(f.category)
    );

    const regressions = displayedFindings.filter(
      f =>
        (f.category === 'confirmed-new-diagnostic' || f.category === 'diagnostic-regression') &&
        !breaking.includes(f)
    );

    const securityAndLogic = displayedFindings.filter(
      f =>
        (f.category === 'logic-risk' ||
          f.ruleId?.startsWith('silent-regression') ||
          f.ruleId?.startsWith('watchdog')) &&
        !breaking.includes(f) &&
        !regressions.includes(f)
    );

    const unused = displayedFindings.filter(
      f =>
        f.category === 'unused-code' &&
        !breaking.includes(f) &&
        !regressions.includes(f) &&
        !securityAndLogic.includes(f)
    );

    const needsReview = displayedFindings.filter(
      f =>
        !breaking.includes(f) &&
        !regressions.includes(f) &&
        !securityAndLogic.includes(f) &&
        !unused.includes(f) &&
        f.status !== 'resolved'
    );

    const resolved = displayedFindings.filter(f => f.status === 'resolved');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentGuard</title>
  <style nonce="${nonce}">
    :root {
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      --font-size: var(--vscode-font-size, 12px);
      --border-color: var(--vscode-sideBar-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.2)));
      --card-bg: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      --hover-bg: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08));
      --active-card-border: var(--vscode-focusBorder, #007acc);
      --critical-color: var(--vscode-editorError-foreground, #f14c4c);
      --warning-color: var(--vscode-editorWarning-foreground, #cca700);
      --review-color: var(--vscode-editorInfo-foreground, #3794ff);
      --resolved-color: var(--vscode-charts-green, #388a34);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-family);
      font-size: var(--font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
      padding: 10px;
      line-height: 1.4;
      user-select: none;
    }
    
    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 10px;
    }
    .header-left {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .app-title {
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.3px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
    }
    .status-monitoring .status-dot { background-color: var(--resolved-color); box-shadow: 0 0 5px var(--resolved-color); }
    .status-checking .status-dot { background-color: var(--review-color); animation: pulse 1s infinite; }
    .status-paused .status-dot { background-color: var(--warning-color); }
    .status-limited .status-dot { background-color: var(--vscode-descriptionForeground); }

    @keyframes pulse {
      0% { opacity: 0.4; }
      50% { opacity: 1; }
      100% { opacity: 0.4; }
    }

    .header-controls {
      display: flex;
      gap: 3px;
    }
    .icon-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--vscode-icon-foreground);
      padding: 3px 5px;
      border-radius: 3px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
    }
    .icon-btn:hover {
      background-color: var(--hover-bg);
      border-color: var(--border-color);
    }

    /* Summary Metrics Cards (Responsive 2-Column) */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      margin-bottom: 12px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 6px 8px;
      cursor: pointer;
      transition: border-color 0.15s ease, background-color 0.15s ease;
      display: flex;
      flex-direction: column;
    }
    .metric-card:hover {
      background-color: var(--hover-bg);
      border-color: var(--vscode-focusBorder);
    }
    .metric-card.active {
      border-color: var(--active-card-border);
      background-color: var(--hover-bg);
    }
    .metric-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }
    .metric-value-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
    }
    .metric-value {
      font-size: 16px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .metric-card.critical .metric-value { color: var(--critical-color); }
    .metric-card.resolved .metric-value { color: var(--resolved-color); }
    .metric-card.new .metric-value { color: var(--critical-color); }

    /* Filter banner */
    .filter-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      background: var(--hover-bg);
      border-radius: 4px;
      margin-bottom: 10px;
      font-size: 11px;
    }
    .clear-link {
      color: var(--review-color);
      cursor: pointer;
      text-decoration: underline;
    }

    /* Category Accordions */
    .category-group {
      margin-bottom: 10px;
    }
    .category-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
      padding: 4px 2px;
      margin-bottom: 4px;
      border-bottom: 1px solid var(--border-color);
    }
    .category-count {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 1px 5px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: normal;
    }

    /* Finding Card */
    .finding-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-left: 3px solid var(--review-color);
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .finding-card:hover {
      background-color: var(--hover-bg);
      border-color: var(--active-card-border);
    }
    .finding-card.severity-error { border-left-color: var(--critical-color); }
    .finding-card.severity-warning { border-left-color: var(--warning-color); }
    .finding-card.severity-info { border-left-color: var(--review-color); }
    .finding-card.status-resolved { border-left-color: var(--resolved-color); opacity: 0.85; }

    .card-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 4px;
    }
    .card-title {
      font-weight: 600;
      font-size: 12px;
      color: var(--vscode-foreground);
      word-break: break-word;
    }
    .severity-badge {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 4px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .severity-badge.error { background: rgba(241, 76, 76, 0.2); color: var(--critical-color); }
    .severity-badge.warning { background: rgba(204, 167, 0, 0.2); color: var(--warning-color); }
    .severity-badge.info { background: rgba(55, 148, 255, 0.2); color: var(--review-color); }
    .severity-badge.resolved { background: rgba(56, 138, 52, 0.2); color: var(--resolved-color); }

    .card-location {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .card-explanation {
      font-size: 11px;
      color: var(--vscode-foreground);
      margin-bottom: 6px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      opacity: 0.9;
    }
    .card-meta-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
    }
    .meta-pill {
      background: var(--hover-bg);
      border: 1px solid var(--border-color);
      padding: 1px 5px;
      border-radius: 3px;
      color: var(--vscode-descriptionForeground);
    }
    .meta-pill.affected {
      color: var(--critical-color);
      border-color: rgba(241, 76, 76, 0.3);
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 24px 12px;
      color: var(--vscode-descriptionForeground);
    }
    .empty-icon {
      font-size: 24px;
      margin-bottom: 8px;
      display: block;
      color: var(--resolved-color);
    }
    .empty-headline {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 4px;
    }
    .empty-desc {
      font-size: 11px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <div class="title-row">
        <span class="app-title">AgentGuard</span>
      </div>
      <div class="status-badge ${statusClass}">
        <span class="status-dot"></span>
        <span>${statusText}</span>
      </div>
    </div>
    <div class="header-controls">
      <button class="icon-btn" id="btn-refresh" title="Check codebase safety (Refresh)">🔄</button>
      <button class="icon-btn" id="btn-toggle" title="${isMonitoring ? 'Pause monitoring' : 'Resume monitoring'}">${isMonitoring ? '⏸️' : '▶️'}</button>
      <button class="icon-btn" id="btn-panel" title="Open full AgentGuard issues panel">📋</button>
      <button class="icon-btn" id="btn-settings" title="AgentGuard Settings">⚙️</button>
    </div>
  </div>

  <!-- Summary Metric Cards (2-Column Responsive) -->
  <div class="summary-grid">
    <div class="metric-card new ${cardFilter === 'new' ? 'active' : ''}" data-filter="new">
      <span class="metric-title">New Issues</span>
      <div class="metric-value-row">
        <span class="metric-value">${newIssuesCount}</span>
      </div>
    </div>
    <div class="metric-card critical ${cardFilter === 'critical' ? 'active' : ''}" data-filter="critical">
      <span class="metric-title">Critical Risks</span>
      <div class="metric-value-row">
        <span class="metric-value">${criticalCount}</span>
      </div>
    </div>
    <div class="metric-card files ${cardFilter === 'files' ? 'active' : ''}" data-filter="files">
      <span class="metric-title">Affected Files</span>
      <div class="metric-value-row">
        <span class="metric-value">${uniqueFiles}</span>
      </div>
    </div>
    <div class="metric-card resolved ${cardFilter === 'resolved' ? 'active' : ''}" data-filter="resolved">
      <span class="metric-title">Resolved</span>
      <div class="metric-value-row">
        <span class="metric-value">${resolvedCount}</span>
      </div>
    </div>
  </div>

  <!-- Active Filter Banner (if filter active) -->
  ${
    cardFilter
      ? `<div class="filter-banner">
          <span>Filtering by: <strong>${cardFilter.toUpperCase()}</strong></span>
          <span class="clear-link" id="btn-clear-filter">Show All</span>
        </div>`
      : ''
  }

  <!-- Findings List -->
  <div class="findings-container">
    ${
      displayedFindings.length === 0
        ? `<div class="empty-state">
            <span class="empty-icon">✓</span>
            <div class="empty-headline">No new regressions detected.</div>
            <div class="empty-desc">All monitored files and change impacts conform to safety policies.</div>
          </div>`
        : ''
    }

    ${
      breaking.length > 0
        ? `<div class="category-group">
            <div class="category-header">
              <span>Breaking Changes</span>
              <span class="category-count">${breaking.length}</span>
            </div>
            ${breaking.map(f => this._renderFindingCard(f)).join('')}
          </div>`
        : ''
    }

    ${
      regressions.length > 0
        ? `<div class="category-group">
            <div class="category-header">
              <span>New Regressions</span>
              <span class="category-count">${regressions.length}</span>
            </div>
            ${regressions.map(f => this._renderFindingCard(f)).join('')}
          </div>`
        : ''
    }

    ${
      securityAndLogic.length > 0
        ? `<div class="category-group">
            <div class="category-header">
              <span>Security & Logic</span>
              <span class="category-count">${securityAndLogic.length}</span>
            </div>
            ${securityAndLogic.map(f => this._renderFindingCard(f)).join('')}
          </div>`
        : ''
    }

    ${
      unused.length > 0
        ? `<div class="category-group">
            <div class="category-header">
              <span>Unused Code</span>
              <span class="category-count">${unused.length}</span>
            </div>
            ${unused.map(f => this._renderFindingCard(f)).join('')}
          </div>`
        : ''
    }

    ${
      needsReview.length > 0
        ? `<div class="category-group">
            <div class="category-header">
              <span>Needs Review</span>
              <span class="category-count">${needsReview.length}</span>
            </div>
            ${needsReview.map(f => this._renderFindingCard(f)).join('')}
          </div>`
        : ''
    }

    ${
      cardFilter === 'resolved' && resolved.length > 0
        ? `<div class="category-group">
            <div class="category-header">
              <span>Verified Resolved</span>
              <span class="category-count">${resolved.length}</span>
            </div>
            ${resolved.map(f => this._renderFindingCard(f)).join('')}
          </div>`
        : ''
    }
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('btn-refresh')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('btn-toggle')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleMonitoring' });
    });
    document.getElementById('btn-panel')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openProblemsPanel' });
    });
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });
    document.getElementById('btn-clear-filter')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearFilters' });
    });

    document.querySelectorAll('.metric-card').forEach(card => {
      card.addEventListener('click', () => {
        const filter = card.getAttribute('data-filter');
        vscode.postMessage({ type: 'setCardFilter', filter });
      });
    });

    document.querySelectorAll('.finding-card').forEach(card => {
      card.addEventListener('click', () => {
        const findingId = card.getAttribute('data-finding-id');
        vscode.postMessage({ type: 'openFinding', findingId });
      });
    });
  </script>
</body>
</html>`;
  }

  private _renderFindingCard(f: Finding): string {
    const isResolved = f.status === 'resolved';
    const severityLabel = isResolved
      ? 'Resolved'
      : f.severity === 'error'
      ? 'Critical'
      : f.severity === 'warning'
      ? 'Warning'
      : 'Review';

    const severityClass = isResolved ? 'resolved' : f.severity;
    const lineNum = f.location.range ? f.location.range.start.line + 1 : undefined;
    const fileName = path.basename(f.location.filePath);
    const locStr = lineNum ? `${fileName}:${lineNum}` : fileName;
    const affectedCount = f.relatedLocations?.length ?? 0;

    return `
      <div class="finding-card severity-${f.severity} ${isResolved ? 'status-resolved' : ''}" data-finding-id="${f.id}" title="Click to reveal exact source in editor">
        <div class="card-top">
          <span class="card-title">${this._escape(f.title)}</span>
          <span class="severity-badge ${severityClass}">${severityLabel}</span>
        </div>
        <div class="card-location">${this._escape(locStr)}</div>
        <div class="card-explanation">${this._escape(f.explanation)}</div>
        <div class="card-meta-row">
          ${affectedCount > 0 ? `<span class="meta-pill affected">${affectedCount} file${affectedCount === 1 ? '' : 's'} affected</span>` : ''}
          <span class="meta-pill">${f.confidence.toUpperCase()}</span>
          ${f.evidenceClassification ? `<span class="meta-pill">${this._escape(f.evidenceClassification)}</span>` : ''}
        </div>
      </div>
    `;
  }

  private _escape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
