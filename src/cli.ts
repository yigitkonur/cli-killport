#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { createRequire } from 'node:module';

// ── Dynamic chalk import (ESM) ──────────────────────────────────────
const chalk = (await import('chalk')).default;

// ── Version ──────────────────────────────────────────────────────────
const _require = createRequire(import.meta.url);
const { version: VERSION } = _require('../package.json') as { version: string };

// ── Types ────────────────────────────────────────────────────────────
interface ProcessInfo {
  pid: number;
  ppid: number;
  user: string;
  command: string;
  name: string;
  state: string;
  children: number[];
}

// ── ASCII Banner ─────────────────────────────────────────────────────
//  Letters: 4 chars wide, 1-space separated, 3 rows tall
//  "kill" in warm red→orange gradient, "port" in bold accent (#00ffc8)
function showBanner(): void {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return;

  // k i l l p o r t
  const glyphs: string[][] = [
    ['\u2588 \u2584\u2588', '\u2588\u2580\u2588 ', '\u2588  \u2588', '\u2588  \u2588'],  // k i l l
    ['\u2588\u2588\u2580 ', '\u2588 \u2588 ', '\u2588  \u2588', '\u2588  \u2588'],  // k i l l
    ['\u2588 \u2580\u2588', '\u2580 \u2580 ', '\u2580\u2580\u2580\u2580', '\u2580\u2580\u2580\u2580'],  // k i l l
  ];

  const portGlyphs: string[][] = [
    ['\u2588\u2580\u2580\u2588', '\u2588\u2580\u2580\u2588', '\u2588\u2580\u2580\u2584', '\u2580\u2588\u2588\u2580'],  // p o r t
    ['\u2588\u2580\u2580 ', '\u2588 \u2588', '\u2588\u2588\u2580 ', ' \u2588\u2588 '],  // p o r t
    ['\u2588   ', '\u2580\u2580\u2580\u2580', '\u2588 \u2580\u2588', ' \u2580\u2580 '],  // p o r t
  ];

  // "kill" gradient: warm red → orange
  const killColors = [
    chalk.hex('#ff4d4d'),  // k
    chalk.hex('#ff6b35'),  // i
    chalk.hex('#ff8c1a'),  // l
    chalk.hex('#ffaa00'),  // l
  ];

  // "port" in bold mint accent (like 's' in continues)
  const portColor = chalk.hex('#00ffc8').bold;

  console.log();
  for (let row = 0; row < 3; row++) {
    let line = '  ';
    // "kill" letters
    for (let i = 0; i < glyphs[0].length; i++) {
      line += killColors[i](glyphs[row][i]);
      if (i < glyphs[0].length - 1) line += ' ';
    }
    line += ' ';
    // "port" letters
    for (let i = 0; i < portGlyphs[0].length; i++) {
      line += portColor(portGlyphs[row][i]);
      if (i < portGlyphs[0].length - 1) line += ' ';
    }
    console.log(line);
  }

  console.log();
  console.log('  ' + chalk.hex('#ff6b35')('Kill'.padEnd(10)) + chalk.gray('Free any port in one command. No zombies left behind.'));
  console.log('  ' + chalk.hex('#00ffc8')('Port'.padEnd(10)) + chalk.gray(`v${VERSION} \u2014 killport or kp`));
  console.log();
}

// ── Symbols ──────────────────────────────────────────────────────────
const sym = {
  arrow:  chalk.hex('#00ffc8')('\u25B6'),
  bullet: chalk.hex('#ff6b35')('\u25CF'),
  check:  chalk.green('\u2714'),
  cross:  chalk.red('\u2718'),
  warn:   chalk.yellow('\u26A0'),
  skull:  chalk.red('\u2620'),
  info:   chalk.cyan('\u25C6'),
  line:   chalk.gray('\u2502'),
  corner: chalk.gray('\u2514'),
  tee:    chalk.gray('\u251C'),
};

// ── Helpers ──────────────────────────────────────────────────────────
function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Process Discovery ────────────────────────────────────────────────
function findProcessesByPort(port: number): ProcessInfo[] {
  const os = platform();
  let pids: number[] = [];

  if (os === 'darwin' || os === 'linux') {
    // lsof is available on both macOS and most Linux distros
    const lsofOutput = exec(`lsof -i :${port} -t 2>/dev/null`);
    if (lsofOutput) {
      pids = [...new Set(lsofOutput.split('\n').map(Number).filter(Boolean))];
    }

    // Fallback: fuser on Linux
    if (pids.length === 0 && os === 'linux') {
      const fuserOutput = exec(`fuser ${port}/tcp 2>/dev/null`);
      if (fuserOutput) {
        pids = [...new Set(fuserOutput.trim().split(/\s+/).map(Number).filter(Boolean))];
      }
    }

    // Fallback: ss on Linux
    if (pids.length === 0 && os === 'linux') {
      const ssOutput = exec(`ss -tlnp sport = :${port} 2>/dev/null`);
      const pidMatches = ssOutput.matchAll(/pid=(\d+)/g);
      for (const m of pidMatches) {
        pids.push(Number(m[1]));
      }
      pids = [...new Set(pids)];
    }
  } else {
    console.error(chalk.red(`  ${sym.cross} Unsupported platform: ${os}`));
    process.exit(1);
  }

  // Enrich with process details
  return pids.map((pid) => getProcessInfo(pid)).filter((p): p is ProcessInfo => p !== null);
}

