#!/usr/bin/env node
// Fixture: a locally modified guard-commands.js.
//
// Stands in for a colleague who took the kit's guard and edited it. INSTALL.ps1
// must classify this as `Differs`, show a real diff, and only replace it on an
// explicit [a]. The marker below is what makes the difference visible.

const LOCAL_MODIFICATION = 'this user added their own rule here';

process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ decision: 'approve', reason: LOCAL_MODIFICATION }));
});
