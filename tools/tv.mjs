#!/usr/bin/env node
// Build, package and install the app on a webOS TV, then launch it.
//
//   npm run tv                 production build, package, install, launch
//   npm run tv -- --dev        development build instead of production
//   npm run tv -- --skip-build reuse the existing dist/ (package, install, launch)
//   npm run tv -- --no-launch  stop after installing
//   npm run tv -- --inspect    launch with the inspector attached (ares-inspect)
//   npm run tv -- --dry-run    print the commands without running them
//
// Target TV (nothing about it is committed; set these in your shell profile):
//   TV_DEVICE    ares-cli device name (see `ares-setup-device -l`). Default: the
//                ares-cli default device. Same as --device NAME.
//   TV_HOST      TV address. Only used for the scp + luna-send fallback below.
//   TV_USER      SSH user for the fallback. Default: root.
//   TV_SSH_PORT  SSH port for the fallback. Default: 22.
//   TV_SSH_KEY   SSH private key for the fallback. Default: ssh's own choice.
//
// If `ares-install` fails and TV_HOST is set, the .ipk is copied over with scp
// and installed through luna-send on the TV instead.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const isWindows = process.platform === 'win32';
const INSTALL_TIMEOUT_MS = 60000;

const { values: opts } = parseArgs({
  options: {
    dev: { type: 'boolean', default: false },
    'skip-build': { type: 'boolean', default: false },
    'no-launch': { type: 'boolean', default: false },
    inspect: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    device: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false }
  }
});

if (opts.help) {
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('\n')
    .filter((line, i) => i > 0 && line.startsWith('//'))
    .map((line) => line.replace(/^\/\/ ?/, ''));
  console.log(header.join('\n'));
  process.exit(0);
}

const device = opts.device ?? process.env.TV_DEVICE;
const deviceArgs = device ? ['-d', device] : [];

function quote(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

function echo(label, cmd, args) {
  console.log(`\n==> ${label}\n$ ${[cmd, ...args].map(quote).join(' ')}`);
}

/** Run a command, echoing it first. Returns true on exit code 0. */
function run(label, cmd, args, { fatal = true } = {}) {
  echo(label, cmd, args);
  if (opts['dry-run']) return true;

  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: isWindows
  });
  const ok = result.status === 0;
  if (!ok && fatal) {
    console.error(`\n${label} failed (${result.error?.message ?? `exit ${result.status}`}).`);
    process.exit(result.status || 1);
  }
  return ok;
}

/**
 * Run luna-send over ssh until the TV reports the app installed. Resolves to null then, or to the
 * reason it was not.
 */
function installOverSsh(args) {
  echo('Install on TV', 'ssh', args);
  if (opts['dry-run']) return null;

  return new Promise((resolve) => {
    // stdin is a pipe left open: interactive luna-send exits on EOF.
    const ssh = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'inherit'] });
    let output = '';

    const finish = (reason) => {
      clearTimeout(timer);
      ssh.kill();
      resolve(reason);
    };
    const timer = setTimeout(
      () => finish(`no result after ${INSTALL_TIMEOUT_MS / 1000}s`),
      INSTALL_TIMEOUT_MS
    );

    ssh.on('error', (err) => finish(err.message));
    ssh.on('close', (code) => finish(`ssh exited (${code}) before the app was installed`));
    ssh.stdout.setEncoding('utf8').on('data', (chunk) => {
      process.stdout.write(chunk);
      output += chunk;

      if (/"state":\s*"installed"/.test(output)) finish(null);
      else if (/"state":\s*"[^"]*failed|"returnValue":\s*false/i.test(output)) {
        finish('the TV rejected it');
      }
    });
  });
}

const bin = (name) => normalize(join(root, 'node_modules', '.bin', name));

if (!opts['dry-run'] && !existsSync(bin('ares-package'))) {
  console.error('webOS CLI tools are missing. Run `pnpm install` first.');
  process.exit(1);
}

// 1. Build
if (opts['skip-build']) {
  console.log('==> Skipping build (--skip-build)');
} else {
  run('Build', bin('webpack'), [`--mode=${opts.dev ? 'development' : 'production'}`]);
}

// 2. Package
run('Package', bin('ares-package'), ['-n', 'dist', '-o', 'dist']);

// The .ipk is named from the appinfo.json that webpack copied into dist/.
let ipk = join(dist, 'youtube.leanback.v4_VERSION_all.ipk');
let appId = 'youtube.leanback.v4';
if (!opts['dry-run']) {
  const appinfo = JSON.parse(readFileSync(join(dist, 'appinfo.json'), 'utf8'));
  appId = appinfo.id;
  ipk = join(dist, `${appId}_${appinfo.version}_all.ipk`);
  if (!existsSync(ipk)) {
    console.error(`Expected package not found: ${ipk}`);
    process.exit(1);
  }
}

// 3. Install
const installed = run('Install', bin('ares-install'), [...deviceArgs, ipk], {
  fatal: false
});

if (!installed) {
  const host = process.env.TV_HOST;
  if (!host) {
    console.error(
      '\nInstall failed. To try the scp + luna-send fallback, set TV_HOST to the TV address.'
    );
    process.exit(1);
  }

  console.log('\nares-install failed, trying the scp + luna-send fallback.');
  const user = process.env.TV_USER ?? 'root';
  const port = process.env.TV_SSH_PORT ?? '22';
  const sshOpts = [
    '-o',
    'StrictHostKeyChecking=accept-new',
    ...(process.env.TV_SSH_KEY ? ['-i', process.env.TV_SSH_KEY] : [])
  ];
  const remote = `/tmp/${basename(ipk)}`;
  const params = JSON.stringify({ id: appId, ipkUrl: remote, subscribe: true });

  run('Copy to TV', 'scp', [...sshOpts, '-P', port, ipk, `${user}@${host}:${remote}`]);

  const target = ['-p', port, `${user}@${host}`];
  const failure = await installOverSsh([
    '-tt',
    ...sshOpts,
    ...target,
    `luna-send -i -f luna://com.webos.appInstallService/dev/install '${params}'`
  ]);
  if (failure) {
    console.error(`\nInstall on TV failed: ${failure}.`);
    process.exit(1);
  }
  run('Clean up', 'ssh', [...sshOpts, ...target, `rm -f ${remote}`], { fatal: false });
}

// 4. Launch
if (opts.inspect) {
  run('Launch with inspector', bin('ares-inspect'), [...deviceArgs, appId]);
} else if (!opts['no-launch']) {
  run('Launch', bin('ares-launch'), [...deviceArgs, appId], { fatal: false });
}

console.log('\nDone.');
