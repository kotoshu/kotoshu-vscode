# Changelog

## 0.1.0 (unreleased)

Initial release.

- Runs the `kotoshu-lsp` language server over stdio for plaintext, Markdown,
  and AsciiDoc files.
- Server discovery: `kotoshu-lsp.serverPath` setting, then `bundle exec
  kotoshu-lsp` for Gemfile workspaces, then a global `kotoshu-lsp` on `PATH`,
  with an actionable install message when nothing resolves.
- Diagnostics, quick-fix code actions, and hover suggestions from the server.
- Client-side `kotoshu.addToPersonalDictionary` command writing
  `~/.config/kotoshu/personal.dic`.
- Experimental `kotoshu.checkCode` opt-in for source code files.

