import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  CloseAction,
  DidOpenTextDocumentNotification,
  ErrorAction,
  ErrorHandler,
  LanguageClient,
  LanguageClientOptions,
  Range as ProtocolRange,
  ServerOptions,
  Trace,
  TransportKind,
} from 'vscode-languageclient/node';

const CLIENT_ID = 'kotoshu-lsp';

/**
 * Document selectors for the languages kotoshu-lsp handles today:
 * plain text, Markdown and AsciiDoc.
 */
const TEXT_LANGUAGES = ['plaintext', 'markdown', 'asciidoc'];

/**
 * Source-code languages the server maps to a natural language (by file
 * extension). Only consulted when `kotoshu.checkCode` is set. The server
 * checks the whole file text — comment-only filtering is not implemented
 * upstream yet.
 */
const CODE_LANGUAGES = ['ruby', 'python', 'javascript', 'typescript', 'go', 'rust', 'java'];

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel | undefined;

/**
 * The exact diagnostic objects the client created from the server's
 * publishDiagnostics notifications. These are ProtocolDiagnostic
 * instances that still carry `data.suggestions`.
 *
 * Why: VS Code's marker round-trip strips a diagnostic's `data` by the
 * time it comes back inside a CodeActionContext, so the server's
 * "change to …" quickfixes would never see the suggestions it
 * published. In provideCodeActions we swap the stripped context
 * diagnostics for these originals; the client's own converter then
 * serializes them — `data` included — without any hand-rolled wire
 * shapes.
 */
const diagnosticsByUri = new Map<string, Map<string, vscode.Diagnostic>>();

function rangeKey(range: vscode.Range): string {
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

export function activate(_context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Kotoshu');

  _context.subscriptions.push(
    vscode.commands.registerCommand('kotoshu.restartServer', () => void startClient()),
    vscode.commands.registerCommand(
      'kotoshu.addToPersonalDictionary',
      (uri?: unknown, range?: unknown) => void addWordToPersonalDictionary(uri, range),
    ),
    vscode.workspace.onDidChangeConfiguration(onConfigurationChanged),
  );

  void startClient();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

// ---------------------------------------------------------------------------
// Server discovery
// ---------------------------------------------------------------------------

interface ResolvedServer {
  command: string;
  args: string[];
  label: string;
}

/**
 * Resolve the kotoshu-lsp server, in order:
 *
 *   1. `kotoshu-lsp.serverPath` setting (explicit executable path)
 *   2. `bundle exec kotoshu-lsp` when a workspace folder has a Gemfile
 *   3. globally installed `kotoshu-lsp` found on PATH
 *
 * Returns undefined when nothing resolves — the caller must surface an
 * actionable message, never a silent no-op.
 */
function resolveServer(): ResolvedServer | undefined {
  const serverPath = getConfiguration<string>('kotoshu-lsp.serverPath', '');
  if (serverPath && serverPath.trim() !== '') {
    const expanded = expandHome(serverPath.trim());
    const absolute = path.isAbsolute(expanded)
      ? expanded
      : path.resolve(firstWorkspaceFolder() ?? process.cwd(), expanded);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      showInvalidServerPath(absolute);
      return undefined;
    }
    return { command: absolute, args: [], label: absolute };
  }

  const bundlerRoot = folderWithGemfile();
  if (bundlerRoot) {
    return { command: 'bundle', args: ['exec', 'kotoshu-lsp'], label: `bundle exec kotoshu-lsp (${bundlerRoot})` };
  }

  const globalBinary = findOnPath('kotoshu-lsp');
  if (globalBinary) {
    return { command: globalBinary, args: [], label: globalBinary };
  }

  return undefined;
}

function showMissingServerHelp(): void {
  void vscode.window
    .showErrorMessage(
      'Kotoshu: no kotoshu-lsp server found. Install it with: gem install kotoshu-lsp',
      'Install kotoshu-lsp',
      'Set server path',
    )
    .then((choice) => {
      if (choice === 'Install kotoshu-lsp') {
        const terminal = vscode.window.createTerminal('Kotoshu install');
        terminal.show();
        terminal.sendText('gem install kotoshu-lsp');
        void vscode.window.showInformationMessage(
          'When the install finishes, run "Kotoshu: Restart Language Server" from the command palette.',
        );
      } else if (choice === 'Set server path') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'kotoshu-lsp.serverPath');
      }
    });
}

function showInvalidServerPath(configured: string): void {
  void vscode.window
    .showErrorMessage(
      `Kotoshu: kotoshu-lsp.serverPath is set but the file does not exist: ${configured}`,
      'Open settings',
    )
    .then((choice) => {
      if (choice === 'Open settings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'kotoshu-lsp.serverPath');
      }
    });
}

