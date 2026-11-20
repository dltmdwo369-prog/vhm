// Inherited suites print assertions; a zero exit status alone is insufficient.
const {spawnSync} = require('node:child_process');
let failed = false, total = 0;
for (const file of ['test.js','test-completed-recovery.js','test-memo-images.js','test-consultations.js','test-phis.js','test-consultation-sync.js','test-consultation-delete.js','test-pencil.js','test-links.js','test-archive.js','test-notes.js','test-note-order.js','test-catalog.js','test-note-referrals.js','test-feedback.js','test-features.js','test-education.js']) {
  const result = spawnSync(process.execPath,[require('node:path').join(__dirname,file)],{encoding:'utf8',timeout:300000});
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  const passed = ((result.stdout || '').match(/^PASS /gm) || []).length; total += passed;
  const bad = result.status !== 0 || /^(FAIL|CRASH)\b/m.test(result.stdout || '') || !passed;
  console.log(`${bad ? 'FAILED' : 'COMPLETED'} ${file}: ${passed} assertions passed${result.error ? ' '+result.error.message : ''}`);
  if (bad) failed = true;
}
console.log(`TOTAL ${total} passing assertions; ${failed ? 'suite failures present' : 'all suites completed'}`);
process.exitCode = failed ? 1 : 0;
