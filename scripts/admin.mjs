import '../server/environment.mjs';
import { stdin, stdout, stderr } from 'node:process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { createStore } from '../server/store.mjs';
import { initializeAdmin } from '../server/accounts.mjs';

async function promptPassword() {
  // Read in terminal mode so the TTY does not echo; discard readline's rendering
  // and keep no line history. Prompts are printed separately, never with the input.
  const muted = new Writable({ write(_data, _encoding, done) { done(); } });
  const reader = createInterface({ input: stdin, output: muted, terminal: true, historySize: 0 });
  const cancel = new AbortController();
  const abort = () => cancel.abort();
  reader.once('SIGINT', abort);
  reader.once('close', abort);
  try {
    stderr.write('New administrator password (14+ characters, hidden): ');
    const password = await reader.question('', { signal: cancel.signal });
    stderr.write('\nRepeat password: ');
    const repeat = await reader.question('', { signal: cancel.signal });
    if (password !== repeat) throw new Error('Passwords do not match. No password was changed.');
    return password;
  } finally {
    reader.close();
    stderr.write('\n');
  }
}

try {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const configuredPassword = process.env.ADMIN_PASSWORD;
  const reset = process.argv.includes('--reset');
  const generate = process.argv.includes('--generate');
  const temporary = generate || process.argv.includes('--temporary');
  if (!email) throw new Error('Set ADMIN_EMAIL to the administrator’s email before running this command.');
  if (generate && (!stdin.isTTY || !stdout.isTTY)) {
    throw new Error('Use --generate in an interactive terminal so the temporary password is not written to redirected output.');
  }
  if (generate && configuredPassword) throw new Error('Remove ADMIN_PASSWORD before using --generate.');
  if (!generate && !configuredPassword && (!stdin.isTTY || !stderr.isTTY)) {
    throw new Error('Run npm run admin in a terminal to enter a hidden password, or supply ADMIN_PASSWORD through a private host environment.');
  }
  const store = createStore();
  const existing = store.state.users.find((user) => user.role === 'admin');
  if (existing && existing.email !== email) throw new Error('A different administrator already exists.');
  if (!existing && reset) throw new Error('No administrator exists yet. Run npm run admin without --reset.');
  if (existing && !reset) {
    console.log('The administrator already exists. Use npm run admin -- --reset to change the password.');
  } else {
    const password = generate ? randomBytes(24).toString('base64url') : configuredPassword || await promptPassword();
    await initializeAdmin(store, { email, password, reset, temporary });
    console.log(reset ? 'Administrator password changed. Previous sessions were signed out.' : 'The Curiousity administrator is ready.');
    if (generate) stdout.write(`Temporary administrator password (shown once): ${password}\n`);
    if (temporary) console.log('This password expires in 24 hours and must be replaced before using the workspace.');
    if (configuredPassword) console.log('Remove ADMIN_PASSWORD from the environment before starting the app.');
  }
} catch (err) {
  console.error(err.name === 'AbortError' ? 'Administrator setup cancelled.' : err.message);
  process.exitCode = 1;
}
