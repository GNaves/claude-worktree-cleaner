'use strict';
// Lógica central: descobre worktrees criadas pelo Claude Code, classifica
// se ainda estão "em uso" e remove com segurança. Sem dependências externas.

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const execFileP = promisify(execFile);

const DEFAULTS = {
  staleDays: 7, // sem atividade há N dias => candidata à limpeza
  extraRoots: [], // pastas extras para varrer atrás de repositórios
};

async function git(cwd, args, opts = {}) {
  try {
    const { stdout } = await execFileP('git', args, {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      ...opts,
    });
    return { ok: true, out: stdout.trimEnd() };
  } catch (e) {
    return { ok: false, out: (e.stdout || '').toString().trimEnd(), err: (e.stderr || e.message || '').toString().trim() };
  }
}

const exists = (p) => fsp.access(p).then(() => true, () => false);

// ---------- 1. Descobrir repositórios ----------

// ~/.claude.json guarda "projects": { "/caminho/do/repo": {...} } com todo
// diretório em que o Claude Code já rodou (inclui as próprias worktrees).
async function readClaudeProjects(home = os.homedir()) {
  const file = path.join(home, '.claude.json');
  try {
    const json = JSON.parse(await fsp.readFile(file, 'utf8'));
    return Object.keys(json.projects || {});
  } catch {
    return [];
  }
}

async function findRepoRoots(extraRoots = [], home = os.homedir()) {
  const candidates = new Set(await readClaudeProjects(home));

  // varredura rasa (2 níveis) das pastas extras
  for (const root of extraRoots) {
    const level1 = await safeReaddir(root);
    for (const d1 of level1) {
      const p1 = path.join(root, d1);
      candidates.add(p1);
      for (const d2 of await safeReaddir(p1)) candidates.add(path.join(p1, d2));
    }
  }

  // Resolve cada candidato para o toplevel do repo principal (common dir).
  const roots = new Map(); // commonDir -> repoPath
  for (const c of candidates) {
    if (!(await exists(c))) continue;
    const r = await git(c, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (!r.ok || !r.out) continue;
    const commonDir = r.out;
    if (roots.has(commonDir)) continue;
    // repo principal = pai do common dir (.git) ; bare repos ficam no próprio dir
    const main = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : commonDir;
    roots.set(commonDir, main);
  }
  return [...roots.values()];
}

async function safeReaddir(dir) {
  try {
    const ents = await fsp.readdir(dir, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
}

// ---------- 2. Listar worktrees ----------

function parsePorcelain(text) {
  const items = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9), branch: null, head: null, bare: false, detached: false, locked: false, prunable: false };
      items.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'bare') cur.bare = true;
    else if (line === 'detached') cur.detached = true;
    else if (line.startsWith('locked')) cur.locked = true;
    else if (line.startsWith('prunable')) cur.prunable = true;
  }
  return items;
}

// Branch base para comparar ("já foi mergeada?")
async function defaultBranch(repo) {
  const sym = await git(repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (sym.ok && sym.out) return sym.out; // ex.: origin/main
  for (const b of ['main', 'master', 'develop']) {
    if ((await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])).ok) return b;
  }
  const head = await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return head.ok && head.out ? head.out : 'HEAD';
}

function isClaudeWorktree(p) {
  return p.split(path.sep).join('/').includes('/.claude/worktrees/');
}

async function dirSize(p) {
  // du é rápido e existe em Mac e Linux (-sk = KiB)
  try {
    const { stdout } = await execFileP('du', ['-sk', p], { maxBuffer: 1024 * 1024 });
    return parseInt(stdout.split(/\s+/)[0], 10) * 1024;
  } catch {
    return 0;
  }
}

// Última atividade: mais recente entre mtime do dir, último commit e
// a sessão mais nova do Claude Code para esse caminho.
async function lastActivity(wtPath, home = os.homedir()) {
  const times = [];
  try { times.push((await fsp.stat(wtPath)).mtimeMs); } catch {}
  const ct = await git(wtPath, ['log', '-1', '--format=%ct']);
  if (ct.ok && ct.out) times.push(parseInt(ct.out, 10) * 1000);

  // ~/.claude/projects/<caminho com / e . trocados por ->/*.jsonl
  const encoded = wtPath.replace(/[/.]/g, '-');
  const sessDir = path.join(home, '.claude', 'projects', encoded);
  try {
    for (const f of await fsp.readdir(sessDir)) {
      try { times.push((await fsp.stat(path.join(sessDir, f))).mtimeMs); } catch {}
    }
  } catch {}
  return times.length ? Math.max(...times) : 0;
}

