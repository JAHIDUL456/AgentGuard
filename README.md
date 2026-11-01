# AgentGuard

> **"Install and forget. It watches your codebase, catches silent breaks, and flags hidden logic risks automatically."**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![VS Code Extension](https://img.shields.io/badge/VS%20Code-v1.90.0%2B-blueviolet.svg)](https://marketplace.visualstudio.com)
[![Offline First](https://img.shields.io/badge/Privacy-100%25%20Offline-success.svg)](SECURITY.md)

AgentGuard is an offline-first, zero-configuration codebase safety extension for Visual Studio Code. It operates quietly in the background, continuously watching file changes and Git diffs to detect newly introduced compiler errors, broken downstream dependencies in untouched files, and the accidental deletion of critical security guards (such as authentication middleware, authorization checks, validation branches, and error handling).

Whether code is edited by human developers, inline copilot auto-completions, or autonomous AI coding agents (such as Cursor, Claude Code, GitHub Copilot, ChatGPT, and Windsurf), AgentGuard flags risks at the exact moment they occur—before code is committed or deployed.

---

## Table of Contents

1. [Product Purpose](#1-product-purpose)
2. [Core Features](#2-core-features)
3. [Architecture Overview](#3-architecture-overview)
4. [Supported Language Capability Matrix](#4-supported-language-capability-matrix)
5. [Installation](#5-installation)
6. [Usage Guide](#6-usage-guide)
7. [Example Findings](#7-example-findings)
8. [Example Markdown Report](#8-example-markdown-report)
9. [Privacy & Offline-First Guarantee](#9-privacy--offline-first-guarantee)
10. [Limitations & Operational Boundaries](#10-limitations--operational-boundaries)
11. [Development Setup](#11-development-setup)
12. [Testing](#12-testing)
13. [Build & Packaging Instructions](#13-build--packaging-instructions)
14. [Contribution Guidelines](#14-contribution-guidelines)
15. [License](#15-license)

---

## 1. Product Purpose

Modern AI coding agents and automated refactoring tools excel at rapidly generating code, but frequently introduce subtle, silent failure modes:

- **Untouched Downstream Breaks**: Modifying or removing an export in one file silently breaks dependent files that were never opened during the editing session.
- **Compiler & Type Regressions**: Pre-existing warnings often mask newly introduced compiler errors, making it difficult to spot genuine regressions.
- **Accidental Safety Logic Deletion**: Refactoring prompts often inadvertently drop `@login_required` decorators, authorization role checks, input validation guards, or `try/catch` exception handlers to simplify the implementation.
- **Broken Semantic Contracts**: Renaming function signatures or modifying data structures without updating callers across the repository.

AgentGuard exists to eliminate these silent risks. It requires no configuration, no setup scripts, and no API keys:

$$\text{Install} \longrightarrow \text{Open Workspace} \longrightarrow \text{Start Coding}$$

---

## 2. Core Features

- **Autonomous File Monitoring**: Uses native VS Code `FileSystemWatcher` and document event listeners with intelligent debouncing, batching, and duplicate suppression. External batch edits made by background AI agents are coalesced into a single coherent analysis cycle.
- **Diagnostic Delta Tracking**: Captures language-server diagnostic baselines and tracks shifts across edits. Distinguishes newly introduced errors from pre-existing baseline issues with range-shift normalization.
- **Untouched File Blast-Radius Analysis**: Computes structural dependency graphs and diffs symbol exports against imports to identify untouched files broken by changed contracts.
- **Critical Logic & Safety Watchdog**: Uses pattern-based AST extraction to detect the deletion or weakening of authentication, authorization, validation, error handling, CSRF tokens, parameterized SQL queries, and type safety directives.
- **Refactor-Aware Noise Suppression**: Understands renames, relocations, and equivalent logic replacements across files, preventing false alarms when safeguards are intentionally refactored.
- **Native VS Code Interface**: Integrates directly into the VS Code Activity Bar with a dedicated shield view, custom Problem diagnostics, and real-time status bar updates.
- **Automatic Markdown Handoff**: Continuously maintains `.vscode/agentguard-report.md` with complete evidence, file locations, remediation instructions, and standardized AI prompt handoffs.
- **Secret & Token Redaction**: Automatically sanitizes JWTs, private keys, API tokens, and credentials from all generated reports.

---

## 3. Architecture Overview

AgentGuard is strictly decoupled into modular, single-responsibility subsystems. The core orchestration layer remains completely language-agnostic, while language-specific AST and dependency parsing is encapsulated in isolated adapters.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        VS Code Extension Host                          │
└──────┬───────────────────────────────┬──────────────────────────┬──────┘
       │ Event Stream                  │ Commands / Tree / Status │ Diagnostics
┌──────▼─────────────────────┐ ┌───────▼────────────────────────┐ │
│       ChangeMonitor        │ │             UI                 │ │
│  - FileSystemWatcher       │ │  - Activity Bar Shield Tree    │ │
│  - Document Change Events  │ │  - Real-Time Status Bar        │ │
│  - Debounce & Batch Queue  │ │  - Native Problems Diagnostics │ │
└──────────────┬─────────────┘ └────────────────▲───────────────┘ │
               │ Batched Changes                │ Updates         │
┌──────────────▼────────────────────────────────┴───────────────┐ │
│                      AgentGuardEngine                         │ │
│  - Central Orchestrator & State Machine                       │ │
│  - Multi-Root Workspace Lifecycle Management                  │ │
│  - Cancellation Tokens & Job Serialization                    │ │
└──────┬───────────────────────┬────────────────────────▲───────┘ │
       │ Diff Inspection       │ Engine Dispatch        │         │
┌──────▼─────────────┐ ┌───────▼──────────────────────┐ │         │
│     GitService     │ │    AnalysisEngineRegistry    │ │         │
│  - Diff Parser     │ │                              │ │         │
│  - Repo Root Cache │ │  1. DiagnosticDeltaEngine   ◄┼─────────┘
│  - Non-Git Fallback│ │  2. BlastRadiusEngine        │
└────────────────────┘ │  3. LogicWatchdogEngine      │
                       └───────────────┬──────────────┘
                                       │ AST & Symbols
                       ┌───────────────▼──────────────┐
                       │   LanguageAdapterRegistry    │
                       │  - TypeScript  - JavaScript  │
                       │  - Python      - PHP         │
                       │  - Go          - Rust        │
                       │  - Java        - C#          │
                       │  - Dart        - C / C++     │
                       └───────────────┬──────────────┘
                                       │ Findings
                       ┌───────────────▼──────────────┐
                       │        FindingManager        │
                       │  - Cross-Engine Deduplication│
                       │  - Stale Finding Cleanup     │
                       │  - Multi-Root Isolation      │
                       └───────────────┬──────────────┘
                                       │ Write Trigger
                       ┌───────────────▼──────────────┐
                       │      AutoReportManager       │
                       │  - Atomic Safe File I/O      │
                       │  - Secret & Token Sanitizer  │
                       │  - .vscode/agentguard-report │
                       └──────────────────────────────┘
```

---

## 4. Supported Language Capability Matrix

AgentGuard provides built-in adapters for 11 programming languages. Analysis capability levels range from basic change monitoring (Level 1) to full structural semantic and diagnostic delta tracking (Level 4/5).

All adapters function **100% offline** without requiring external CLI tools or language servers to be pre-installed. When language servers are present in VS Code, AgentGuard automatically leverages their published diagnostics.

| Language | Capability Level | Supported Extensions | Project Manifest Indicators | Tooling Required | Known Limitations |
|:---|:---:|:---|:---|:---:|:---|
| **TypeScript** | **Level 4** | `.ts`, `.tsx`, `.mts`, `.cts` | `tsconfig.json` | None (Built-in) | Deep cross-file type resolution requires active TypeScript language server. |
| **JavaScript** | **Level 4** | `.js`, `.jsx`, `.mjs`, `.cjs` | `package.json`, `jsconfig.json` | None (Built-in) | Dynamic runtime `require()` calls with computed expressions cannot be statically resolved. |
| **Python** | **Level 3** | `.py`, `.pyi` | `pyproject.toml`, `requirements.txt`, `Pipfile`, `setup.py` | None (Built-in) | Dynamic imports (`importlib`) cannot be statically resolved; full type checks require Pyright/Mypy. |
| **Go** | **Level 3** | `.go` | `go.mod` | None (Built-in) | CGo embedded C bindings are not parsed; interface validation requires `gopls`. |
| **Rust** | **Level 3** | `.rs` | `Cargo.toml` | None (Built-in) | Complex procedural macro expansions cannot be analyzed without `rust-analyzer` or `cargo`. |
| **Java** | **Level 3** | `.java` | `pom.xml`, `build.gradle`, `build.gradle.kts` | None (Built-in) | Static annotation processing (Lombok, MapStruct) is not executed in static pass. |
| **C#** | **Level 3** | `.cs` | `*.sln`, `*.csproj` | None (Built-in) | Roslyn C# source generators and cross-file global using directives require OmniSharp. |
| **PHP** | **Level 3** | `.php` | `composer.json` | None (Built-in) | Dynamic magic methods (`__call`) cannot be statically resolved; classmaps require `composer dump-autoload`. |
| **Dart** | **Level 3** | `.dart` | `pubspec.yaml` | None (Built-in) | Generated code (`build_runner` part files) is parsed purely from source references. |
| **C** | **Level 3** | `.c`, `.h` | `CMakeLists.txt`, `Makefile` | None (Built-in) | Preprocessor conditionals (`#ifdef`) are evaluated syntactically without full compiler preprocessing. |
| **C++** | **Level 3** | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` | `CMakeLists.txt`, `Makefile` | None (Built-in) | Complex template metaprogramming substitutions require clangd or compiler AST. |

### Capability Level Definitions

- **Level 1 (Change Monitoring)**: Real-time file system tracking, debounce batching, and Git diff inspection.
- **Level 2 (Structural Analysis)**: AST parsing of classes, structs, interfaces, methods, functions, and symbols.
- **Level 3 (Dependency Analysis)**: Downstream import graph resolution, blast-radius calculation, and safety pattern rules.
- **Level 4 (Diagnostics Integration)**: Settling diagnostic delta comparison with normalized baseline tracking.
- **Level 5 (Deep Semantic Analysis)**: Full cross-file symbol resolution and type-hierarchy analysis.

---

## 5. Installation

### From VS Code Marketplace
1. Open Visual Studio Code.
2. Press `Ctrl+P` (macOS: `Cmd+P`) and type:
   ```text
   ext install agentguard.agentguard
   ```
3. Open your project workspace. AgentGuard activates automatically.

### Manual VSIX Installation
1. Download the latest `agentguard-0.1.0.vsix` release from GitHub Releases.
2. Install via command line:
   ```bash
   code --install-extension agentguard-0.1.0.vsix
   ```
   Or inside VS Code: **Extensions View (`Ctrl+Shift+X`) $\rightarrow$ `...` menu $\rightarrow$ Install from VSIX...**

---

## 6. Usage Guide

AgentGuard requires **zero configuration**. Once installed, it operates continuously:

### Automatic Workflows
- **On File Edit / Save**: AgentGuard batches edits, waits for the debounce quiet window (500ms), and runs incremental analysis.
- **On AI Coding Agent Modification**: When tools like Cursor, Claude Code, Copilot, or ChatGPT modify one or more files on disk, AgentGuard coalesces the changes into a single analysis batch.
- **Untouched File Analysis**: If an edited file alters an exported symbol, AgentGuard checks all untouched files importing that symbol and flags any potential breakage.
- **Safety Rule Inspection**: If an edit removes security guards (e.g. `@login_required`, `verifyToken`, `try/catch`), AgentGuard immediately inspects the diff and flags the logic risk.

### Native VS Code Interface
- **Activity Bar Icon**: Click the AgentGuard shield in the Activity Bar to open the **Codebase Safety** tree view.
- **Tree View Sections**:
  - `STATUS`: Displays current system state (`All Clear`, `Scanning...`, `Issues Detected`).
  - `CRITICAL`: High-confidence risks (e.g., removed authentication guards).
  - `WARNINGS`: Medium-confidence risks (e.g., broken downstream contracts).
  - `REVIEW`: Informational items and analysis limitations.
  - `LANGUAGES`: Detected languages, manifests, and capability levels for each workspace folder.
  - `RECENT ACTIVITY`: Chronological log of recent file changes and analysis timestamps.
- **Click to Navigate**: Clicking any finding in the tree view immediately opens the file and highlights the affected lines.
- **Problems Tab Integration**: Findings are automatically published as native VS Code Diagnostics in the Problems tab (`Ctrl+Shift+M` / `Cmd+Shift+M`).

### Command Palette Commands
Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) to run:
- `AgentGuard: Scan Workspace` — Triggers an on-demand full workspace safety scan.
- `AgentGuard: Generate Safety Report` — Generates and opens `.vscode/agentguard-report.md`.
- `AgentGuard: Clear Findings` — Clears current active findings from the UI.
- `AgentGuard: Show Output Log` — Opens the AgentGuard output log channel.
- `AgentGuard: Focus Sidebar View` — Focuses the Codebase Safety tree view in the sidebar.

---

## 7. Example Findings

### Example 1: Critical Logic Removal (Authentication Bypass)
```text
[CRITICAL] Suspicious Removal of Authentication Check
File: src/controllers/billing.controller.ts:42
Category: critical-logic
Confidence: High
Evidence:
  - Removed 'requireAuth' middleware from 'POST /api/billing/charge'
  - No equivalent authentication check found in modified file
Remediation:
  Restore 'requireAuth' middleware or verify authorization is enforced upstream.
```

### Example 2: Untouched File Blast-Radius (Broken Downstream Import)
```text
[WARNING] Downstream Reference Broken in Untouched File
File: src/frontend/dashboard.tsx:18
Category: blast-radius
Confidence: High
Evidence:
  - Exported symbol 'UserProfile' was renamed or removed in 'src/types/user.ts'
  - Untouched file 'dashboard.tsx' imports 'UserProfile' from 'src/types/user.ts'
Remediation:
  Update import statement or symbol reference in 'dashboard.tsx' to match 'src/types/user.ts'.
```

### Example 3: Diagnostic Regression (Newly Introduced Compiler Error)
```text
[WARNING] Newly Introduced Diagnostic Error
File: src/services/order.ts:87
Category: diagnostic-regression
Confidence: High
Evidence:
  - Diagnostic code: TS2345
  - Message: Argument of type 'string' is not assignable to parameter of type 'number'.
  - Source: typescript
Remediation:
  Correct the parameter type in 'src/services/order.ts' to satisfy the function signature.
```

---

## 8. Example Markdown Report

AgentGuard automatically generates `.vscode/agentguard-report.md`. Below is an example of an generated report:

````markdown
# AgentGuard Codebase Safety Report

> **Notice**: This report was generated automatically by [AgentGuard](https://github.com/agentguard/agentguard).
> It reflects real-time analysis of file modifications, compiler diagnostics, and critical safety rules.

- **Generated**: 2026-11-01T23:30:00.000Z
- **Workspace**: my-service
- **Status**: 1 Critical Issue, 1 Warning

---

## Workspace Languages & Capabilities

- **TypeScript**: Level 4 (Diagnostics Integration) — `tsconfig.json`
- **Python**: Level 3 (Dependency Analysis) — `pyproject.toml`

---

## Active Findings

### [CRITICAL] Authentication Check Removed
- **File**: `src/auth/jwt.ts:24`
- **Category**: `critical-logic` | **Confidence**: High
- **Evidence**:
  - Removed call: `jwt.verify(token, secret)`
  - No alternative verification branch detected
- **Remediation**: Restore JWT verification or ensure validation occurs at gateway.

### [WARNING] Downstream Symbol Broken in Untouched File
- **File**: `src/reports/summary.ts:12`
- **Category**: `blast-radius` | **Confidence**: High
- **Evidence**:
  - Symbol `calculateMetrics` removed from `src/utils/math.ts`
  - Referenced in untouched file `src/reports/summary.ts`
- **Remediation**: Update call site in `src/reports/summary.ts`.

---

## AI Agent Handoff Instruction

> ### AI Agent Handoff Instruction
> Review this report. Investigate each finding. Fix confirmed errors. Inspect potential risks before changing code. Preserve existing application behavior. Run relevant tests after making changes.
````

---

## 9. Privacy & Offline-First Guarantee

AgentGuard is architected from the first line of code with an **uncompromising offline boundary**:

- **Zero Cloud APIs**: No data, telemetry, code snippets, file paths, or metrics are ever sent to remote servers.
- **Zero Telemetry**: Does not include analytics trackers, error reporters (e.g. Sentry), or usage statistics.
- **Zero AI API Dependencies**: All AST extraction, diff parsing, and rule evaluation run locally via JavaScript and native regex/parser heuristics.
- **Zero Accounts or Credentials**: Requires no sign-in, API keys, or subscriptions.
- **Air-Gapped Compatible**: Runs flawlessly on restricted enterprise workstations, classified environments, and air-gapped developer setups.
- **Secret Sanitization**: Generated reports automatically sanitize JWTs, private keys, authorization bearer tokens, and API credentials before writing to disk.

---

## 10. Limitations & Operational Boundaries

AgentGuard provides deterministic, lightweight heuristics rather than heavyweight cloud compilers. To maintain low memory usage and high responsiveness, it observes the following boundaries:

1. **Static Pattern Heuristics**: Dynamic runtime behaviors (e.g. Python `getattr()`, JavaScript `eval()`, PHP magic methods, Go `reflect`) cannot be statically determined without running the code.
2. **File Size Caps**: Files larger than 2MB are automatically skipped to prevent memory bloat and UI freezing.
3. **Language Server Dependency for Full Semantics**: Compiler-grade diagnostics depend on the corresponding VS Code language extension (e.g. TypeScript, Pyright, gopls) being active in the workspace.
4. **Git Repository Status**: When Git is not available, Git-specific diff comparisons fall back gracefully to in-memory document snapshots.

---

## 11. Development Setup

### Prerequisites
- [Node.js](https://nodejs.org) v20.x or higher
- [npm](https://www.npmjs.com) v10.x or higher
- [Visual Studio Code](https://code.visualstudio.com) v1.90.0 or higher

### Steps
1. Clone the repository:
   ```bash
   git clone https://github.com/agentguard/agentguard.git
   cd agentguard
   ```
2. Install development dependencies:
   ```bash
   npm install
   ```
3. Type-check strict TypeScript:
   ```bash
   npm run compile
   ```
4. Build extension bundle (esbuild):
   ```bash
   npm run build
   ```
5. Run in Extension Development Host:
   - Open the project in VS Code.
   - Press `F5` to start debugging. A new VS Code window will launch with the extension loaded.

---

## 12. Testing

AgentGuard maintains a comprehensive test suite containing **139+ Unit Tests** and **11 VS Code Extension Host Integration Tests**.

### Run Unit Tests
Unit tests use Mocha and run in an isolated in-memory mock environment:
```bash
npm test
```

### Run Integration Tests
Integration tests launch a real headless VS Code instance using `@vscode/test-electron` to verify end-to-end command registration, tree view rendering, diagnostic publishing, and language adapters:
```bash
npm run test:integration
```

### Run Performance Benchmarks
Benchmark tests measure activation duration, throughput, and memory stability:
```bash
npx mocha -r ./out/test/unit/setup.js --ui tdd out/test/unit/performance-benchmarks.test.js
```

---

## 13. Build & Packaging Instructions

### Production Build
Bundle and minify the extension using esbuild:
```bash
npm run package-prod
```

### Create VSIX Package
Package the extension for distribution using `@vscode/vsce`:
```bash
npm run package-extension
```
This generates `agentguard-0.1.0.vsix` containing only runtime code, icons, documentation, and metadata (excluding test files, build caches, and developer configs).

---

## 14. Contribution Guidelines

Contributions are welcome! Please review [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before submitting pull requests.

### Core Rules
- **Maintain Offline Boundary**: Pull requests introducing network calls, analytics, or external API requirements will not be accepted.
- **Strict TypeScript**: All code must compile with `strict: true` and zero compiler warnings.
- **Resource Management**: All event listeners, timers, and disposables must be registered through `DisposableStore`.
- **Test Coverage**: All bug fixes and features must include corresponding unit tests covering both positive and negative cases.

---

## 15. License

AgentGuard is licensed under the [MIT License](LICENSE).  
Copyright (c) 2026 AgentGuard Contributors.