function getProcessInfo(pid: number): ProcessInfo | null {
  const os = platform();

  if (os === 'darwin') {
    const psOutput = exec(`ps -o pid=,ppid=,user=,state=,comm=,command= -p ${pid} 2>/dev/null`);
    if (!psOutput) return null;

    // Parse ps output - fields are space-separated
    const parts = psOutput.trim().split(/\s+/);
    if (parts.length < 5) return null;

    const ppid = Number(parts[1]) || 0;
    const user = parts[2] || 'unknown';
    const state = parts[3] || '?';
    const name = (parts[4] || 'unknown').split('/').pop() || 'unknown';
    const command = parts.slice(5).join(' ') || name;

    // Find children
    const childOutput = exec(`pgrep -P ${pid} 2>/dev/null`);
    const children = childOutput ? childOutput.split('\n').map(Number).filter(Boolean) : [];

    return { pid, ppid, user, command, name, state, children };
  }

  if (os === 'linux') {
    const psOutput = exec(`ps -o pid=,ppid=,user=,stat=,comm=,args= -p ${pid} 2>/dev/null`);
    if (!psOutput) return null;

    const parts = psOutput.trim().split(/\s+/);
    if (parts.length < 5) return null;

    const ppid = Number(parts[1]) || 0;
    const user = parts[2] || 'unknown';
    const state = parts[3] || '?';
    const name = parts[4] || 'unknown';
    const command = parts.slice(5).join(' ') || name;

    const childOutput = exec(`pgrep -P ${pid} 2>/dev/null`);
    const children = childOutput ? childOutput.split('\n').map(Number).filter(Boolean) : [];

    return { pid, ppid, user, command, name, state, children };
  }

  return null;
}

// ── Kill Logic ───────────────────────────────────────────────────────
function killProcessTree(proc: ProcessInfo, allKilled: Set<number>): { killed: number[]; failed: number[] } {
  const killed: number[] = [];
  const failed: number[] = [];

  // Kill children first (bottom-up to avoid orphans becoming zombies)
  for (const childPid of proc.children) {
    if (allKilled.has(childPid)) continue;
    const childInfo = getProcessInfo(childPid);
    if (childInfo) {
      const result = killProcessTree(childInfo, allKilled);
      killed.push(...result.killed);
      failed.push(...result.failed);
    }
  }

  if (allKilled.has(proc.pid)) return { killed, failed };
  allKilled.add(proc.pid);

  // Try SIGTERM first for a brief grace period
  try {
    process.kill(proc.pid, 'SIGTERM');
  } catch {
    // Process may already be dead
  }

  // Wait briefly, then SIGKILL
  spawnSync('sleep', ['0.1']);

  if (pidExists(proc.pid)) {
    try {
      process.kill(proc.pid, 'SIGKILL');
    } catch {
      // Already dead — fine
    }
  }

  // Also kill the process group to catch any stragglers
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    // Not a group leader or already dead — fine
  }

  // Verify
  spawnSync('sleep', ['0.1']);
  if (pidExists(proc.pid)) {
    failed.push(proc.pid);
  } else {
    killed.push(proc.pid);
  }

  return { killed, failed };
}

// Reap zombies: send SIGCHLD to parent so it collects dead children
function reapZombies(procs: ProcessInfo[]): void {
  const parentPids = [...new Set(procs.map((p) => p.ppid).filter((p) => p > 1))];
  for (const ppid of parentPids) {
    try {
      process.kill(ppid, 'SIGCHLD');
    } catch {
      // Parent may be gone too
    }
  }
}

// ── Display ──────────────────────────────────────────────────────────
function displayProcessTable(procs: ProcessInfo[], port: number): void {
  console.log(`  ${sym.arrow} Found ${chalk.bold.white(String(procs.length))} process${procs.length > 1 ? 'es' : ''} on port ${chalk.hex('#00ffc8').bold(String(port))}`);
  console.log();

  for (let i = 0; i < procs.length; i++) {
    const p = procs[i];
    const isLast = i === procs.length - 1;
    const prefix = isLast ? sym.corner : sym.tee;

    console.log(`  ${prefix} ${chalk.bold.white('PID')} ${chalk.hex('#ff6b35').bold(String(p.pid))}  ${chalk.gray('\u2502')}  ${chalk.bold.white('Name')} ${chalk.cyan(p.name)}  ${chalk.gray('\u2502')}  ${chalk.bold.white('User')} ${chalk.yellow(p.user)}`);

    const sub = isLast ? '  ' : `  ${sym.line}`;
    const cmdDisplay = p.command.length > 80 ? p.command.slice(0, 77) + '...' : p.command;
    console.log(`  ${sub}   ${chalk.gray('cmd')}  ${chalk.gray(cmdDisplay)}`);

    if (p.children.length > 0) {
      console.log(`  ${sub}   ${chalk.gray('children')}  ${chalk.gray(p.children.join(', '))}`);
    }

    const stateLabel = p.state.startsWith('Z') ? chalk.red('zombie') :
                       p.state.startsWith('S') ? chalk.green('sleeping') :
                       p.state.startsWith('R') ? chalk.yellow('running') :
                       p.state.startsWith('T') ? chalk.gray('stopped') :
                       chalk.gray(p.state);
    console.log(`  ${sub}   ${chalk.gray('state')}  ${stateLabel}`);

    if (!isLast) console.log(`  ${sym.line}`);
  }
  console.log();
}