function findOnPath(binary: string): string | undefined {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter((d) => d !== '');
  const candidates =
    process.platform === 'win32'
      ? [binary, `${binary}.cmd`, `${binary}.bat`, `${binary}.exe`]
      : [binary];
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          return full;
        }
      } catch {
        // Unreadable PATH entry — skip it.
      }
    }
  }
  return undefined;
}

function folderWithGemfile(): string | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const gemfile = path.join(folder.uri.fsPath, 'Gemfile');
    if (fs.existsSync(gemfile)) {
      return folder.uri.fsPath;
    }
  }
  // Multi-root workspaces opened via a .code-workspace file may keep the
  // Gemfile next to that file instead of inside a folder.
  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile?.scheme === 'file') {
    const gemfile = path.join(path.dirname(workspaceFile.fsPath), 'Gemfile');
    if (fs.existsSync(gemfile)) {
      return path.dirname(workspaceFile.fsPath);
    }
  }
  return undefined;
}

function firstWorkspaceFolder(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// ---------------------------------------------------------------------------
// Client lifecycle
// ---------------------------------------------------------------------------

async function startClient(): Promise<void> {
  const resolved = resolveServer();
  if (!resolved) {
    showMissingServerHelp();
    return;
  }

  if (client) {
    await client.stop();
    client = undefined;
  }
  diagnosticsByUri.clear();

  outputChannel?.appendLine(`Starting server: ${resolved.label}`);

  const serverOptions: ServerOptions = {
    command: resolved.command,
    args: resolved.args,
    transport: TransportKind.stdio,
    options: { env: serverEnv() },
  };

  client = new LanguageClient(
    CLIENT_ID,
    'Kotoshu Spell Checker',
    serverOptions,
    clientOptions(),
  );

  applyTraceSetting();

  client.start().catch((err) => {
    outputChannel?.appendLine(`Server failed to start: ${String(err)}`);
    showMissingServerHelp();
  });
}

function clientOptions(): LanguageClientOptions {
  const selector = [
    ...TEXT_LANGUAGES.map((language) => ({ language, scheme: 'file' })),
    ...TEXT_LANGUAGES.map((language) => ({ language, scheme: 'untitled' })),
    ...(getConfiguration<boolean>('kotoshu.checkCode', false)
      ? CODE_LANGUAGES.flatMap((language) => [
          { language, scheme: 'file' },
          { language, scheme: 'untitled' },
        ])
      : []),
  ];

  const errorHandler: ErrorHandler = {
    error: (_error, _message, count) => (count ?? 0) < 3
        ? { action: ErrorAction.Continue }
        : { action: ErrorAction.Shutdown, handled: true },
    closed: () => ({
      action: CloseAction.DoNotRestart,
      message:
        'kotoshu-lsp exited. Check the Kotoshu output channel, fix the cause, then run "Kotoshu: Restart Language Server".',
      handled: true,
    }),
  };

  return {
    documentSelector: selector,
    outputChannel: outputChannel!,
    traceOutputChannel: outputChannel,
    errorHandler,
    middleware: {
      // Keep the published diagnostics per URI (see diagnosticsByUri).
      handleDiagnostics: (uri, diagnostics, next) => {
        const byRange = new Map<string, vscode.Diagnostic>();
        for (const diagnostic of diagnostics) {
          byRange.set(rangeKey(diagnostic.range), diagnostic);
        }
        if (byRange.size > 0) {
          diagnosticsByUri.set(uri.toString(), byRange);
        } else {
          diagnosticsByUri.delete(uri.toString());
        }
        next(uri, diagnostics);
      },
      // kotoshu-lsp interprets the languageId as a Kotoshu language code
      // and has no dictionary named after a VS Code file type ("markdown"
      // is not a language). Sending "plaintext" makes the server derive
      // the natural language from the file extension instead (md, txt,
      // adoc -> "en"). See lib/kotoshu/lsp/server.rb, EXTENSION_TO_LANG.
      didOpen: (document, next) => {
        const languageClient = client;
        if (!languageClient) {
          return next(document);
        }
        return languageClient.sendNotification(DidOpenTextDocumentNotification.type, {
          textDocument: {
            uri: document.uri.toString(),
            languageId: 'plaintext',
            version: document.version,
            text: document.getText(),
          },
        });
      },
      // Swap the stripped context diagnostics for the originals that
      // still carry data.suggestions, then let the client's normal
      // conversion pipeline handle the request.
      provideCodeActions: (document, range, context, token, next) => {
        const stored = diagnosticsByUri.get(document.uri.toString());
        if (!stored || stored.size === 0 || context.diagnostics.length === 0) {
          return next(document, range, context, token);
        }
        const diagnostics = context.diagnostics.map(
          (diagnostic) => stored.get(rangeKey(diagnostic.range)) ?? diagnostic,
        );
        const patchedContext: vscode.CodeActionContext = { ...context, diagnostics };
        return next(document, range, patchedContext, token);
      },
    },
  };
}

function serverEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const logFile = getConfiguration<string>('kotoshu-lsp.logFile', '');
  if (logFile && logFile.trim() !== '') {
    const expanded = expandHome(logFile.trim());
    const absolute = path.isAbsolute(expanded)
      ? expanded
      : path.resolve(firstWorkspaceFolder() ?? process.cwd(), expanded);
    env.KOTOSHU_LSP_LOG = absolute;
  }
  return env;
}

