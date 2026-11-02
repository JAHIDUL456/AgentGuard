import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentGuardEngine } from '../../core/engine';
import { Finding, FindingLocation } from '../../core/types';
import { FindingManager } from '../../findings/finding-manager';
import { ChangeMonitor } from '../../monitoring/change-monitor';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import {
  COMMAND_APPLY_QUICK_FIX,
  COMMAND_COPY_FIX_PROMPT,
  COMMAND_IGNORE_FINDING,
  COMMAND_RECHECK_FINDING,
  COMMAND_SCAN_WORKSPACE,
  COMMAND_SHOW_FINDING_DIFF,
  COMMAND_TOGGLE_MONITORING,
} from '../commands/command-ids';
import { NavigationService } from '../navigation/navigation-service';

export type GroupByOption = 'none' | 'severity' | 'category' | 'file' | 'root-cause';
export type FilterOption = 'all' | 'active' | 'errors' | 'warnings' | 'security' | 'unused' | 'resolved';

export class IssuesPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentguard.issuesView';

  private _view?: vscode.WebviewView;
  private _selectedFindingId?: string;
  private _groupBy: GroupByOption = 'severity';
  private _filterBy: FilterOption = 'active';
  private _searchQuery: string = '';

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
        case 'selectFinding':
          this._selectedFindingId = message.findingId;
          this.update();
          break;
        case 'openSource': {
          const finding = this._findFinding(message.findingId);
          if (finding) {
            await NavigationService.openFinding(finding);
          }
          break;
        }
        case 'openLocation': {
          const loc = message.location as FindingLocation;
          if (loc && loc.uri) {
            await NavigationService.openLocation({
              ...loc,
              uri: vscode.Uri.file(loc.filePath),
            });
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
        case 'applyQuickFix': {
          const finding = this._findFinding(message.findingId);
          if (finding) {
            await vscode.commands.executeCommand(COMMAND_APPLY_QUICK_FIX, finding);
          }
          break;
        }
        case 'recheckIssue': {
          const finding = this._findFinding(message.findingId);
          if (finding) {
            await vscode.commands.executeCommand(COMMAND_RECHECK_FINDING, finding);
          }
          break;
        }
        case 'ignoreIssue': {
          const finding = this._findFinding(message.findingId);
          if (finding) {
            await vscode.commands.executeCommand(COMMAND_IGNORE_FINDING, finding);
          }
          break;
        }
        case 'viewDiff': {
          const finding = this._findFinding(message.findingId);
          if (finding) {
            await vscode.commands.executeCommand(COMMAND_SHOW_FINDING_DIFF, finding);
          }
          break;
        }
        case 'setFilter':
          this._filterBy = message.filter as FilterOption;
          this.update();
          break;
        case 'setGrouping':
          this._groupBy = message.groupBy as GroupByOption;
          this.update();
          break;
        case 'setSearch':
          this._searchQuery = message.query;
          this.update();
          break;
      }
    });

    this.update();
  }

  public selectFinding(findingId: string): void {
    this._selectedFindingId = findingId;
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

    // 1. Status and counts
    const isMonitoring = this._changeMonitor.isEnabled();
    const isAnalyzing = this._engine.state === 'analyzing';
    const statusText = isAnalyzing
      ? 'Checking changes...'
      : !isMonitoring
      ? 'Monitoring Paused'
      : 'Monitoring';

    const criticalCount = allFindings.filter(f => f.severity === 'error').length;
    const warningCount = allFindings.filter(f => f.severity === 'warning').length;
    const reviewCount = allFindings.filter(f => f.severity === 'info').length;
    const resolvedCount = resolvedFindings.length;

    // 2. Filter findings
    let filtered: Finding[] = [];
    if (this._filterBy === 'all') {
      filtered = [...allFindings, ...resolvedFindings];
    } else if (this._filterBy === 'active') {
      filtered = [...allFindings];
    } else if (this._filterBy === 'errors') {
      filtered = allFindings.filter(f => f.severity === 'error');
    } else if (this._filterBy === 'warnings') {
      filtered = allFindings.filter(f => f.severity === 'warning');
    } else if (this._filterBy === 'security') {
      filtered = allFindings.filter(
        f =>
          f.category === 'logic-risk' ||
          f.ruleId?.startsWith('silent-regression') ||
          f.ruleId?.startsWith('watchdog')
      );
    } else if (this._filterBy === 'unused') {
      filtered = allFindings.filter(f => f.category === 'unused-code');
    } else if (this._filterBy === 'resolved') {
      filtered = [...resolvedFindings];
    }

    if (this._searchQuery.trim().length > 0) {
      const q = this._searchQuery.toLowerCase();
      filtered = filtered.filter(
        f =>
          f.title.toLowerCase().includes(q) ||
          f.location.filePath.toLowerCase().includes(q) ||
          f.explanation.toLowerCase().includes(q) ||
          (f.ruleId && f.ruleId.toLowerCase().includes(q))
      );
    }

    // Default selection
    if (!this._selectedFindingId || !filtered.some(f => f.id === this._selectedFindingId)) {
      this._selectedFindingId = filtered[0]?.id;
    }
    const selectedFinding = this._findFinding(this._selectedFindingId ?? '');

    // 3. Group findings
    const grouped = this._groupFindings(filtered, this._groupBy);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentGuard — Codebase Issues</title>
  <style nonce="${nonce}">
    :root {
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      --font-size: var(--vscode-font-size, 12px);
      --border-color: var(--vscode-panel-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.2)));
      --bg: var(--vscode-panel-background, var(--vscode-editor-background));
      --hover-bg: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08));
      --active-bg: var(--vscode-list-activeSelectionBackground, rgba(0, 122, 204, 0.25));
      --active-fg: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
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
      background-color: var(--bg);
      line-height: 1.4;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* Top Action Bar */
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
      gap: 12px;
      flex-wrap: wrap;
    }
    .top-bar-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .panel-brand {
      font-weight: 700;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 7px;
      border-radius: 12px;
      font-size: 11px;
      background: var(--hover-bg);
      border: 1px solid var(--border-color);
    }
    .counts-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
    }
    .count-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 500;
    }
    .count-badge.critical { color: var(--critical-color); }
    .count-badge.warning { color: var(--warning-color); }
    .count-badge.review { color: var(--review-color); }
    .count-badge.resolved { color: var(--resolved-color); }

    /* Controls Bar */
    .controls-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      background: var(--hover-bg);
      border-bottom: 1px solid var(--border-color);
      gap: 8px;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .search-box {
      display: flex;
      align-items: center;
      position: relative;
      flex: 1;
      max-width: 280px;
    }
    .search-input {
      width: 100%;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--border-color));
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 11px;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--vscode-focusBorder);
    }
    .filter-pills {
      display: flex;
      gap: 4px;
      align-items: center;
      overflow-x: auto;
    }
    .filter-pill {
      background: var(--bg);
      border: 1px solid var(--border-color);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    .filter-pill:hover {
      background: var(--hover-bg);
    }
    .filter-pill.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .group-select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, var(--border-color));
      padding: 3px 6px;
      border-radius: 3px;
      font-size: 11px;
    }

    /* Master-Detail Split Container */
    .split-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    @media (max-width: 720px) {
      .split-container {
        flex-direction: column;
      }
    }

    /* Left: Issues List */
    .issues-list-pane {
      flex: 1;
      border-right: 1px solid var(--border-color);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .group-header {
      padding: 6px 12px;
      background: var(--hover-bg);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .issue-row {
      display: flex;
      align-items: center;
      padding: 7px 12px;
      border-bottom: 1px solid var(--border-color);
      cursor: pointer;
      gap: 8px;
      transition: background 0.1s ease;
    }
    .issue-row:hover {
      background: var(--hover-bg);
    }
    .issue-row.selected {
      background: var(--active-bg);
      color: var(--active-fg);
    }
    .issue-severity-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .issue-severity-dot.error { background: var(--critical-color); }
    .issue-severity-dot.warning { background: var(--warning-color); }
    .issue-severity-dot.info { background: var(--review-color); }
    .issue-severity-dot.resolved { background: var(--resolved-color); }

    .issue-main-info {
      flex: 1;
      min-width: 0;
    }
    .issue-row-title {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 12px;
    }
    .issue-row-sub {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-top: 1px;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .issue-impact-tag {
      background: rgba(241, 76, 76, 0.15);
      color: var(--critical-color);
      padding: 1px 4px;
      border-radius: 2px;
      font-size: 9px;
      font-weight: 600;
      font-family: var(--font-family);
    }

    /* Right: Details Pane */
    .details-pane {
      flex: 1.2;
      overflow-y: auto;
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: var(--bg);
    }
    .detail-header {
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 10px;
    }
    .detail-title {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .detail-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .quick-actions-bar {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .action-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 1px solid transparent;
      padding: 4px 10px;
      border-radius: 3px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .action-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .action-btn.secondary {
      background: var(--hover-bg);
      color: var(--vscode-foreground);
      border-color: var(--border-color);
    }
    .action-btn.secondary:hover {
      background: rgba(128, 128, 128, 0.2);
    }

    /* 6-Question Breakdown Cards */
    .section-card {
      background: var(--hover-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 10px 12px;
    }
    .section-question {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .section-answer {
      font-size: 12px;
      line-height: 1.5;
    }
    .code-block {
      background: var(--vscode-editor-background);
      border: 1px solid var(--border-color);
      padding: 8px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-all;
      margin-top: 6px;
    }
    .location-link {
      color: var(--review-color);
      cursor: pointer;
      text-decoration: underline;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      text-align: center;
      padding: 40px 20px;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <!-- Top Bar -->
  <div class="top-bar">
    <div class="top-bar-left">
      <span class="panel-brand">🛡️ AgentGuard — Codebase Issues</span>
      <span class="status-pill">${statusText}</span>
    </div>
    <div class="counts-row">
      <span class="count-badge critical">🔴 ${criticalCount} Critical</span>
      <span class="count-badge warning">🟡 ${warningCount} Warnings</span>
      <span class="count-badge review">ℹ️ ${reviewCount} Review</span>
      <span class="count-badge resolved">✅ ${resolvedCount} Resolved</span>
      <button class="action-btn secondary" id="btn-refresh" title="Run safety recheck">🔄 Refresh</button>
      <button class="action-btn secondary" id="btn-toggle-mon">${isMonitoring ? '⏸️ Pause' : '▶️ Resume'}</button>
    </div>
  </div>

  <!-- Controls Bar -->
  <div class="controls-bar">
    <div class="search-box">
      <input type="text" class="search-input" id="search-input" placeholder="Search by file, symbol, or title..." value="${this._escape(this._searchQuery)}">
    </div>
    <div class="filter-pills">
      <button class="filter-pill ${this._filterBy === 'active' ? 'active' : ''}" data-filter="active">Active (${allFindings.length})</button>
      <button class="filter-pill ${this._filterBy === 'errors' ? 'active' : ''}" data-filter="errors">Errors (${criticalCount})</button>
      <button class="filter-pill ${this._filterBy === 'warnings' ? 'active' : ''}" data-filter="warnings">Warnings (${warningCount})</button>
      <button class="filter-pill ${this._filterBy === 'security' ? 'active' : ''}" data-filter="security">Security & Logic</button>
      <button class="filter-pill ${this._filterBy === 'unused' ? 'active' : ''}" data-filter="unused">Unused</button>
      <button class="filter-pill ${this._filterBy === 'resolved' ? 'active' : ''}" data-filter="resolved">Resolved (${resolvedCount})</button>
      <button class="filter-pill ${this._filterBy === 'all' ? 'active' : ''}" data-filter="all">All</button>
    </div>
    <div class="group-select-container">
      <label style="font-size: 11px; margin-right: 4px;">Group:</label>
      <select class="group-select" id="group-select">
        <option value="severity" ${this._groupBy === 'severity' ? 'selected' : ''}>Severity</option>
        <option value="category" ${this._groupBy === 'category' ? 'selected' : ''}>Category</option>
        <option value="file" ${this._groupBy === 'file' ? 'selected' : ''}>File</option>
        <option value="root-cause" ${this._groupBy === 'root-cause' ? 'selected' : ''}>Root Cause</option>
        <option value="none" ${this._groupBy === 'none' ? 'selected' : ''}>None</option>
      </select>
    </div>
  </div>

  <!-- Master-Detail Split -->
  <div class="split-container">
    <!-- Left: Issues List -->
    <div class="issues-list-pane" id="issues-list" tabindex="0">
      ${
        filtered.length === 0
          ? `<div class="empty-state">
              <span style="font-size: 28px; margin-bottom: 8px; color: var(--resolved-color);">✓</span>
              <strong>No new regressions detected.</strong>
              <div style="font-size: 11px; margin-top: 4px;">Zero matching issues found for current filter.</div>
            </div>`
          : ''
      }

      ${grouped
        .map(
          g => `
        <div class="group-header">
          <span>${this._escape(g.name)}</span>
          <span style="opacity: 0.7;">${g.items.length}</span>
        </div>
        ${g.items
          .map(item => {
            const isSel = item.id === this._selectedFindingId;
            const line = item.location.range ? item.location.range.start.line + 1 : undefined;
            const locStr = line ? `${path.basename(item.location.filePath)}:${line}` : path.basename(item.location.filePath);
            const affectedCount = item.relatedLocations?.length ?? 0;

            return `
              <div class="issue-row ${isSel ? 'selected' : ''}" data-finding-id="${item.id}" tabindex="0">
                <span class="issue-severity-dot ${item.status === 'resolved' ? 'resolved' : item.severity}"></span>
                <div class="issue-main-info">
                  <div class="issue-row-title">${this._escape(item.title)}</div>
                  <div class="issue-row-sub">
                    <span>${this._escape(locStr)}</span>
                    ${affectedCount > 0 ? `<span class="issue-impact-tag">${affectedCount} consumer${affectedCount === 1 ? '' : 's'} affected</span>` : ''}
                    <span style="text-transform: capitalize;">${item.status ?? 'active'}</span>
                  </div>
                </div>
              </div>
            `;
          })
          .join('')}
      `
        )
        .join('')}
    </div>

    <!-- Right: Details Pane -->
    <div class="details-pane">
      ${
        selectedFinding
          ? this._renderDetails(selectedFinding)
          : `<div class="empty-state">Select an issue on the left to inspect its root-cause breakdown and remediation actions.</div>`
      }
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('btn-refresh')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('btn-toggle-mon')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleMonitoring' });
    });

    document.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter');
        vscode.postMessage({ type: 'setFilter', filter });
      });
    });

    document.getElementById('group-select')?.addEventListener('change', (e) => {
      const groupBy = e.target.value;
      vscode.postMessage({ type: 'setGrouping', groupBy });
    });

    let searchTimeout;
    document.getElementById('search-input')?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        vscode.postMessage({ type: 'setSearch', query: e.target.value });
      }, 200);
    });

    document.querySelectorAll('.issue-row').forEach(row => {
      row.addEventListener('click', () => {
        const findingId = row.getAttribute('data-finding-id');
        vscode.postMessage({ type: 'selectFinding', findingId });
      });
      row.addEventListener('dblclick', () => {
        const findingId = row.getAttribute('data-finding-id');
        vscode.postMessage({ type: 'openSource', findingId });
      });
    });

    // Quick Actions
    document.getElementById('btn-open-source')?.addEventListener('click', () => {
      const id = document.getElementById('btn-open-source').getAttribute('data-finding-id');
      vscode.postMessage({ type: 'openSource', findingId: id });
    });
    document.getElementById('btn-copy-prompt')?.addEventListener('click', () => {
      const id = document.getElementById('btn-copy-prompt').getAttribute('data-finding-id');
      vscode.postMessage({ type: 'copyFixPrompt', findingId: id });
    });
    document.getElementById('btn-recheck')?.addEventListener('click', () => {
      const id = document.getElementById('btn-recheck').getAttribute('data-finding-id');
      vscode.postMessage({ type: 'recheckIssue', findingId: id });
    });
    document.getElementById('btn-ignore')?.addEventListener('click', () => {
      const id = document.getElementById('btn-ignore').getAttribute('data-finding-id');
      vscode.postMessage({ type: 'ignoreIssue', findingId: id });
    });
    document.getElementById('btn-quick-fix')?.addEventListener('click', () => {
      const id = document.getElementById('btn-quick-fix').getAttribute('data-finding-id');
      vscode.postMessage({ type: 'applyQuickFix', findingId: id });
    });
    document.getElementById('btn-view-diff')?.addEventListener('click', () => {
      const id = document.getElementById('btn-view-diff').getAttribute('data-finding-id');
      vscode.postMessage({ type: 'viewDiff', findingId: id });
    });

    // Keyboard navigation (Arrow keys up/down)
    const list = document.getElementById('issues-list');
    list?.addEventListener('keydown', (e) => {
      const rows = Array.from(document.querySelectorAll('.issue-row'));
      const activeIdx = rows.findIndex(r => r.classList.contains('selected'));
      if (e.key === 'ArrowDown' && activeIdx < rows.length - 1) {
        rows[activeIdx + 1].click();
        rows[activeIdx + 1].scrollIntoView({ block: 'nearest' });
        e.preventDefault();
      } else if (e.key === 'ArrowUp' && activeIdx > 0) {
        rows[activeIdx - 1].click();
        rows[activeIdx - 1].scrollIntoView({ block: 'nearest' });
        e.preventDefault();
      } else if (e.key === 'Enter' && activeIdx !== -1) {
        const findingId = rows[activeIdx].getAttribute('data-finding-id');
        vscode.postMessage({ type: 'openSource', findingId });
      }
    });
  </script>
