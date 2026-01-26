# KRJ Named Tunnel - Quick Start Card

## 🚀 One-Time Setup (5 minutes)

### Step 1: Authenticate
```bash
cloudflared tunnel login
```
→ Opens browser, authenticate with Cloudflare

### Step 2: Setup Tunnel
```bash
cd /Users/donaldross/dev/ma-tracker-app
./scripts/setup-named-tunnel.sh
```
→ Creates tunnel, configures DNS

### Step 3: Configure Cloudflare Access
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Zero Trust** → **Access** → **Applications**
2. Click **Add an application** → **Self-hosted**
3. Configure:
   - Name: `KRJ Dev UI`
   - Domain: `krj-dev.dr3-dashboard.com`
4. Add Policy:
   - Action: **Allow**
   - Include: **Emails** → Enter your email(s)
5. Identity Provider: **One-time PIN**
6. Save

---

## 📅 Daily Usage (2 commands)

```bash
# Terminal 1
npm run dev

# Terminal 2
./scripts/start-tunnel.sh
```

**Stable URL:** `https://krj-dev.dr3-dashboard.com/krj`

---

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| "cloudflared not found" | `brew install cloudflared` |
| "Cloudflare cert not found" | Run `cloudflared tunnel login` |
| "localhost:3000 not responding" | Run `npm run dev` first |
| Tunnel won't start | `pkill -f cloudflared` then retry |
| Access not prompting | Check Cloudflare dashboard config |

---

## 📚 Full Documentation

- **Complete Guide:** `docs/CLOUDFLARE_TUNNEL_SETUP.md`
- **Implementation Summary:** `docs/PHASE_1_2_IMPLEMENTATION_SUMMARY.md`
- **Tech Stack:** `docs/TECH_STACK.md`

---

## 🎯 Quick Tunnel (Temporary URL)

For quick demos without setup:
```bash
./scripts/start-tunnel.sh --quick
```
→ Generates temporary URL (changes each session)

