// Packaging gate: vsce only warns on missing repository/README metadata,
// so this script fails the build when the fields the marketplace requires
// are absent. Run by CI before `vsce package` and locally via
// `npm run check-manifest`.
import * as fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const missing = [];
if (!pkg.repository?.url) missing.push('repository.url');
if (!pkg.bugs?.url) missing.push('bugs.url');
if (!pkg.homepage) missing.push('homepage');
if (!pkg.publisher) missing.push('publisher');
if (!pkg.engines?.vscode) missing.push('engines.vscode');
if (!pkg.main) missing.push('main');
if (!fs.existsSync('README.md')) missing.push('README.md');
if (!fs.existsSync('LICENSE')) missing.push('LICENSE');
if (!fs.existsSync(pkg.main)) missing.push(`main entrypoint (${pkg.main})`);

if (missing.length > 0) {
  console.error(`package.json packaging gate failed, missing: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('package.json packaging gate passed.');