function displayResults(killed: number[], failed: number[], port: number): void {
  if (killed.length > 0) {
    console.log(`  ${sym.skull}  ${chalk.bold.white('Killed')} ${chalk.hex('#00ffc8').bold(String(killed.length))} process${killed.length > 1 ? 'es' : ''} ${chalk.gray('\u2014')} port ${chalk.hex('#00ffc8').bold(String(port))} is ${chalk.green.bold('free')}`);
    for (const pid of killed) {
      console.log(`     ${sym.check} ${chalk.gray(`PID ${pid}`)}`);
    }
  }

  if (failed.length > 0) {
    console.log(`  ${sym.warn}  ${chalk.yellow.bold('Failed')} to kill ${chalk.red.bold(String(failed.length))} process${failed.length > 1 ? 'es' : ''}`);
    for (const pid of failed) {
      console.log(`     ${sym.cross} ${chalk.gray(`PID ${pid} — try with sudo`)}`);
    }
  }

  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────
function main(): void {
  const args = process.argv.slice(2);

  // Help
  if (args.includes('--help') || args.includes('-h')) {
    showBanner();
    console.log(`  ${chalk.bold.white('Usage')}  ${chalk.hex('#00ffc8')('killport')} ${chalk.gray('<port>')} ${chalk.gray('[options]')}`);
    console.log(`         ${chalk.hex('#00ffc8')('npx cli-killport')} ${chalk.gray('<port>')}`);
    console.log();
    console.log(`  ${chalk.bold.white('Options')}`);
    console.log(`    ${chalk.cyan('-h, --help')}       Show this help`);
    console.log(`    ${chalk.cyan('-v, --version')}    Show version`);
    console.log(`    ${chalk.cyan('-s, --silent')}     Suppress banner and verbose output`);
    console.log();
    console.log(`  ${chalk.bold.white('Examples')}`);
    console.log(`    ${chalk.gray('$')} killport 1420`);
    console.log(`    ${chalk.gray('$')} killport 3000`);
    console.log(`    ${chalk.gray('$')} npx cli-killport 8080`);
    console.log(`    ${chalk.gray('$')} kp 5173`);
    console.log();
    process.exit(0);
  }

  // Version
  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
    process.exit(0);
  }

  const silent = args.includes('--silent') || args.includes('-s');
  const portArgs = args.filter((a) => !a.startsWith('-'));

  if (portArgs.length === 0) {
    if (!silent) showBanner();
    console.error(`  ${sym.cross} ${chalk.red('No port specified.')}`);
    console.log(`  ${chalk.gray('Usage: killport <port>')}`);
    console.log();
    process.exit(1);
  }

  const port = Number(portArgs[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`  ${sym.cross} ${chalk.red(`Invalid port: ${portArgs[0]}. Must be 1-65535.`)}`);
    process.exit(1);
  }

  if (!silent) showBanner();

  // Discover processes
  const procs = findProcessesByPort(port);

  if (procs.length === 0) {
    console.log(`  ${sym.info} No processes found on port ${chalk.hex('#00ffc8').bold(String(port))} ${chalk.gray('\u2014 port is already free')}`);
    console.log();
    process.exit(0);
  }

  // Display process table
  displayProcessTable(procs, port);

  // Kill everything
  const allKilled = new Set<number>();
  const totalKilled: number[] = [];
  const totalFailed: number[] = [];

  for (const proc of procs) {
    const { killed, failed } = killProcessTree(proc, allKilled);
    totalKilled.push(...killed);
    totalFailed.push(...failed);
  }

  // Reap any zombie children
  reapZombies(procs);

  // Verify port is actually free
  spawnSync('sleep', ['0.2']);
  const remaining = findProcessesByPort(port);
  if (remaining.length > 0) {
    // Second pass with raw kill -9
    for (const p of remaining) {
      if (!allKilled.has(p.pid)) {
        exec(`kill -9 ${p.pid} 2>/dev/null`);
        allKilled.add(p.pid);
        spawnSync('sleep', ['0.1']);
        if (!pidExists(p.pid)) {
          totalKilled.push(p.pid);
        } else {
          totalFailed.push(p.pid);
        }
      }
    }
  }

  // Show results
  displayResults(totalKilled, totalFailed, port);

  process.exit(totalFailed.length > 0 ? 1 : 0);
}

main();
