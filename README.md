# Claude Worktree Cleaner

App de barra de menu (macOS) / bandeja (Linux) que lista as worktrees criadas pelo Claude Code
(`<repo>/.claude/worktrees/*`) e remove as que não estão mais em uso.

## Rodar

```bash
npm install
npm start
```

Gerar instalador: `npm run dist` (.dmg no Mac; AppImage e .deb no Linux).
Testar a lógica: `npm test` (usa um repositório git temporário, não toca nos seus).

## Como decide o que está "em uso"

Os repositórios vêm do `~/.claude.json` (todo diretório onde o Claude Code já rodou) mais as
pastas extras que você adicionar em "+ Pasta". Para cada worktree em `.claude/worktrees/`:

| Estado | Critério |
|---|---|
| **em uso** | atividade recente (menos que N dias; padrão 7) |
| **inativa** | sem atividade há N dias ou mais e nada a perder; ou pasta já apagada (só falta o `prune`) |
| **tem trabalho a perder** | alterações não commitadas, commits fora da branch base/remoto, ou worktree travada |

"Atividade" = o mais recente entre mtime da pasta, último commit e última sessão do Claude Code
em `~/.claude/projects/`.

## Segurança

- Só mexe em caminhos dentro de `.claude/worktrees/`; nunca na worktree principal.
- Sem "forçar", worktrees com trabalho a perder ficam desabilitadas para seleção.
- Remove com `git worktree remove` (sem `--force`) e `git branch -d` (só apaga branch já mergeada).
- "Forçar" exige confirmação em diálogo nativo e usa `--force` / `branch -D`.
- O processo principal revalida a seleção contra o último scan; não confia no que vem da interface.

## Linux: ícone na bandeja

No GNOME o ícone precisa da extensão "AppIndicator and KStatusNotifierItem Support".
KDE, XFCE, Cinnamon e MATE funcionam direto. No Linux o clique abre o menu/janela centralizada
(não há posição do ícone como no macOS).

## Limitações conhecidas

- Não detecta processos com a worktree aberta (ex.: um terminal parado nela); a heurística é a
  última atividade. Se quiser, dá para adicionar um `lsof +D` opcional.
- Ícone da bandeja é desenhado em código; troque por um PNG/Template em `trayIcon()` se quiser.
