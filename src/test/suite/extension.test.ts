import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const POLL_INTERVAL_MS = 500;
// First run may download the en dictionary through the server; CI
// pre-warms the cache, but keep the budget generous anyway.
const DIAGNOSTICS_TIMEOUT_MS = 90_000;

function fixtureUri(): vscode.Uri {
  return vscode.Uri.file(path.resolve(__dirname, '../../../test-fixture/misspelled.md'));
}

async function waitForDiagnostics(uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + DIAGNOSTICS_TIMEOUT_MS;
  for (;;) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (diagnostics.length > 0) {
      return diagnostics;
    }
    if (Date.now() >= deadline) {
      return diagnostics;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

suite('Kotoshu extension smoke test', function () {
  this.timeout(180_000);

  test('activates and publishes diagnostics for a misspelled word', async () => {
    const uri = fixtureUri();
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    const diagnostics = await waitForDiagnostics(uri);
    assert.ok(diagnostics.length > 0, 'expected at least one kotoshu diagnostic');
    assert.strictEqual(diagnostics[0].source, 'kotoshu');
    const messages = diagnostics.map((d) => d.message).join('\n');
    assert.ok(
      messages.includes('helo') || messages.includes('wrold'),
      `expected a known misspelling in diagnostics, got: ${messages}`,
    );
  });

  test('offers a Kotoshu code action on a misspelled word', async () => {
    const uri = fixtureUri();
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (diagnostics.length === 0) {
      assert.fail('no diagnostics available for the code action test');
    }
    // Not every flagged word has suggestions; pick one that does.
    const flagged = diagnostics.find(
      (d) => /helo|wrold/.test(d.message),
    );
    if (!flagged) {
      assert.fail(`no known misspelling among diagnostics: ${diagnostics.map((d) => d.message).join(' | ')}`);
    }
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      uri,
      flagged.range,
    );
    const titles = (actions ?? []).map((a) => a.title);
    assert.ok(
      titles.some((t) => t.startsWith('Kotoshu: change to')),
      `expected a Kotoshu replacement quickfix, got: ${titles.join(' | ')}`,
    );
    assert.ok(
      titles.some((t) => t.includes('personal dictionary')),
      `expected the personal dictionary action, got: ${titles.join(' | ')}`,
    );
  });
});
