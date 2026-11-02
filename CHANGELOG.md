# Changelog

All notable changes to the **AgentGuard** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.1] - 2026-11-02

### Highlights
- **Ultra-Responsive Real-Time Monitoring**: AgentGuard now detects and analyzes code changes live in memory as you type (50ms adaptive debounce), eliminating the need to save files first.
- **Seamless Sidebar & UI Polish**: Replaced full sidebar webview reloads with `postMessage` DOM delta patching—no more scroll jumping or blinking while typing.
- **Zero Status Flicker**: Eliminated continuous "Checking changes..." status flipping during fast local typing checks.
- **Marketplace Metadata & Growth Enhancements**: Expanded category classification, 25 high-intent keywords, comprehensive comparison table, and interactive demo walkthrough.

### Added
- **Live In-Memory Buffer Detection (`DocumentContentReader`)**:
  - Prioritizes active unsaved editor buffers over disk contents across all analysis engines (Blast Radius, Watchdog, Scope Analyzer).
  - Keeps findings accurate and responsive during continuous typing sessions.
- **Adaptive Typing Debounce**:
  - Reduced typing debounce to 50ms with a 250ms burst timeout in `ChangeProcessor`.
- **Targeted Webview Delta Updates**:
  - Sidebar webview now applies updates incrementally via `postMessage`, preserving scroll position, hover states, and collapsed categories across keystrokes.

### Fixed
- **Watchdog & Blast Radius Baseline Caching**:
  - Fixed baseline cache advancing prematurely on every keystroke, ensuring critical logic deletion warnings (e.g. removed `@login_required`, deleted `await`) remain visible while typing until genuinely fixed.
- **Continuous Status Animation Loop**:
  - Isolated background typing checks from global UI status flips, preventing distracting header spinner flickering.
- **Sidebar Clutter**:
  - Removed redundant Pause and Refresh header buttons in favor of clean, automatic state synchronization.

---

## [2.0.0] - 2026-11-02

### Highlights
- **V2.0 Major Release**: Complete architectural overhaul delivering authoritative diagnostic accuracy, real-time finding lifecycles with automatic resolution, root-cause impact grouping, a redesigned Activity Bar sidebar, a dedicated bottom panel, and package size optimization (1.05 MB VSIX, ~74% reduction).

### Added
- **Dedicated AgentGuard Bottom Panel**:
  - Contributed native panel tab alongside Problems, Terminal, Output, and Debug Console.
  - Master-Detail layout with search, grouping (by Severity, Category, File, Root Cause), and filter pills.
  - Structured 6-question issue breakdown:
    1. *What happened?* (Plain-English explanation)
    2. *Why?* (Root cause & rule identifier)
    3. *What changed?* (Change evidence diff)
    4. *What is affected?* (Dependent consumer files & locations)
    5. *How to fix it?* (Remediation guidance)
    6. *Verification State* (`verified-breaking`, `verified-clean`, `unverified`)
  - Functional quick actions: Open Source, View Diff, Copy AI Fix Prompt, Recheck, Ignore, and Apply Quick Fix.
- **Redesigned Activity Bar Sidebar Experience**:
  - Minimal, information-dense interface using native VS Code theme variables.
  - Responsive 2-column summary cards (**New Issues**, **Critical Risks**, **Affected Files**, **Resolved**) functioning as clickable filters.
  - Categorized finding groups: Breaking Changes, New Regressions, Security & Logic, Unused Code, Needs Review, and Verified Resolved.
  - Empty state: clean, reassuring `No new regressions detected.`.
  - Removed clutter: language adapter lists, debug counters, and raw activity logs moved out of the primary view.
- **Silent Behavior Regression Watchdog (`SilentRegressionRule`)**:
  - Detects removed `await` keywords on asynchronous function calls (floating unhandled promises).
  - Detects newly introduced empty `catch {}` blocks swallowing exceptions.
  - Detects removed database transaction rollbacks (`tx.rollback()`, `abortTransaction()`).
  - Detects removed error re-throws and propagation.
  - Detects removed optional chaining operators (`?.`) replaced by direct property access.
- **Code-Change Impact Analysis (Root-Cause Grouping)**:
  - Groups multiple untouched consumer file breakages under a single root-cause finding with accurate reference counts and related locations.
- **Three-Level Analysis Engine**:
  - *Fast Local Analysis*: rapid local checks after edit pause.
  - *Incremental Dependency Analysis*: updates symbols and affected consumers on save/rename.
  - *Wider Analysis*: full repository verification during idle cycles or explicit user request.
- **Interactive Safety Demo (`agentguard.tryInteractiveDemo`)**:
  - Safe, isolated walkthrough running the real analysis pipeline on temporary fixtures without modifying user projects.
- **Simple 2-Line Editor Hover**:
  - Replaced verbose hovers with concise, actionable tooltips: bold title, explanation, direct `Fix:` guidance, and `Copy AI Fix Prompt` / `Open in Panel` actions.

### Fixed
- **Root-Cause Detection Accuracy (Prompt 1)**:
  - Resolved GraphQL identifier false positives where `GraphQLInt` was misidentified as `Graph` rename.
  - Fixed false-positive undefined variable errors on React `.map()` callback parameters.
  - Corrected lexical scope handling for arrow functions, closures, and object/array parameter destructuring.
  - Resolved JSX lowercase HTML elements and attributes being flagged as undeclared identifiers.
  - Corrected false-positive unused imports for `React` when JSX elements are present.
  - Fixed resolution of package subpath imports (e.g. `react-icons/fa`, `reactstrap`).
- **Race Conditions & In-Flight Cancellation (Prompt 2)**:
  - Added monotonic `currentGeneration` IDs and stale-result rejection, preventing older analyses from overwriting newer edits.
  - Connected `CancellationTokenSource` across all engines to abort obsolete scans immediately.
  - Implemented line-shift identity resilience (`_computeStableIdentity`), updating shifted findings in-place rather than creating duplicates.
  - Prevented infinite diagnostic loops by filtering out AgentGuard's own published diagnostics.

### Changed
- **Package Size Optimization**:
  - Minified and tree-shaken production bundle via esbuild.
  - Excluded minified libraries, source maps, test fixtures, and lockfiles from VSIX.
  - Packaged VSIX size reduced to **1.05 MB** (from ~4 MB baseline in V1).
- **Workspace Pollution Prevention**:
  - Automatic writing of `.vscode/agentguard-report.md` is now disabled by default (`agentguard.autoReport: false`).
  - Added manual Markdown export (`agentguard.generateReport`) and JSON export (`agentguard.exportJsonReport`).

---

## [0.1.0] - 2026-11-01

### Added
- Initial V1 release: core monitoring, language adapters, diagnostic delta, untouched file blast radius, watchdog, and basic tree UI.
