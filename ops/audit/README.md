# DR3 Ops Audit Framework

Automated daily security and reliability auditing for the DR3 Dashboard production system.

## What This Is

A modular check-based audit framework that runs daily (and weekly for heavier scans) to verify:

- **Host security**: disk, memory, SSH logs, open ports, firewall, user accounts
- **Docker security**: container health, image vulnerabilities (trivy), root checks, compose drift
- **App security**: dependency vulnerabilities (pip-audit, npm audit), SAST (bandit), secrets scanning (gitleaks)
- **Secrets hygiene**: environment variable exposure, leaked credentials
- **Network**: port baseline drift, TLS certificate expiry
- **Regression**: scheduler jobs running, API health, data freshness, spread monitor liveness

## Quick Start

```bash
# First time: install external tool dependencies
sudo ./bin/install_deps.sh

# Capture initial baselines
./bin/run_daily.sh --capture-baselines

# Run a full audit
./bin/run_daily.sh

# Run a specific check
./bin/run_daily.sh --check=host/disk_usage

# Quick mode (fail-closed checks only)
./bin/run_daily.sh --quick

# Force weekly scans (bandit, eslint) even if not Sunday
./bin/run_daily.sh --force-weekly

# Verbose output
./bin/run_daily.sh --verbose
```

## Directory Structure

```
ops/audit/
  bin/
    lib.sh               # Shared library (sourced by all scripts)
    run_daily.sh          # Master entrypoint
    capture_baselines.sh  # Baseline snapshot tool
    install_deps.sh       # Dependency installer
  checks/
    host/                 # Host-level checks
    docker/               # Container checks
    app/                  # Application security checks
    secrets/              # Secret scanning checks
    network/              # Network checks
    regression/           # Reliability smoke tests
  config/
    audit.yml             # Main configuration
    redaction.yml         # Secret redaction patterns
  baselines/             # Captured baseline snapshots (JSON)
  artifacts/             # Daily run artifacts (auto-pruned)
    YYYY-MM-DD/
      host/              # Per-category result files
      docker/
      app/
      secrets/
      network/
      regression/
      summary.json       # Merged run summary
      report.md          # Rendered report
  report/
    render.sh            # Report renderer
    alert.sh             # Alert dispatcher
    templates/
      report.md.tmpl     # Report template
```

## Adding a New Check

1. Create an executable bash script in the appropriate `checks/<category>/` directory:

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../../bin/lib.sh"

init_check "category/my_check"

# ... your check logic ...

if [[ something_wrong ]]; then
    json_finding "Something is wrong" $SEV_WARN "Details here"
fi

finalize_check || exit $?
```

2. Make it executable: `chmod +x checks/category/my_check.sh`
3. It will be auto-discovered on the next run.

### Check API

Every check script sources `lib.sh` and uses:

- `init_check "<category>/<name>"` — start the check, set up artifact dirs
- `json_finding "<title>" <severity_int> "<detail>"` — record a finding
- `finalize_check` — write results JSON, return severity as exit code
- `read_config "<dotpath>"` — read a value from audit.yml
- `read_baseline "<filename>"` — read a baseline file
- `with_timeout <secs> <cmd>` — run with timeout
- `with_retry <n> <delay> <cmd>` — retry on failure
- `log_info/log_warn/log_error` — timestamped logging

### Severity Levels

| Level    | Code | Meaning                              |
|----------|------|--------------------------------------|
| INFO     | 0    | All clear, no issues                 |
| WARN     | 10   | Non-critical finding, daily digest   |
| ALERT    | 20   | Needs attention, immediate email     |
| CRITICAL | 30   | Requires urgent action               |

## Updating Baselines

After making intentional infrastructure changes (adding ports, changing containers, etc.):

```bash
./bin/run_daily.sh --capture-baselines
```

This updates `baselines/*.json` to reflect the new expected state.

## Suppressing False Positives

Add entries to `config/audit.yml` under `suppressions`:

```yaml
suppressions:
  - check: "pip_audit"
    id: "PYSEC-2024-XXXX"
    reason: "Not exploitable in our usage"
    expires: "2026-04-01"
```

Suppressed findings still appear in reports but are downgraded to INFO.

## Reading Reports

After a run, reports are at `artifacts/YYYY-MM-DD/report.md`. The report includes:

- Overall status and duration
- Category summary table
- All WARN+ findings with details
- Deltas since the previous run

On the server: `cat /opt/app/ops/audit/artifacts/$(date +%Y-%m-%d)/report.md`

## Exit Codes

The exit code of `run_daily.sh` matches the highest severity found:

| Exit Code | Meaning  |
|-----------|----------|
| 0         | INFO     |
| 10        | WARN     |
| 20        | ALERT    |
| 30        | CRITICAL |

## Cron Setup

Add to the deploy user's crontab:

```cron
# Daily audit at 6:00 AM ET (before market open)
0 6 * * * cd /opt/app && ./ops/audit/bin/run_daily.sh >> /var/log/dr3-audit.log 2>&1
```

## Alerts

Alerts are sent via SendGrid based on severity:

- **INFO**: No alert
- **WARN**: Daily digest email
- **ALERT**: Immediate alert email
- **CRITICAL**: Urgent alert email

Configure recipients in `config/audit.yml` under `alert.recipients.email`. Set the `SENDGRID_API_KEY` environment variable.

Email bodies contain only severity and finding titles — never full details or secrets.
