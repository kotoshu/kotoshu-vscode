# kotoshu-vscode

Kotoshu spell checking for VS Code — a client extension that runs the
[kotoshu-lsp](https://github.com/kotoshu/kotoshu-lsp) language server and shows
its diagnostics, quick fixes, and hover suggestions while you edit.

[Kotoshu](https://github.com/kotoshu/kotoshu) 「言修」 is a semantic spell
checker with Hunspell-style dictionaries.

<!-- TODO(owner): demo GIF — record the lightbulb quick fixes on a misspelled
     Markdown file and drop it here:
     ![Kotoshu for VS Code](docs/demo.gif) -->

## What it does

For `plaintext`, `markdown`, and `asciidoc` files:

- **Diagnostics** — every misspelled word is underlined as you type, with the
  Kotoshu source and suggestions attached.
- **Quick fixes** — the lightbulb offers "Kotoshu: change to …" replacements
  plus "add word to personal dictionary".
- **Hover** — hovering a flagged word lists its top suggestions.

Honest scope: kotoshu-lsp 0.1 is a young server. Checking is whole-document
English (`en`); completion is not implemented. The `kotoshu.checkCode` setting
exists as an experimental opt-in for source code files, but the server has no
comment-only filtering yet, so expect false positives inside code.

## Requirements

- Ruby 3.1 or later.
- The server gem: `gem install kotoshu-lsp`
- On first use in a language, Kotoshu downloads its dictionary into
  `~/.cache/kotoshu/` (see the [Kotoshu README](https://github.com/kotoshu/kotoshu#readme)).
  Set `KOTOSHU_OFFLINE=1` to never download.

> **Note (2026-09):** the kotoshu-lsp 0.1.0 gem currently on RubyGems is
> **empty** — its file list was generated outside a git checkout, so the
> installed gem has no `kotoshu-lsp` executable. Until a fixed gem ships,
> install the server from source:
>
> ```bash
> git clone https://github.com/kotoshu/kotoshu-lsp.git
> cd kotoshu-lsp
> gem build kotoshu-lsp.gemspec
> gem install ./kotoshu-lsp-0.1.0.gem
> ```
>
> or point `kotoshu-lsp.serverPath` at a source checkout.

## Server discovery

The extension resolves the server in this order:

1. The `kotoshu-lsp.serverPath` setting — an explicit executable path.
2. `bundle exec kotoshu-lsp` — used automatically when the workspace contains
   a `Gemfile`.
3. A globally installed `kotoshu-lsp` found on `PATH`.

When none of these resolve, the extension shows an actionable message with an
install button (`gem install kotoshu-lsp`) — it never fails silently. After
installing, run **Kotoshu: Restart Language Server**.

## Commands

| Command | Purpose |
| --- | --- |
| `Kotoshu: Restart Language Server` | Restart after installing or upgrading the gem. |
| `Kotoshu: Add Word to Personal Dictionary` | Add the word under the cursor to `~/.config/kotoshu/personal.dic`. |

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `kotoshu-lsp.serverPath` | `""` | Explicit path to the `kotoshu-lsp` executable. |
| `kotoshu-lsp.trace` | `"off"` | LSP traffic tracing in the Kotoshu output channel: `off`, `messages`, `verbose`. |
| `kotoshu-lsp.logFile` | `""` | Server-side log path, passed as `KOTOSHU_LSP_LOG`. |
| `kotoshu.checkCode` | `false` | Experimental: also check source code files. Whole-file checking today — noisy. |

Changing `serverPath`, `logFile`, or `checkCode` restarts the server.

## How the extension bridges the server

Two VS Code realities needed client-side adapters, both implemented as
`vscode-languageclient` middleware:

- **languageId mapping** — kotoshu-lsp reads the languageId as a Kotoshu
  language code, but VS Code sends file types (`markdown`, `asciidoc`).
  The extension sends `plaintext` instead, which makes the server derive
  the natural language from the file extension (md/txt/adoc → `en`).
- **quickfix data** — the server attaches its suggestions to diagnostics
  as `data.suggestions`, but VS Code strips diagnostic `data` on the
  marker round-trip into a code action context. The extension re-injects
  the original diagnostics when code actions are requested so the
  server sees its own suggestions and can build the "change to …"
  quickfixes.

## Known limitations (v0.1)

- **Language**: the server derives the natural language from the file
  extension and currently ships `en` only.
- **Personal dictionary**: "add word" writes to `~/.config/kotoshu/personal.dic`
  (same file as the `kotoshu personal` CLI), but kotoshu-lsp 0.1 does not read
  the personal dictionary yet — existing diagnostics do not clear after adding
  a word.

## Development

```bash
npm install
npm run compile     # typecheck + esbuild bundle to dist/extension.js
npm test            # compile and run the VS Code integration tests
npm run package     # compile + vsce package -> kotoshu-vscode.vsix
```

Press F5 in VS Code to launch an Extension Development Host with the
extension loaded (see `.vscode/launch.json`; build first with
`npm run compile` or run the watch task).

The integration test opens `test-fixture/misspelled.md` and waits for real
diagnostics from a real `kotoshu-lsp` process, so a locally installed
`gem install kotoshu-lsp` is required to run `npm test` outside CI.

## License

BSD-2-Clause, same as [Kotoshu](https://github.com/kotoshu/kotoshu). See
[LICENSE](LICENSE).
