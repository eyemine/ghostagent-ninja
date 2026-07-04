#!/bin/bash
# ============================================================
# Hetzner server setup: Caddy + Bun + PM2
# Ubuntu 24.04 LTS, IP: 46.225.158.75
# Run as root: bash hetzner-setup.sh
# ============================================================
set -e

echo "=== [1/7] System update ==="
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git unzip ufw

echo "=== [2/7] UFW firewall ==="
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Caddy redirect)
ufw allow 443/tcp   # HTTPS
ufw allow 25/tcp    # SMTP inbound (Phase B Postfix)
ufw --force enable
ufw status

echo "=== [3/7] Install Caddy ==="
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y && apt-get install -y caddy

echo "=== [4/7] Install Bun ==="
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
echo "Bun version: $(bun --version)"

echo "=== [5/7] Install PM2 ==="
bun install -g pm2
pm2 --version

echo "=== [6/7] Create app directories ==="
mkdir -p /opt/ghostagent/worker
mkdir -p /opt/ghostagent/logs

cat > /opt/ghostagent/worker/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'nftmail-worker',
    script: 'index.ts',
    interpreter: '/root/.bun/bin/bun',
    cwd: '/opt/ghostagent/worker',
    env_file: '/opt/ghostagent/worker/.env',
    watch: false,
    max_memory_restart: '512M',
    error_file: '/opt/ghostagent/logs/worker-error.log',
    out_file: '/opt/ghostagent/logs/worker-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 3000,
  }],
};
EOF

cat > /opt/ghostagent/worker/index.ts << 'EOF'
import { Hono } from 'hono'

const app = new Hono()
const PORT = parseInt(process.env.PORT ?? '3000')

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }))

app.all('*', (c) => c.json({ error: 'worker not yet deployed' }, 503))

export default {
  port: PORT,
  fetch: app.fetch,
}
EOF

cat > /opt/ghostagent/worker/package.json << 'EOF'
{
  "name": "nftmail-worker",
  "type": "module",
  "dependencies": {
    "hono": "^4"
  }
}
EOF

cd /opt/ghostagent/worker && bun install

echo "=== [7/7] Configure Caddy ==="
cat > /etc/caddy/Caddyfile << 'EOF'
# ── Stage 1: Hono worker ────────────────────────────────────
worker.nftmail.box {
  reverse_proxy localhost:3000
  encode gzip
  log {
    output file /opt/ghostagent/logs/caddy-worker.log
  }
}

# ── Stage 2: ghostagent.ninja (Next.js) — add after migration ──
# ghostagent.ninja {
#   reverse_proxy localhost:3001
# }

# ── Stage 3: nftmail.box (Next.js) — add after migration ────
# nftmail.box {
#   reverse_proxy localhost:3002
# }
EOF

caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "=== Setup PM2 startup ==="
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

echo ""
echo "=============================================="
echo "  Setup complete. Server: 46.225.158.75"
echo "=============================================="
echo ""
echo "NEXT STEPS:"
echo "1. In Cloudflare DNS (proxy OFF for both):"
echo "   A  worker.nftmail.box  → 46.225.158.75"
echo "   A  mail.nftmail.box    → 46.225.158.75"
echo ""
echo "2. Copy .env to /opt/ghostagent/worker/.env"
echo "   (WEBHOOK_SECRET, WORKER_SECRET, etc.)"
echo ""
echo "3. Deploy actual worker code:"
echo "   rsync -av workers/nftmail-email-worker/src/ root@46.225.158.75:/opt/ghostagent/worker/"
echo ""
echo "4. Start worker:"
echo "   pm2 start /opt/ghostagent/worker/ecosystem.config.cjs"
echo "   pm2 save"
echo ""
echo "5. Test: curl https://worker.nftmail.box/health"
