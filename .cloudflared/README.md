# Cloudflared Configuration

This directory contains configuration for the Named Cloudflare Tunnel.

## Files

- `config.yml` - Tunnel configuration (ingress rules, credentials path)
- `krj-dev-tunnel.json` - Tunnel credentials (generated during tunnel creation)
- `tunnel.log` - Quick Tunnel log file (legacy)

## Setup Required

Before the named tunnel can work, you must:

1. **Authenticate cloudflared** (one-time per machine):
   ```bash
   cloudflared tunnel login
   ```
   This will open your browser to authenticate with Cloudflare and download a cert to `~/.cloudflared/cert.pem`.

2. **Create the named tunnel** (one-time):
   ```bash
   cloudflared tunnel create krj-dev-tunnel
   ```
   This generates credentials and a tunnel UUID.

3. **Configure DNS routing** (one-time):
   ```bash
   cloudflared tunnel route dns krj-dev-tunnel krj-dev.dr3-dashboard.com
   ```
   This creates a CNAME record pointing your subdomain to the tunnel.

After these steps, you can start the tunnel with:
```bash
./scripts/start-tunnel.sh
```

## Troubleshooting

If you see "Error locating origin cert", run `cloudflared tunnel login` again.

