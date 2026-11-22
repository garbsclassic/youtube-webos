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

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const isWindows = process.platform === 'win32';

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

/** Run a command, echoing it first. Returns true on exit code 0. */
function run(label, cmd, args, { fatal = true } = {}) {
  console.log(`\n==> ${label}\n$ ${[cmd, ...args].map(quote).join(' ')}`);
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

const bin = (name) => normalize(join(root, 'node_modules', '.bin', name));

if (!opts['dry-run'] && !existsSync(bin('ares-package'))) {
  console.error('webOS CLI tools are missing. Run `pnpm install` (or `npm install`) first.');
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
  run('Install on TV', 'ssh', [
    '-tt',
    ...sshOpts,
    '-p',
    port,
    `${user}@${host}`,
    `luna-send -f -n 6 luna://com.webos.appInstallService/dev/install '${params}'; rm -f ${remote}`
  ]);
}

// 4. Launch
if (opts.inspect) {
  run('Launch with inspector', bin('ares-inspect'), [...deviceArgs, appId]);
} else if (!opts['no-launch']) {
  run('Launch', bin('ares-launch'), [...deviceArgs, appId], { fatal: false });
}

console.log('\nDone.');
