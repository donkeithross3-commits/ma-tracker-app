# Cloudflare Tunnel Setup for KRJ External Access

## Overview
This guide explains how to expose your local KRJ development server to the internet using Cloudflare Tunnel.

**Two modes available:**
1. **Named Tunnel (Recommended)** - Stable URL at `krj-dev.dr3-dashboard.com`
2. **Quick Tunnel** - Temporary random URL for quick demos

## Prerequisites
- Cloudflare account (free tier works)
- Domain managed by Cloudflare (for Named Tunnel)
- `cloudflared` CLI installed
- Next.js dev server running on `localhost:3000`

## Installation

### macOS
```bash
brew install cloudflared
```

### Windows
Download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

### Linux
```bash
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

## Quick Start (Named Tunnel - Stable URL)

### One-Time Setup

1. **Authenticate with Cloudflare:**
   ```bash
   cloudflared tunnel login
   ```
   This opens your browser to authenticate and downloads a cert to `~/.cloudflared/cert.pem`.

2. **Run the setup script:**
   ```bash
   ./scripts/setup-named-tunnel.sh
   ```
   This will:
   - Create the `krj-dev-tunnel` named tunnel
   - Configure DNS routing for `krj-dev.dr3-dashboard.com`
   - Generate `.cloudflared/config.yml`

### Daily Usage

1. **Start Next.js dev server:**
   ```bash
   npm run dev
   ```

2. **Start named tunnel (in new terminal):**
   ```bash
   ./scripts/start-tunnel.sh
   ```

3. **Access the stable URL:**
   - KRJ Page: `https://krj-dev.dr3-dashboard.com/krj`
   - This URL never changes!

## Quick Start (Quick Tunnel - Temporary URL)

For quick demos without setup:

1. **Start Next.js dev server:**
   ```bash
   npm run dev
   ```

2. **Start quick tunnel:**
   ```bash
   ./scripts/start-tunnel.sh --quick
   ```

3. **Copy the temporary URL** displayed in the terminal

4. **Share the URL** - it will change each session

## Usage

### Starting the Tunnel
```bash
./scripts/start-tunnel.sh
```

The script will:
- Check if cloudflared is installed
- Verify localhost:3000 is running
- Start a Quick Tunnel
- Display the public URL

Example output:
```
==========================================
✅ Cloudflare Tunnel Active
==========================================

Public URL: https://random-words.trycloudflare.com
KRJ Page:   https://random-words.trycloudflare.com/krj
```

### Stopping the Tunnel
Press `Ctrl+C` in the tunnel terminal, or:
```bash
./scripts/stop-tunnel.sh
```

## URL Types

### Named Tunnel (Recommended - Default)
- **URL:** `https://krj-dev.dr3-dashboard.com`
- **Pros:** Stable URL, custom domain, bookmarkable
- **Cons:** Requires one-time setup
- **Best for:** Regular use, sharing with team
- **Command:** `./scripts/start-tunnel.sh`

### Quick Tunnel (Fallback)
- **URL:** `https://random-words.trycloudflare.com`
- **Pros:** No configuration, instant setup
- **Cons:** URL changes each session
- **Best for:** Quick demos, testing
- **Command:** `./scripts/start-tunnel.sh --quick`

## Troubleshooting

### "cloudflared not found"
Install cloudflared using the instructions above.

### "localhost:3000 not responding"
Make sure `npm run dev` is running first.

### Tunnel won't start
1. Check if another tunnel is running: `pkill -f cloudflared`
2. Check logs: `cat .cloudflared/tunnel.log`
3. Try manual command: `cloudflared tunnel --url http://localhost:3000`

### URL not displaying
Check `.cloudflared/tunnel.log` for the tunnel URL.

## Cloudflare Access (Authentication Layer)

The Named Tunnel is protected by **Cloudflare Access**, which provides:
- Email-based authentication (One-Time PIN / magic link)
- Access control before requests reach the app
- Identity headers for app-level user management

### Setting Up Cloudflare Access

1. **Enable Cloudflare Zero Trust:**
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
   - Navigate to **Zero Trust** (left sidebar)
   - If not enabled, follow the setup wizard to create a team name

2. **Create an Access Application:**
   - Zero Trust → **Access** → **Applications**
   - Click **Add an application**
   - Choose **Self-hosted**
   - Configure:
     - **Application name:** KRJ Dev UI
     - **Session duration:** 24 hours (or your preference)
     - **Application domain:**
       - Subdomain: `krj-dev`
       - Domain: `dr3-dashboard.com`
       - Path: Leave blank (protects all paths)

3. **Configure Access Policy:**
   - Click **Next** to add a policy
   - **Policy name:** Authorized Users
   - **Action:** Allow
   - **Configure rules:**
     - **Include:** Emails
     - Enter allowed email addresses (one per line):
       ```
       your-email@example.com
       colleague@example.com
       ```
     - Or use **Email domain** to allow all `@yourcompany.com` emails

4. **Choose Identity Provider:**
   - **One-time PIN** (recommended for simplicity)
     - Users receive a magic link via email
     - No additional configuration needed
   - Alternative: Google, GitHub, Okta, etc.

5. **Save and Deploy:**
   - Click **Next** → **Add application**
   - Access is now active!

### Testing Cloudflare Access

1. Visit `https://krj-dev.dr3-dashboard.com/krj` in an incognito window
2. You should see the Cloudflare Access login page
3. Enter an authorized email address
4. Check email for the one-time PIN or magic link
5. Click the link or enter the PIN
6. You should now see the KRJ page

### Identity Headers

When Cloudflare Access is enabled, these headers are passed to the app:
- `CF-Access-Authenticated-User-Email` - User's email address
- `CF-Access-JWT-Assertion` - JWT with user claims (verifiable)

**Current behavior:** The Next.js app logs the email in development mode but doesn't use it for authorization yet. This will be integrated with NextAuth in a future phase for per-user preferences.

## Security Notes

1. **Cloudflare Access:** Provides outer authentication gate for the domain
2. **Email-based auth:** Users must have an authorized email address
3. **Session duration:** Configurable (default 24 hours)
4. **Development environment:** This setup is for dev/staging, not production
5. **Future:** NextAuth will provide inner app-level user management and preferences

## Comparison: Cloudflare vs ngrok

| Feature | Cloudflare Tunnel | ngrok |
|---------|-------------------|-------|
| Free tier | Unlimited | 8 hour sessions |
| URL changes | Yes (Quick Tunnel) | Yes (free tier) |
| Custom domain | Yes (with CF domain) | Paid only |
| Speed | Fast (CF network) | Fast |
| Setup | Simple | Simple |

## References
- [Cloudflare Tunnel Docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [Quick Tunnel Guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)

