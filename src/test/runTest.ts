import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  // Modern VS Code expects a test folder containing index.js whose
  // exported run(testsRoot) drives the suite.
  const extensionTestsPath = path.resolve(__dirname, './suite');
  // Open the repo root as the workspace — it deliberately has no Gemfile,
  // so the extension takes the global kotoshu-lsp discovery path.
  const launchArgs = [extensionDevelopmentPath];

  try {
    await runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs });
  } catch (err) {
    console.error('vscode-test failed:', err);
    process.exit(1);
  }
}

void main();
