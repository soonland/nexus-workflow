#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Colours ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[init]${NC} $*"; }
warn()    { echo -e "${YELLOW}[init]${NC} $*"; }
error()   { echo -e "${RED}[init]${NC} $*" >&2; }
section() { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

# ── 1. .env files ──────────────────────────────────────────────────────────────
section "Environment files"

copy_env() {
  local dir="$1" example="$2" target="$3"
  if [ ! -f "$dir/$target" ]; then
    if [ -f "$dir/$example" ]; then
      cp "$dir/$example" "$dir/$target"
      warn "Created $dir/$target from $example — fill in any missing values before starting"
    else
      warn "$dir/$target not found and no $example to copy from — skipping"
    fi
  else
    info "$dir/$target already exists"
  fi
}

copy_env "$ROOT/nexus-erp" ".env.local.example" ".env.local"

# nexus-workflow-app has no .env.example; write a safe default if missing
if [ ! -f "$ROOT/nexus-workflow-app/.env" ]; then
  cat > "$ROOT/nexus-workflow-app/.env" <<'EOF'
DATABASE_URL=postgres://nexus:nexus@localhost:5433/nexus_workflow
PORT=3000
NODE_ENV=development
REDIS_URL=redis://localhost:6379
EOF
  warn "Created nexus-workflow-app/.env with default values"
else
  info "nexus-workflow-app/.env already exists"
fi

# ── 2. npm install ─────────────────────────────────────────────────────────────
section "Installing dependencies"

for pkg in nexus-workflow-core nexus-workflow-app nexus-erp; do
  info "npm install — $pkg"
  npm install --prefix "$ROOT/$pkg" --silent
done

# ── 3. Build nexus-workflow-core (nexus-workflow-app depends on its dist/) ─────
section "Building nexus-workflow-core"
npm run build --prefix "$ROOT/nexus-workflow-core"

# ── 4. nexus-workflow-app — create DB + migrate ───────────────────────────────
section "nexus-workflow-app — database setup"

(
  cd "$ROOT/nexus-workflow-app"
  set -a; [ -f .env ] && source .env; set +a

  info "Running migrations (nexus-workflow-app)"
  npx tsx src/db/reset-cli.ts
)

# ── 5. nexus-erp — migrate + seed ─────────────────────────────────────────────
section "nexus-erp — database migration & seed"

(
  cd "$ROOT/nexus-erp"
  set -a; [ -f .env.local ] && source .env.local; set +a
  info "Running prisma migrate dev (creates DB if missing)"
  npx prisma migrate dev --name init
  info "Running prisma db seed"
  npx prisma db seed
)

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
info "All done. Start the stack with:"
echo ""
echo "  # Terminal 1 — workflow API"
echo "  npm run dev --prefix nexus-workflow-app"
echo ""
echo "  # Terminal 2 — ERP app"
echo "  npm run dev --prefix nexus-erp"
echo ""
