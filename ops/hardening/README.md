# Droplet Hardening — ma-tracker-app

Hardening configs for the production droplet (134.199.204.12). Addresses the security audit findings: SSH misconfiguration, no firewall, no intrusion prevention, and Cloudflare bypass via direct IP access.

## What Each Config Does

### SSH Hardening (`sshd_config.d/90-hardening.conf`)
Drop-in config loaded by Ubuntu 22+'s sshd Include directive:
- **Disables root login** — forces use of `don` user + sudo
- **Disables password auth** — SSH keys only (prevents brute-force)
- **Disables X11 forwarding and TCP forwarding** — reduces attack surface
- **Limits auth attempts to 3** — slows brute-force attempts
- **Sets client keepalive** — drops stale connections after 10 minutes

### UFW Firewall (`ufw/setup.sh`)
- Default deny all incoming traffic
- SSH (port 22) allowed from any IP (required for management)
- HTTP/HTTPS (80/443) allowed **only from Cloudflare IP ranges** — blocks direct IP access that bypasses Cloudflare's WAF and DDoS protection
- Docker and localhost traffic allowed for internal container networking

### fail2ban (`fail2ban/jail.local`)
- Monitors `/var/log/auth.log` for failed SSH login attempts
- Bans IPs for 1 hour after 5 failed attempts within 10 minutes
- Works alongside UFW (adds temporary firewall rules for banned IPs)

## How to Apply

**CRITICAL: Keep an SSH session open in a separate terminal the entire time. If the config breaks SSH, your open session lets you fix it.**

```bash
# 1. Copy the ops/hardening directory to the droplet
scp -r ops/hardening don@134.199.204.12:/tmp/hardening

# 2. SSH into the droplet (keep this session open!)
ssh don@134.199.204.12

# 3. Preview what will happen (no changes made)
sudo bash /tmp/hardening/apply.sh --dry-run

# 4. Apply for real
sudo bash /tmp/hardening/apply.sh

# 5. In a NEW terminal, verify SSH still works
ssh don@134.199.204.12

# 6. Only close the original session after confirming step 5 works
```

## How to Verify

After applying, check each component:

```bash
# SSH config is active
sudo sshd -T | grep -E "permitrootlogin|passwordauthentication|pubkeyauthentication"
# Expected: permitrootlogin no, passwordauthentication no, pubkeyauthentication yes

# UFW is enabled and rules are correct
sudo ufw status verbose
# Expected: Status active, SSH from anywhere, HTTP/HTTPS from Cloudflare ranges only

# fail2ban is running
sudo fail2ban-client status sshd
# Expected: Shows jail is active with 0 currently banned (unless there are attackers)

# Test Cloudflare-only access (from outside the droplet)
curl -I http://134.199.204.12
# Expected: Connection refused (direct IP blocked by UFW)
```

## How to Rollback

If something goes wrong:

```bash
# Uses most recent backup automatically
sudo bash /tmp/hardening/rollback.sh

# Or specify a backup directory
sudo bash /tmp/hardening/rollback.sh /root/hardening-backup-20260224-120000
```

The rollback script:
- Removes the SSH hardening drop-in and restores the previous config
- Disables and resets UFW (returns to no firewall)
- Stops fail2ban and restores the previous config

## Maintenance

- **Cloudflare IPs**: The UFW rules use Cloudflare's IPv4 ranges as of 2026-02-24. Check https://www.cloudflare.com/ips-v4 periodically and re-run `ufw/setup.sh` if ranges change.
- **fail2ban bans**: View current bans with `sudo fail2ban-client status sshd`. Unban an IP with `sudo fail2ban-client set sshd unbanip <IP>`.
- **UFW rule changes**: View rules with `sudo ufw status numbered`. Delete a rule with `sudo ufw delete <number>`.