function applyTraceSetting(): void {
  const trace = getConfiguration<string>('kotoshu-lsp.trace', 'off');
  void client?.setTrace(Trace.fromString(trace));
}

function onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
  if (event.affectsConfiguration('kotoshu-lsp.trace')) {
    applyTraceSetting();
  }
  if (
    event.affectsConfiguration('kotoshu-lsp.serverPath') ||
    event.affectsConfiguration('kotoshu-lsp.logFile') ||
    event.affectsConfiguration('kotoshu.checkCode')
  ) {
    void startClient();
  }
}

// ---------------------------------------------------------------------------
// Personal dictionary
// ---------------------------------------------------------------------------

/**
 * Add a word to the Kotoshu personal dictionary.
 *
 * The server emits a code action that invokes this command with
 * (uri, range) of the flagged word. When the user invokes the command
 * directly, the word under the cursor is used instead.
 *
 * Note: the file format mirrors Kotoshu::PersonalDictionary — one
 * lowercase word per line, sorted, unique, "#" comments allowed. The
 * current server build does not consult the personal dictionary yet, so
 * existing diagnostics do not clear; the file is picked up by the
 * `kotoshu personal` CLI today.
 */
async function addWordToPersonalDictionary(uriArg?: unknown, rangeArg?: unknown): Promise<void> {
  let document: vscode.TextDocument | undefined;
  let range: vscode.Range | undefined;

  if (typeof uriArg === 'string' && isProtocolRange(rangeArg) && client) {
    document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriArg));
    range = client.protocol2CodeConverter.asRange(rangeArg);
  } else {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      document = editor.document;
      range =
        editor.document.getWordRangeAtPosition(editor.selection.active) ?? editor.selection;
    }
  }

  if (!document || !range) {
    void vscode.window.showWarningMessage('Kotoshu: no word to add — place the cursor on a word first.');
    return;
  }

  const word = document.getText(range).trim();
  if (word === '' || /\s/.test(word)) {
    void vscode.window.showWarningMessage(`Kotoshu: "${word}" is not a single word.`);
    return;
  }

  const dictionaryPath = personalDictionaryPath();
  const added = writePersonalWord(dictionaryPath, word);
  if (added) {
    void vscode.window.showInformationMessage(
      `Kotoshu: added "${word}" to ${dictionaryPath}. Note: kotoshu-lsp does not read the personal dictionary yet, so the diagnostic stays until the server adds support.`,
    );
  } else {
    void vscode.window.showInformationMessage(`Kotoshu: "${word}" is already in ${dictionaryPath}.`);
  }
}

function personalDictionaryPath(): string {
  const override = process.env.KOTOSHU_PERSONAL_DIC;
  if (override && override.trim() !== '') {
    return override;
  }
  return path.join(os.homedir(), '.config', 'kotoshu', 'personal.dic');
}

function writePersonalWord(dictionaryPath: string, word: string): boolean {
  const lower = word.toLowerCase();
  const existing = fs.existsSync(dictionaryPath)
    ? fs
        .readFileSync(dictionaryPath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
    : [];
  if (existing.includes(lower)) {
    return false;
  }
  fs.mkdirSync(path.dirname(dictionaryPath), { recursive: true });
  fs.writeFileSync(dictionaryPath, [...existing, lower].sort().join('\n') + '\n', 'utf8');
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfiguration<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration().get<T>(key, defaultValue);
}

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function isProtocolRange(value: unknown): value is ProtocolRange {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const range = value as Record<string, unknown>;
  return (
    typeof range.start === 'object' &&
    range.start !== null &&
    typeof range.end === 'object' &&
    range.end !== null
  );
}
