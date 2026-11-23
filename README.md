# Claude Worktree Cleaner

App de barra de menu (macOS) / bandeja (Linux) que lista as worktrees criadas pelo Claude Code
(`<repo>/.claude/worktrees/*`) e remove as que não estão mais em uso.

## Instalar (fica rodando na barra, sem terminal)

Precisa de Node 20+ e git (macOS: `brew install node git`). Cole no Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/GNaves/claude-worktree-cleaner/main/install.sh | bash
```

O instalador baixa o código, compila o app com as versões travadas no `package-lock.json`, instala
em `/Applications` (macOS, ou `~/Applications` se não for gravável) ou em `~/.local/share` (Linux)
e abre. O ícone aparece na barra de menus / bandeja.

- **Clique** no ícone abre a janela; **botão direito** (macOS) abre o menu com Atualizar, Iniciar com o sistema e Sair.
- **Inicia sozinho no login**: na primeira execução ele se registra para abrir com o sistema.
  Para desligar, desmarque "iniciar com o sistema" na janela ou no menu.
- **Atualizar**: rode o mesmo comando de novo. A configuração é mantida.
- **Remover**: `curl -fsSL https://raw.githubusercontent.com/GNaves/claude-worktree-cleaner/main/install.sh | bash -s -- --uninstall`

O build local não é assinado nem notarizado pela Apple; o instalador remove a quarentena do `.app`
para o macOS abrir sem reclamar. No Linux o atalho usa `--no-sandbox` (o `chrome-sandbox` de um
build local não é SUID-root), e o app só carrega arquivos locais com CSP restrita.

## Desenvolver

```bash
npm ci
npm start      # roda em primeiro plano (fecha com o terminal; não registra início automático)
npm test       # testa a lógica com um repositório git temporário
```

Na primeira execução o Electron baixa o binário (~100 MB); isso é normal.
Gerar .dmg / AppImage / .deb: `npm run dist`. O build do Mac sai **sem assinatura**
(`identity: null`): se o Gatekeeper reclamar, botão direito > Abrir, ou
`xattr -cr "dist/mac-arm64/Claude Worktree Cleaner.app"`.

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
KDE, XFCE, Cinnamon e MATE funcionam direto. No Linux o ícone (AppIndicator) só oferece menu:
use **Abrir** nele para ver a janela, que abre centralizada (não há posição do ícone como no macOS).

## Limitações conhecidas

- Não detecta processos com a worktree aberta (ex.: um terminal parado nela); a heurística é a
  última atividade. Se quiser, dá para adicionar um `lsof +D` opcional.
- O instalador compila no seu computador (precisa de Node 20+ e git) e o app não é assinado nem
  notarizado pela Apple. Ainda não há release pronto para baixar.
- O caminho do macOS foi escrito seguindo o do Linux, que é o testado de ponta a ponta; se algo
  falhar no Mac, abra uma issue com a saída do terminal.

## Ícones

O desenho (branch do git com um brilho de "limpeza") é gerado por `tools/make-icons.py` (Pillow):
`src/assets/iconTemplate*.png` (macOS, template preto que se adapta ao tema), `src/assets/icon.png`
(Linux, laranja) e `build/icon.png` (ícone do app). Para mudar cor/traço, edite o script e rode
`python3 tools/make-icons.py`.

## Estrutura

| Arquivo | O que é |
|---|---|
| `install.sh` | instala/atualiza/remove o app residente (macOS e Linux) |
| `src/core.js` | descobre, classifica e remove worktrees (sem dependências) |
| `src/main.js` | tray/barra de menu, janela, início automático, IPC |
| `src/renderer/` | interface da janela |
| `test/core.test.js` | teste da lógica com repositório git temporário |

## Contribuir

Contribuições são bem-vindas: faça um fork, crie uma branch e abra um Pull Request. Só o dono
(@GNaves) revisa e faz o merge na `main`; push direto, force-push e apagar a `main` não são
permitidos para ninguém além dele. Rode `npm test` antes de abrir o PR.
