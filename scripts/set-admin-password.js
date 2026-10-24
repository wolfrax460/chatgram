/**
 * Set (or reset) the Chatgram admin panel password.
 *
 * Run ON THE SERVER, by the owner, from the repository root:
 *
 *   cd ~/chatgram && node scripts/set-admin-password.js
 *
 * It prompts twice with a hidden input, requires 14+ characters with 3 character
 * classes, stores ONLY a bcrypt (cost 12) hash in server/.env as
 * ADMIN_PANEL_PASSWORD_HASH, then restarts PM2 so the API picks it up.
 * The password is never printed, logged or committed.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { spawnSync } = require('child_process');

function hiddenQuestion(query) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY) {
      // Piped input (e.g. `echo ... | node script`) is read as a plain line.
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => {
        data += chunk;
        const index = data.search(/[\r\n]/);
        if (index >= 0) resolve(data.slice(0, index));
      });
      return;
    }
    stdout.write(query);
    stdin.resume();
    stdin.setRawMode(true);
    let value = '';
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          stdout.write('\nCancelled.\n');
          process.exit(1);
        }
        if (char === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

function strengthProblem(password) {
  if (password.length < 14) return 'Use at least 14 characters.';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) return 'Mix upper case, lower case, numbers and symbols (at least 3 kinds).';
  if (/^(.)\1+$/.test(password)) return 'Do not repeat one character.';
  return null;
}

async function main() {
  const password = await hiddenQuestion('New admin password: ');
  const problem = strengthProblem(password);
  if (problem) {
    console.error(`\n${problem}`);
    process.exit(1);
  }
  const confirmation = await hiddenQuestion('Repeat the admin password: ');
  if (confirmation !== password) {
    console.error('\nPasswords do not match.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const envPath = process.env.ADMIN_PANEL_ENV_FILE || path.resolve(__dirname, '../server/.env');
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const line = `ADMIN_PANEL_PASSWORD_HASH='${hash}'`;
  const next = /^ADMIN_PANEL_PASSWORD_HASH=.*$/m.test(current)
    ? current.replace(/^ADMIN_PANEL_PASSWORD_HASH=.*$/m, line)
    : `${current.replace(/\s*$/, '')}\n${line}\n`;
  const tmp = `${envPath}.tmp`;
  fs.writeFileSync(tmp, next, { mode: 0o600 });
  fs.renameSync(tmp, envPath);
  console.log(`\nSaved the hash to ${envPath} (file mode 600). Restarting the API…`);

  const restart = spawnSync('pm2', ['restart', 'chatgram-api', '--update-env'], { stdio: 'inherit' });
  if (restart.error || restart.status !== 0) {
    console.log('\nCould not restart PM2 automatically. Run this yourself:');
    console.log('  pm2 restart chatgram-api --update-env');
  } else {
    console.log('\nDone. Open /web/admin and sign in with the new password.');
  }
  console.log('Keep this password in your password manager; it cannot be recovered by email.');
  process.exit(0);
}

main().catch((error) => {
  console.error('Could not set the admin password:', error.message);
  process.exit(1);
});
