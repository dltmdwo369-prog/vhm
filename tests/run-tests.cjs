// The inherited suites report assertion failures in text; preserve those as failures.
const { spawnSync } = require('node:child_process');
let failed = false;
for (const file of ['test.js', 'test-links.js', 'test-archive.js', 'test-notes.js']) {
  const result = spawnSync(process.execPath, [require('node:path').join(__dirname, file)], { encoding: 'utf8', timeout: 300000 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0 || /^(FAIL|CRASH)\b/m.test(result.stdout || '') || !/^PASS /m.test(result.stdout || '')) failed = true;
}
process.exitCode = failed ? 1 : 0;