async function inspectWorktree(repo, wt, base, opts) {
  const info = {
    repo,
    path: wt.path,
    name: path.basename(wt.path),
    branch: wt.branch,
    locked: wt.locked,
    missing: wt.prunable || !(await exists(wt.path)),
    dirty: false,
    dirtyCount: 0,
    ahead: 0, // commits que não estão em base
    unpushed: 0, // commits sem upstream (quando há upstream)
    merged: false,
    lastActivityMs: 0,
    sizeBytes: 0,
    reasons: [],
    blockers: [],
    status: 'active',
  };

  if (info.missing) {
    info.status = 'stale';
    info.reasons.push('pasta não existe mais (só falta o prune)');
    return info;
  }

  const st = await git(wt.path, ['status', '--porcelain']);
  if (st.ok && st.out) {
    info.dirty = true;
    info.dirtyCount = st.out.split('\n').length;
  }

  if (wt.head) {
    const ah = await git(wt.path, ['rev-list', '--count', `${base}..HEAD`]);
    if (ah.ok) info.ahead = parseInt(ah.out, 10) || 0;
    info.merged = info.ahead === 0;
  }
  if (wt.branch) {
    const up = await git(wt.path, ['rev-list', '--count', '@{u}..HEAD']);
    if (up.ok) info.unpushed = parseInt(up.out, 10) || 0;
  }

  info.lastActivityMs = await lastActivity(wt.path, opts.home);
  info.sizeBytes = await dirSize(wt.path);

  const ageDays = (Date.now() - info.lastActivityMs) / 86400000;
  info.ageDays = Math.floor(ageDays);

  // Bloqueios: coisas que podem perder trabalho
  if (info.dirty) info.blockers.push(`${info.dirtyCount} arquivo(s) com alterações não commitadas`);
  if (!info.merged && wt.branch) {
    const unique = info.unpushed > 0 ? info.unpushed : info.ahead;
    // Se há upstream e tudo foi enviado, não bloqueia
    const hasUpstream = (await git(wt.path, ['rev-parse', '--abbrev-ref', '@{u}'])).ok;
    if (!hasUpstream || info.unpushed > 0) info.blockers.push(`${unique} commit(s) que não estão em ${base} nem no remoto`);
  }
  if (!wt.branch && info.ahead > 0) info.blockers.push(`HEAD solto com ${info.ahead} commit(s) fora de ${base}`);
  if (info.locked) info.blockers.push('worktree travada (git worktree lock)');

  const old = ageDays >= opts.staleDays;
  if (old) info.reasons.push(`sem atividade há ${info.ageDays} dia(s)`);
  if (info.merged) info.reasons.push(`sem commits novos em relação a ${base}`);

  if (info.blockers.length) info.status = 'blocked';
  else if (old) info.status = 'stale';
  else info.status = 'active';

  return info;
}

async function scan(userOpts = {}) {
  const opts = { ...DEFAULTS, home: os.homedir(), ...userOpts };
  const repos = await findRepoRoots(opts.extraRoots, opts.home);
  const out = [];
  for (const repo of repos) {
    const list = await git(repo, ['worktree', 'list', '--porcelain']);
    if (!list.ok) continue;
    const base = await defaultBranch(repo);
    const wts = parsePorcelain(list.out).filter((w, i) => i > 0 && !w.bare && isClaudeWorktree(w.path));
    const infos = await Promise.all(wts.map((w) => inspectWorktree(repo, w, base, opts)));
    out.push(...infos);
  }
  out.sort((a, b) => a.lastActivityMs - b.lastActivityMs);
  return out;
}

// ---------- 3. Remover ----------

// Remove uma worktree. Nunca usa --force a menos que force=true.
async function removeWorktree(item, { force = false, deleteBranch = true } = {}) {
  const res = { path: item.path, removed: false, branchDeleted: false, message: '' };

  if (!isClaudeWorktree(item.path)) {
    res.message = 'recusado: não é uma worktree do Claude (.claude/worktrees)';
    return res;
  }
  if (!force && item.blockers && item.blockers.length) {
    res.message = 'recusado: ' + item.blockers.join('; ');
    return res;
  }

  if (item.missing) {
    const p = await git(item.repo, ['worktree', 'prune']);
    res.removed = p.ok;
    res.message = p.ok ? 'prune feito' : p.err;
  } else {
    const args = ['worktree', 'remove', item.path];
    if (force) args.push('--force', '--force'); // 2x também remove travadas
    const r = await git(item.repo, args);
    res.removed = r.ok;
    res.message = r.ok ? 'removida' : r.err;
    if (!r.ok) return res;
  }

  if (deleteBranch && item.branch) {
    // -d só apaga se mergeada; com force usa -D
    const b = await git(item.repo, ['branch', force ? '-D' : '-d', item.branch]);
    res.branchDeleted = b.ok;
    if (!b.ok) res.message += ` (branch ${item.branch} mantida: ${b.err.split('\n')[0]})`;
  }
  await git(item.repo, ['worktree', 'prune']);
  return res;
}

async function removeMany(items, opts) {
  const results = [];
  for (const it of items) results.push(await removeWorktree(it, opts));
  return results;
}

module.exports = { scan, removeWorktree, removeMany, parsePorcelain, isClaudeWorktree, findRepoRoots, DEFAULTS };