</body>
</html>`;
  }

  private _renderDetails(f: Finding): string {
    const lineNum = f.location.range ? f.location.range.start.line + 1 : undefined;
    const locStr = lineNum ? `${f.location.filePath}:${lineNum}` : f.location.filePath;
    const related = f.relatedLocations ?? [];

    return `
      <div class="detail-header">
        <div class="detail-title">${this._escape(f.title)}</div>
        <div class="detail-meta">
          <span>📍 <code>${this._escape(locStr)}</code></span>
          <span>•</span>
          <span>Severity: <strong>${f.severity.toUpperCase()}</strong></span>
          <span>•</span>
          <span>Confidence: <strong>${f.confidence.toUpperCase()}</strong></span>
          ${f.evidenceClassification ? `<span>•</span><span>Classification: <strong>${this._escape(f.evidenceClassification)}</strong></span>` : ''}
        </div>

        <div class="quick-actions-bar">
          <button class="action-btn" id="btn-open-source" data-finding-id="${f.id}">📄 Open Source</button>
          <button class="action-btn secondary" id="btn-copy-prompt" data-finding-id="${f.id}">✨ Copy AI Fix Prompt</button>
          <button class="action-btn secondary" id="btn-view-diff" data-finding-id="${f.id}">🔍 View Diff</button>
          ${f.suggestedRemediation ? `<button class="action-btn secondary" id="btn-quick-fix" data-finding-id="${f.id}">⚡ Quick Fix</button>` : ''}
          <button class="action-btn secondary" id="btn-recheck" data-finding-id="${f.id}">🔄 Recheck</button>
          <button class="action-btn secondary" id="btn-ignore" data-finding-id="${f.id}">👁️ Ignore</button>
        </div>
      </div>

      <!-- 1. What Happened? -->
      <div class="section-card">
        <div class="section-question">1. What happened?</div>
        <div class="section-answer">${this._escape(f.explanation)}</div>
      </div>

      <!-- 2. Why? -->
      <div class="section-card">
        <div class="section-question">2. Why? (Root Cause)</div>
        <div class="section-answer">
          ${this._escape(f.message)}
          ${f.ruleId ? `<div style="margin-top: 4px; font-size: 11px; opacity: 0.8;">Rule: <code>${this._escape(f.ruleId)}</code> (${this._escape(f.sourceEngine)})</div>` : ''}
        </div>
      </div>

      <!-- 3. What Changed? (Code Evidence) -->
      ${
        f.evidence
          ? `<div class="section-card">
              <div class="section-question">3. What changed? (Change Evidence)</div>
              <div class="code-block">${this._escape(f.evidence)}</div>
            </div>`
          : ''
      }

      <!-- 4. What is Affected? -->
      <div class="section-card">
        <div class="section-question">4. What is affected?</div>
        <div class="section-answer">
          ${
            related.length > 0
              ? `<div>${related.length} dependent location(s) across the codebase:</div>
                 <ul style="margin-left: 18px; margin-top: 6px;">
                   ${related
                     .map(r => {
                       const rLine = r.range ? r.range.start.line + 1 : undefined;
                       const str = rLine ? `${r.filePath}:${rLine}` : r.filePath;
                       return `<li><code>${this._escape(str)}</code></li>`;
                     })
                     .join('')}
                 </ul>`
              : `<div>Primary file: <code>${this._escape(f.location.filePath)}</code> (Local impact)</div>`
          }
        </div>
      </div>

      <!-- 5. How to Fix It? -->
      <div class="section-card">
        <div class="section-question">5. How to fix it? (Remediation)</div>
        <div class="section-answer">
          ${
            f.suggestedRemediation
              ? this._escape(f.suggestedRemediation)
              : 'Inspect surrounding callers and types. Ensure removed exports or broken contracts are updated across all consumers.'
          }
        </div>
      </div>

      <!-- 6. Verification -->
      <div class="section-card">
        <div class="section-question">6. Verification State</div>
        <div class="section-answer">
          Status: <strong>${this._escape(f.status ?? 'open')}</strong> • Verification: <strong>${this._escape(f.verificationState ?? 'unverified')}</strong>
          <div style="font-size: 11px; margin-top: 4px; color: var(--vscode-descriptionForeground);">
            AgentGuard automatically clears verified-resolved findings upon subsequent file save or edit.
          </div>
        </div>
      </div>
    `;
  }

  private _groupFindings(
    findings: Finding[],
    groupBy: GroupByOption
  ): Array<{ name: string; items: Finding[] }> {
    if (groupBy === 'none') {
      return [{ name: 'All Issues', items: findings }];
    }

    const map = new Map<string, Finding[]>();

    for (const f of findings) {
      let key = 'Other';
      if (groupBy === 'severity') {
        key = f.status === 'resolved' ? 'Resolved' : f.severity === 'error' ? 'Critical' : f.severity === 'warning' ? 'Warning' : 'Review';
      } else if (groupBy === 'category') {
        key = f.category;
      } else if (groupBy === 'file') {
        key = path.basename(f.location.filePath);
      } else if (groupBy === 'root-cause') {
        key = f.ruleId ?? f.category;
      }

      const list = map.get(key) ?? [];
      list.push(f);
      map.set(key, list);
    }

    return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
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

