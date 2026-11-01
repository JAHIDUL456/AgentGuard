# AgentGuard

> **"Install and forget. It watches your codebase, catches silent breaks, and flags hidden logic risks automatically."**

AgentGuard is an offline-first, zero-configuration codebase safety extension for Visual Studio Code. It continuously watches your workspace to detect silent regressions, logic degradation, and broken dependencies introduced by human developers or AI coding agents (such as Cursor, Claude Code, GitHub Copilot, ChatGPT, and Windsurf).

---

## Key Highlights

- **Offline-First & Private**: Operates 100% locally on your machine. Zero AI API keys, zero cloud endpoints, zero telemetry, zero mandatory configuration.
- **Agent-Agnostic Protection**: Guards your codebase whether code edits originate from humans, inline copilot completions, or autonomous AI agents editing files in the background.
- **Zero Configuration**: Normal workflow is simply: **Install → Open Workspace → Start Coding**.
- **Native VS Code Integration**: Seamlessly embeds into the Activity Bar, Status Bar, Output Channels, and Command Palette.

---

## Detection Scope (Vision & Roadmap)

AgentGuard is designed to detect four critical categories of silent regressions:

1. **Potentially Affected Untouched Files**: Identifies files that were not modified in the current session but whose behavior or contracts depend directly on modified code.
2. **Newly Introduced Compiler / Type / Syntax Errors**: Catches regressions in diagnostics across languages without requiring manual compile passes.
3. **Suspicious Removal of Logic**: Flags unexpected omission or tampering with authentication, authorization, validation, sanitization, and defensive error-handling code.
4. **Potentially Broken Dependencies**: Detects broken imports, package declaration mismatches, and severed cross-module references.

---

## Extension Interface

- **Activity Bar Shield Container**: An AgentGuard dedicated sidebar housing the **Codebase Safety** tree view.
- **Status Bar Indicator**: Real-time indication of codebase health (`$(shield) AgentGuard: Ready`).
- **Output Channel**: Structured logging accessible via the command palette or view menu for diagnostic tracking.
- **Safety Report Generator**: Export complete markdown reports summarizing codebase health and detected risks.

---

## Architectural Principles

```text
src/
├── core/            # Language-independent orchestration engine & state machine
├── workspace/       # Multi-root workspace lifecycle & state tracking
├── monitoring/      # Debounced file system & document change event monitoring
├── git/             # Git repository inspection & diff tracking foundation
├── languages/       # Language adapter interfaces & extensible registry
├── analysis/        # Modular analysis engine contracts & engine registry
├── findings/        # In-memory finding storage, filtering, and event notifications
├── ui/              # Native TreeDataProvider, Status Bar, and Command Handlers
├── reporting/       # Markdown safety report generation
└── utils/           # Cross-platform path formatting and debouncing utilities
```

- **Separation of Concerns**: Core engine is strictly language-agnostic. Language-specific logic resides solely in pluggable language adapters.
- **Deterministic Resource Management**: All event listeners, watchers, and UI components are strictly registered through `DisposableStore` patterns.
- **Strict TypeScript**: Full strictness (`strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`).

---

## Getting Started

### Development Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd AgentGuard
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the extension**:
   ```bash
   npm run build
   ```

4. **Run unit tests**:
   ```bash
   npm test
   ```

5. **Start watch mode**:
   ```bash
   npm run watch
   ```

6. **Launch in VS Code Debugger**:
   Press `F5` in VS Code to open an Extension Development Host window.

---

## Available Commands

| Command | Title | Description |
|---|---|---|
| `agentguard.scanWorkspace` | AgentGuard: Scan Workspace | Manually trigger a safety scan of the workspace. |
| `agentguard.generateReport` | AgentGuard: Generate Safety Report | Generates and opens a Markdown safety status report. |
| `agentguard.showOutput` | AgentGuard: Show Output Log | Reveals the AgentGuard Output Channel. |
| `agentguard.clearFindings` | AgentGuard: Clear Findings | Clears current findings from the view. |

---

## Extension Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `agentguard.enabled` | `boolean` | `true` | Enable or disable automated codebase safety monitoring. |
| `agentguard.logLevel` | `string` | `"info"` | Output logging verbosity (`debug`, `info`, `warn`, `error`). |

---

## License

This project is licensed under the MIT License.
