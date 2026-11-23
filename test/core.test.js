'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../src/core');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();

test('scan classifica e remove worktrees com segurança', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-home-'));
  const repo = path.join(home, 'proj');
  fs.mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 't@t');
  sh(repo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), '1');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'init');

  const wtDir = path.join(repo, '.claude', 'worktrees');
  const mk = (name) => sh(repo, 'worktree', 'add', '-q', '-b', `worktree-${name}`, path.join(wtDir, name));
  mk('limpa'); mk('suja'); mk('commitada'); mk('sumida');

  fs.writeFileSync(path.join(wtDir, 'suja', 'x.txt'), 'wip');
  fs.writeFileSync(path.join(wtDir, 'commitada', 'y.txt'), 'y');
  sh(path.join(wtDir, 'commitada'), 'add', '.');
  sh(path.join(wtDir, 'commitada'), 'commit', '-qm', 'trabalho');
  fs.rmSync(path.join(wtDir, 'sumida'), { recursive: true });

  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: { [repo]: {} } }));

  // staleDays 0 => tudo que não tem bloqueio vira "stale"
  const items = await core.scan({ home, staleDays: 0 });
  const by = Object.fromEntries(items.map((i) => [i.name, i]));
  assert.equal(items.length, 4);
  assert.equal(by.limpa.status, 'stale');
  assert.equal(by.suja.status, 'blocked');
  assert.equal(by.commitada.status, 'blocked');
  assert.equal(by.sumida.status, 'stale');
  assert.ok(by.sumida.missing);

  // bloqueadas não são removidas sem force
  const r1 = await core.removeWorktree(by.suja);
  assert.equal(r1.removed, false);
  assert.ok(fs.existsSync(by.suja.path));

  // limpa + sumida saem
  const res = await core.removeMany([by.limpa, by.sumida]);
  assert.ok(res.every((r) => r.removed), JSON.stringify(res));
  assert.ok(!fs.existsSync(by.limpa.path));
  const branches = sh(repo, 'branch', '--list', 'worktree-*');
  assert.ok(!branches.includes('worktree-limpa'));
  assert.ok(branches.includes('worktree-commitada'));

  // force remove a suja
  const r2 = await core.removeWorktree(by.suja, { force: true });
  assert.ok(r2.removed);

  // recusa caminhos fora de .claude/worktrees
  const r3 = await core.removeWorktree({ ...by.limpa, path: repo, blockers: [] });
  assert.equal(r3.removed, false);
});
