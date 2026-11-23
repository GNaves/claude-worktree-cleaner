'use strict';
const $ = (id) => document.getElementById(id);
let items = [];
const selected = new Set();

const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(0) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
const fmtAge = (d) => (d === undefined ? '—' : d === 0 ? 'hoje' : d + ' d atrás');
const LABEL = { stale: 'inativa', active: 'em uso', blocked: 'tem trabalho a perder' };

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n[k] = v;
  }
  kids.forEach((k) => n.append(k));
  return n;
}

function render() {
  const rows = $('rows');
  rows.replaceChildren();
  $('empty').hidden = items.length > 0;
  const force = $('force').checked;

  for (const it of items) {
    const removable = force || it.blockers.length === 0;
    const cb = el('input', { type: 'checkbox', checked: selected.has(it.path), disabled: !removable });
    cb.addEventListener('change', () => { cb.checked ? selected.add(it.path) : selected.delete(it.path); updateButtons(); });

    const detail = [...it.blockers, ...(it.status === 'stale' ? it.reasons : [])].join(' · ');
    const tr = el('tr', { class: it.status },
      el('td', {}, cb),
      el('td', {}, el('b', { text: it.name }), el('small', { text: it.branch || '(HEAD solto)' }), el('small', { text: detail })),
      el('td', { text: it.repo.split('/').slice(-2).join('/'), title: it.repo }),
      el('td', { text: it.missing ? '—' : fmtAge(it.ageDays) }),
      el('td', { text: it.missing ? '—' : fmtSize(it.sizeBytes) }),
      el('td', {}, el('span', { class: 'badge ' + it.status, text: it.missing ? 'pasta sumida' : LABEL[it.status] })),
    );
    rows.append(tr);
  }

  const stale = items.filter((i) => i.status === 'stale');
  const bytes = stale.reduce((s, i) => s + (i.sizeBytes || 0), 0);
  $('summary').textContent = `${items.length} worktree(s) · ${stale.length} inativa(s) liberam ~${fmtSize(bytes)}`;
  updateButtons();
}

function updateButtons() {
  $('clean').disabled = selected.size === 0;
  $('clean').textContent = selected.size ? `Remover ${selected.size} selecionada(s)` : 'Remover selecionadas';
  $('all').checked = items.length > 0 && items.every((i) => selected.has(i.path));
}

function setItems(list) {
  items = list;
  for (const p of [...selected]) if (!items.some((i) => i.path === p)) selected.delete(p);
  render();
}

async function refresh() {
  $('summary').textContent = 'Escaneando…';
  setItems(await window.api.scan());
}

$('refresh').addEventListener('click', refresh);
$('addroot').addEventListener('click', async () => { await window.api.addRoot(); });
$('force').addEventListener('change', () => { if (!$('force').checked) for (const i of items) if (i.blockers.length) selected.delete(i.path); render(); });
$('all').addEventListener('change', (e) => {
  const force = $('force').checked;
  selected.clear();
  if (e.target.checked) items.filter((i) => force || !i.blockers.length).forEach((i) => selected.add(i.path));
  render();
});
$('selstale').addEventListener('click', () => { selected.clear(); items.filter((i) => i.status === 'stale').forEach((i) => selected.add(i.path)); render(); });
$('days').addEventListener('change', async () => { await window.api.setConfig({ staleDays: Number($('days').value) }); });

$('clean').addEventListener('click', async () => {
  $('clean').disabled = true;
  const res = await window.api.remove([...selected], { force: $('force').checked, deleteBranch: $('delbranch').checked });
  selected.clear();
  $('log').textContent = res.map((r) => `${r.removed ? '✔' : '✘'} ${r.path.split('/').pop()}: ${r.message}`).join('\n');
});

$('quit').addEventListener('click', () => window.api.quit());
$('autostart').addEventListener('change', async () => { $('autostart').checked = await window.api.setAutostart($('autostart').checked); });

window.api.onScan(setItems);
(async () => {
  const cfg = await window.api.getConfig();
  $('days').value = cfg.staleDays;
  const as = await window.api.getAutostart();
  $('autostart').checked = as.on;
  if (!as.available) { $('autostart').disabled = true; $('autostart-label').title = 'Disponível só no app instalado (veja o README)'; }
  refresh();
})();
