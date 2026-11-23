#!/usr/bin/env bash
# Instala (ou atualiza) o Claude Worktree Cleaner como app residente da barra de menu / bandeja:
#
#   curl -fsSL https://raw.githubusercontent.com/GNaves/claude-worktree-cleaner/main/install.sh | bash
#
# macOS: compila e instala em /Applications (ou ~/Applications) e abre o app.
# Linux: instala em ~/.local/share, cria atalho no menu de apps e abre o app.
# O app liga sozinho o "iniciar com o sistema" na primeira execução.
# Remover: ./install.sh --uninstall   (ou: curl -fsSL <url> | bash -s -- --uninstall)
set -euo pipefail

REPO_URL="https://github.com/GNaves/claude-worktree-cleaner.git"
APP_NAME="Claude Worktree Cleaner"
BIN_NAME="claude-worktree-cleaner"
SRC_DIR="${CWC_SRC:-$HOME/.local/share/claude-worktree-cleaner-src}"
OS="$(uname)"

mac_dest() { if [ -w /Applications ]; then echo /Applications; else mkdir -p "$HOME/Applications"; echo "$HOME/Applications"; fi; }

stop_app() {
  if [ "$OS" = Darwin ]; then pkill -x "$APP_NAME" 2>/dev/null || true
  else pkill -f "$HOME/.local/share/$BIN_NAME/$BIN_NAME" 2>/dev/null || true; fi
  sleep 1
}

# ---------- desinstalar ----------
if [ "${1:-}" = "--uninstall" ]; then
  stop_app
  if [ "$OS" = Darwin ]; then
    rm -rf "/Applications/$APP_NAME.app" "$HOME/Applications/$APP_NAME.app"
    # remove o item de login, se existir
    osascript -e "tell application \"System Events\" to delete login item \"$APP_NAME\"" >/dev/null 2>&1 || true
    rm -rf "$HOME/Library/Application Support/$BIN_NAME" "$HOME/Library/Application Support/$APP_NAME"
  else
    rm -rf "$HOME/.local/share/$BIN_NAME" "$HOME/.local/bin/$BIN_NAME" \
           "$HOME/.local/share/applications/$BIN_NAME.desktop" "$HOME/.local/share/icons/$BIN_NAME.png" "$HOME/.config/autostart/$BIN_NAME.desktop" \
           "$HOME/.config/$BIN_NAME" "$HOME/.config/$APP_NAME"
  fi
  rm -rf "$SRC_DIR"
  echo "✓ Removido."
  exit 0
fi

# ---------- pré-requisitos ----------
for c in git node npm; do
  command -v "$c" >/dev/null 2>&1 || { echo "Falta o '$c'. Instale (macOS: brew install node git) e rode de novo." >&2; exit 1; }
done
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 20 ] || { echo "Precisa do Node 20 ou mais novo (você tem $(node -v))." >&2; exit 1; }
if ! command -v git >/dev/null 2>&1 || ! git --version >/dev/null 2>&1; then
  echo "O git não está funcionando (no macOS: xcode-select --install)." >&2; exit 1
fi

# ---------- código-fonte ----------
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -f "$here/package.json" ] && grep -q '"name": "claude-worktree-cleaner"' "$here/package.json"; then
  root="$here"            # rodando de dentro de um clone
else
  if [ -d "$SRC_DIR/.git" ]; then
    echo "→ Atualizando o código em $SRC_DIR…"
    git -C "$SRC_DIR" fetch --depth 1 origin main -q
    git -C "$SRC_DIR" reset --hard origin/main -q
  else
    echo "→ Baixando o código…"
    mkdir -p "$(dirname "$SRC_DIR")"
    git clone --depth 1 -q "$REPO_URL" "$SRC_DIR"
  fi
  root="$SRC_DIR"
fi
cd "$root"

# ---------- build ----------
export CSC_IDENTITY_AUTO_DISCOVERY=false   # build local, sem assinatura
echo "→ Instalando dependências (versões travadas no package-lock)…"
npm ci --no-audit --no-fund --loglevel=error
echo "→ Compilando o app (a 1ª vez baixa o Electron, ~100 MB)…"
rm -rf dist

if [ "$OS" = Darwin ]; then
  npx --no-install electron-builder --dir --mac >/dev/null
  built="$(ls -d dist/mac*/"$APP_NAME.app" 2>/dev/null | head -1)"
  [ -n "$built" ] || { echo "Build não gerou o .app (veja a saída acima)." >&2; exit 1; }
  dest="$(mac_dest)"
  stop_app
  echo "→ Instalando em $dest/$APP_NAME.app"
  rm -rf "$dest/$APP_NAME.app"
  ditto "$built" "$dest/$APP_NAME.app"
  xattr -dr com.apple.quarantine "$dest/$APP_NAME.app" 2>/dev/null || true
  [ "${CWC_NO_START:-}" = 1 ] || open "$dest/$APP_NAME.app"
  echo "✓ Pronto! O ícone apareceu na barra de menus. Clique para abrir; botão direito para o menu."
  echo "  Ele já liga sozinho com o Mac. Para desligar: botão direito no ícone › Iniciar com o sistema."

elif [ "$OS" = Linux ]; then
  npx --no-install electron-builder --dir --linux >/dev/null
  [ -d dist/linux-unpacked ] || { echo "Build não gerou dist/linux-unpacked." >&2; exit 1; }
  share="$HOME/.local/share/$BIN_NAME"
  stop_app
  echo "→ Instalando em $share"
  rm -rf "$share"; mkdir -p "$share" "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons"
  cp -a dist/linux-unpacked/. "$share/"
  cp build/icon.png "$HOME/.local/share/icons/$BIN_NAME.png"
  # --no-sandbox: o chrome-sandbox do build local não é SUID-root (como em AppImage).
  cat > "$HOME/.local/bin/$BIN_NAME" <<LAUNCH
#!/usr/bin/env bash
exec "$share/$BIN_NAME" --no-sandbox "\$@"
LAUNCH
  chmod +x "$HOME/.local/bin/$BIN_NAME"
  cat > "$HOME/.local/share/applications/$BIN_NAME.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=$APP_NAME
Comment=Limpa worktrees do Claude Code em desuso
Exec=$HOME/.local/bin/$BIN_NAME
Icon=$HOME/.local/share/icons/$BIN_NAME.png
Terminal=false
Categories=Development;
DESK
  [ "${CWC_NO_START:-}" = 1 ] || { nohup "$HOME/.local/bin/$BIN_NAME" >/dev/null 2>&1 & disown; }
  echo "✓ Pronto! O ícone apareceu na bandeja (no GNOME precisa da extensão AppIndicator)."
  echo "  Ele já liga sozinho com a sessão. Comando: $BIN_NAME"
else
  echo "Sistema não suportado: $OS" >&2; exit 1
fi
