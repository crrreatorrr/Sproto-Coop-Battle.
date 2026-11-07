// Prints one JSON line. The goja runner and the browser test both load this
// after the server bundle, sha256.js, and scenarios.js.
const result = Scenarios.runAll();
if (result.loopHz !== 20 || result.substeps !== 3 || result.snapshotHz !== 10) throw new Error('limits');
console.log(JSON.stringify(result));
