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

# ── 2. pnpm install ────────────────────────────────────────────────────────────
section "Installing dependencies"

command -v pnpm >/dev/null || { error "pnpm not found — run: corepack enable"; exit 1; }
info "pnpm install (workspace)"
pnpm --dir "$ROOT" install

# ── 3. Build nexus-workflow-core (nexus-workflow-app depends on its dist/) ─────
section "Building nexus-workflow-core"
pnpm --dir "$ROOT" --filter nexus-workflow-core build

# ── 4. nexus-workflow-app — create DB + migrate ───────────────────────────────
section "nexus-workflow-app — database setup"

(
  cd "$ROOT/nexus-workflow-app"
  set -a; [ -f .env ] && source .env; set +a

  info "Running migrations (nexus-workflow-app)"
  pnpm exec tsx src/db/reset-cli.ts
)

# ── 4b. nexus-erp is a tenant of the workflow engine — give it its own tenant + API key ──
section "nexus-erp — workflow tenant"

(
  cd "$ROOT/nexus-workflow-app"
  set -a; [ -f .env ] && source .env; set +a

  # The database was just reset, so any earlier key is gone: always issue a fresh one.
  # (The workflow app must run with the same API_KEY_HMAC_SECRET, if you set one.)
  info "Provisioning tenant 'nexus-erp' and writing WORKFLOW_API_KEY to nexus-erp/.env.local"
  pnpm exec tsx src/db/provision-tenant-cli.ts nexus-erp --name "Nexus ERP" \
    --key-name "nexus-erp" --write-env "$ROOT/nexus-erp/.env.local"
)

# ── 5. nexus-erp — migrate + seed ─────────────────────────────────────────────
section "nexus-erp — database migration & seed"

(
  cd "$ROOT/nexus-erp"
  set -a; [ -f .env.local ] && source .env.local; set +a
  info "Running prisma migrate dev (creates DB if missing)"
  pnpm exec prisma migrate dev --name init
  info "Running prisma db seed"
  pnpm exec prisma db seed
)

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
info "All done. Start the stack with:"
echo ""
echo "  # Terminal 1 — workflow API"
echo "  pnpm --filter nexus-workflow-app dev"
echo ""
echo "  # Terminal 2 — ERP app"
echo "  pnpm --filter nexus-erp dev"
echo ""
