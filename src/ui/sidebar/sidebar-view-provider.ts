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
  private _hasLoadedWebview = false;

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
    this._hasLoadedWebview = false;

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

    if (!this._hasLoadedWebview) {
      // First mount: establish the complete HTML shell with initial data
      this._view.webview.html = this._getHtmlForWebview(this._view.webview);
      this._hasLoadedWebview = true;
      return;
    }

    // Subsequent updates: send smooth, non-destructive postMessage delta
    // This completely eliminates DOM tearing, hover flickering, and scroll jumps
    const payload = this._computeStatePayload();
    if (typeof this._view.webview.postMessage === 'function') {
      this._view.webview.postMessage({
        type: 'stateUpdate',
        data: payload,
      });
    }
  }

  private _findFinding(id: string): Finding | undefined {
    return (
      this._findingManager.getAll().find(f => f.id === id) ??
      this._findingManager.getResolvedHistory().find(f => f.id === id)
    );
  }

  private _computeStatePayload() {
    const allFindings = this._findingManager.getAll();
    const resolvedFindings = this._findingManager.getResolvedHistory();

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

    const criticalCount = allFindings.filter(f => f.severity === 'error').length;
    const newIssuesCount = allFindings.filter(
      f =>
        f.category === 'confirmed-new-diagnostic' ||
        f.category === 'diagnostic-regression' ||
        f.evidenceClassification === 'confirmed-regression'
    ).length;
    const uniqueFiles = new Set(allFindings.map(f => f.location.filePath)).size;
    const resolvedCount = resolvedFindings.length;

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

    return {
      statusText,
      statusClass,
      totalActive: allFindings.length,
      metrics: {
        newCount: newIssuesCount,
        criticalCount,
        affectedFiles: uniqueFiles,
        resolvedCount,
      },
      cardFilter,
      categories: {
        breaking: breaking.map(f => this._renderFindingCard(f)),
        regressions: regressions.map(f => this._renderFindingCard(f)),
        securityAndLogic: securityAndLogic.map(f => this._renderFindingCard(f)),
        unused: unused.map(f => this._renderFindingCard(f)),
        needsReview: needsReview.map(f => this._renderFindingCard(f)),
        resolved: resolved.map(f => this._renderFindingCard(f)),
      },
    };
  }

  private _getHtmlForWebview(_webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const data = this._computeStatePayload();

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
    html, body {
      height: 100%;
      overflow: hidden;
      font-family: var(--font-family);
      font-size: var(--font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
      user-select: none;
    }
    
    .app-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      padding: 8px 10px;
      box-sizing: border-box;
    }
    
    /* Fixed Header Area */
    .header-section {
      flex-shrink: 0;
    }
    
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
      transition: background-color 0.2s ease;
    }
    .status-monitoring .status-dot { background-color: var(--resolved-color); box-shadow: 0 0 5px var(--resolved-color); }
    .status-checking .status-dot { background-color: var(--review-color); }
    .status-paused .status-dot { background-color: var(--warning-color); }
    .status-limited .status-dot { background-color: var(--vscode-descriptionForeground); }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .header-count-pill {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 10px;
      background: var(--hover-bg);
      border: 1px solid var(--border-color);
      color: var(--vscode-foreground);
    }
    .header-count-pill.has-issues {
      color: var(--critical-color);
      border-color: rgba(241, 76, 76, 0.4);
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
      line-height: 1;
    }
    .icon-btn:hover {
      background-color: var(--hover-bg);
      border-color: var(--border-color);
    }

    /* Summary Metric Cards (2-Column Responsive) */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      margin-bottom: 10px;
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
      font-size: 15px;
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
      margin-bottom: 8px;
      font-size: 11px;
    }
    .clear-link {
      color: var(--review-color);
      cursor: pointer;
      text-decoration: underline;
    }

    /* Dedicated Smooth Scrollable Findings List */
    .scrollable-content {
      flex: 1 1 auto;
      overflow-y: auto;
      overflow-x: hidden;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      padding-right: 2px;
    }
    .scrollable-content::-webkit-scrollbar {
      width: 6px;
    }
    .scrollable-content::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 3px;
    }
    .scrollable-content::-webkit-scrollbar-thumb:hover {
      background: var(--vscode-scrollbarSlider-hoverBackground);
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
      padding: 24px 12px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
    .empty-icon {
      font-size: 24px;
      margin-bottom: 8px;
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
  <div class="app-container">
    <!-- Header Section -->
    <div class="header-section">
      <div class="header">
        <div class="header-left">
          <div class="title-row">
            <span class="app-title">AgentGuard</span>
          </div>
          <div class="status-badge ${data.statusClass}" id="status-badge">
            <span class="status-dot"></span>
            <span id="status-text">${data.statusText}</span>
          </div>
        </div>
        <div class="header-controls">
          <span class="header-count-pill ${data.totalActive > 0 ? 'has-issues' : ''}" id="header-count-pill">${data.totalActive} issue${data.totalActive === 1 ? '' : 's'}</span>
          <button class="icon-btn" id="btn-panel" title="Open full AgentGuard issues panel">📋</button>
          <button class="icon-btn" id="btn-settings" title="AgentGuard Settings">⚙️</button>
        </div>
      </div>

      <!-- Summary Metric Cards (2-Column Responsive) -->
      <div class="summary-grid">
        <div class="metric-card new ${data.cardFilter === 'new' ? 'active' : ''}" data-filter="new">
          <span class="metric-title">New Issues</span>
          <div class="metric-value-row">
            <span class="metric-value">${data.metrics.newCount}</span>
          </div>
        </div>
        <div class="metric-card critical ${data.cardFilter === 'critical' ? 'active' : ''}" data-filter="critical">
          <span class="metric-title">Critical Risks</span>
          <div class="metric-value-row">
            <span class="metric-value">${data.metrics.criticalCount}</span>
          </div>
        </div>
        <div class="metric-card files ${data.cardFilter === 'files' ? 'active' : ''}" data-filter="files">
          <span class="metric-title">Affected Files</span>
          <div class="metric-value-row">
            <span class="metric-value">${data.metrics.affectedFiles}</span>
          </div>
        </div>
        <div class="metric-card resolved ${data.cardFilter === 'resolved' ? 'active' : ''}" data-filter="resolved">
          <span class="metric-title">Resolved</span>
          <div class="metric-value-row">
            <span class="metric-value">${data.metrics.resolvedCount}</span>
          </div>
        </div>
      </div>

      ${data.cardFilter ? `
      <div class="filter-banner" id="filter-banner">
        <span>Filtered: <strong>${data.cardFilter.toUpperCase()}</strong></span>
        <span class="clear-link" id="btn-clear-filter">Show all</span>
      </div>` : ''}
    </div>

    <!-- Scrollable Findings List (Smooth kinetic scrolling, stable during updates) -->
    <div class="scrollable-content" id="scroll-container">
      <!-- Empty State -->
      <div class="empty-state" id="empty-state" style="display: ${data.totalActive === 0 ? 'block' : 'none'};">
        <div class="empty-icon">✓</div>
        <div class="empty-headline">No new regressions detected.</div>
        <div class="empty-desc">AgentGuard is actively monitoring your code in real time.</div>
      </div>

      <!-- Breaking Changes -->
      <div class="category-group" id="group-breaking" style="display: ${data.categories.breaking.length > 0 ? 'block' : 'none'};">
        <div class="category-header">
          <span>Breaking Changes</span>
          <span class="category-count" id="count-breaking">${data.categories.breaking.length}</span>
        </div>
        <div class="cards-container" id="cards-breaking">
          ${data.categories.breaking.join('')}
        </div>
      </div>

      <!-- Security & Critical Logic -->
      <div class="category-group" id="group-securityAndLogic" style="display: ${data.categories.securityAndLogic.length > 0 ? 'block' : 'none'};">
        <div class="category-header">
          <span>Security & Logic</span>
          <span class="category-count" id="count-securityAndLogic">${data.categories.securityAndLogic.length}</span>
        </div>
        <div class="cards-container" id="cards-securityAndLogic">
          ${data.categories.securityAndLogic.join('')}
        </div>
      </div>

      <!-- New Regressions -->
      <div class="category-group" id="group-regressions" style="display: ${data.categories.regressions.length > 0 ? 'block' : 'none'};">
        <div class="category-header">
          <span>New Regressions</span>
          <span class="category-count" id="count-regressions">${data.categories.regressions.length}</span>
        </div>
        <div class="cards-container" id="cards-regressions">
          ${data.categories.regressions.join('')}
        </div>
      </div>

      ${data.categories.unused.length > 0 ? `
      <div class="category-group" id="group-unused">
        <div class="category-header">
          <span>Unused Code</span>
          <span class="category-count" id="count-unused">${data.categories.unused.length}</span>
        </div>
        <div class="cards-container" id="cards-unused">
          ${data.categories.unused.join('')}
        </div>
      </div>` : ''}

      <!-- Needs Review -->
      <div class="category-group" id="group-needsReview" style="display: ${data.categories.needsReview.length > 0 ? 'block' : 'none'};">
        <div class="category-header">
          <span>Needs Review</span>
          <span class="category-count" id="count-needsReview">${data.categories.needsReview.length}</span>
        </div>
        <div class="cards-container" id="cards-needsReview">
          ${data.categories.needsReview.join('')}
        </div>
      </div>

      <!-- Resolved History -->
      <div class="category-group" id="group-resolved" style="display: ${data.categories.resolved.length > 0 ? 'block' : 'none'};">
        <div class="category-header">
          <span>Resolved</span>
          <span class="category-count" id="count-resolved">${data.categories.resolved.length}</span>
        </div>
        <div class="cards-container" id="cards-resolved">
          ${data.categories.resolved.join('')}
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Attach finding card click listeners
    function attachCardListeners(root = document) {
      root.querySelectorAll('.finding-card').forEach(card => {
        if (card.dataset.listenerAttached) return;
        card.dataset.listenerAttached = 'true';
        card.addEventListener('click', () => {
          const findingId = card.getAttribute('data-finding-id');
          if (findingId) {
            vscode.postMessage({ type: 'openFinding', findingId });
          }
        });
      });
    }
    attachCardListeners();

    // Header controls
    document.getElementById('btn-panel')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openProblemsPanel' });
    });
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    // Summary Card filters
    document.querySelectorAll('.metric-card').forEach(card => {
      card.addEventListener('click', () => {
        const filter = card.getAttribute('data-filter');
        vscode.postMessage({ type: 'setCardFilter', filter });
      });
    });

    document.getElementById('btn-clear-filter')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearFilters' });
    });

    // Live State Update Message Listener (Zero DOM Teardown = Zero Blinking & Preserved Scroll)
    window.addEventListener('message', event => {
      const msg = event.data;
      if (!msg || msg.type !== 'stateUpdate') return;

      const data = msg.data;
      if (!data) return;

      // 1. Update Header Status
      const statusBadge = document.getElementById('status-badge');
      const statusText = document.getElementById('status-text');
      if (statusBadge && statusText) {
        statusBadge.className = 'status-badge ' + data.statusClass;
        statusText.textContent = data.statusText;
      }

      // 2. Update Header Count Pill
      const countPill = document.getElementById('header-count-pill');
      if (countPill) {
        countPill.textContent = data.totalActive + (data.totalActive === 1 ? ' issue' : ' issues');
        if (data.totalActive > 0) {
          countPill.classList.add('has-issues');
        } else {
          countPill.classList.remove('has-issues');
        }
      }

      // 3. Update Metric Numbers
      const newCard = document.querySelector('.metric-card.new .metric-value');
      const critCard = document.querySelector('.metric-card.critical .metric-value');
      const filesCard = document.querySelector('.metric-card.files .metric-value');
      const resCard = document.querySelector('.metric-card.resolved .metric-value');
      if (newCard) newCard.textContent = data.metrics.newCount;
      if (critCard) critCard.textContent = data.metrics.criticalCount;
      if (filesCard) filesCard.textContent = data.metrics.affectedFiles;
      if (resCard) resCard.textContent = data.metrics.resolvedCount;

      // 4. Update Filter Active Card
      document.querySelectorAll('.metric-card').forEach(card => {
        const f = card.getAttribute('data-filter');
        if (f === data.cardFilter) {
          card.classList.add('active');
        } else {
          card.classList.remove('active');
        }
      });

      // 5. Update Empty State
      const emptyState = document.getElementById('empty-state');
      if (emptyState) {
        emptyState.style.display = data.totalActive === 0 ? 'block' : 'none';
      }

      // 6. Update Categories smoothly
      const cats = ['breaking', 'securityAndLogic', 'regressions', 'unused', 'needsReview', 'resolved'];
      const scrollContainer = document.getElementById('scroll-container');
      const savedScroll = scrollContainer ? scrollContainer.scrollTop : 0;

      for (const catKey of cats) {
        const group = document.getElementById('group-' + catKey);
        const countEl = document.getElementById('count-' + catKey);
        const cardsContainer = document.getElementById('cards-' + catKey);
        const cardHtmlList = data.categories[catKey] || [];

        if (group && countEl && cardsContainer) {
          if (cardHtmlList.length === 0) {
            group.style.display = 'none';
          } else {
            group.style.display = 'block';
            countEl.textContent = cardHtmlList.length;
            const newHtml = cardHtmlList.join('');
            if (cardsContainer.dataset.cachedHtml !== newHtml) {
              cardsContainer.innerHTML = newHtml;
              cardsContainer.dataset.cachedHtml = newHtml;
              attachCardListeners(cardsContainer);
            }
          }
        }
      }

      // Restore exact scroll position if altered by layout shift
      if (scrollContainer && scrollContainer.scrollTop !== savedScroll) {
        scrollContainer.scrollTop = savedScroll;
      }
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
