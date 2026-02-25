#!/usr/bin/env bash
# Capture current system state as baseline files for audit comparison
# Usage: ./capture_baselines.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

BASELINES_DIR="${AUDIT_ROOT}/baselines"
mkdir -p "$BASELINES_DIR"

log_info "Capturing baselines to ${BASELINES_DIR}"

# ============================================================
# 1. Listening ports
# ============================================================

capture_ports() {
    log_info "Capturing listening ports..."

    if command -v ss &>/dev/null; then
        ss -tlnp 2>/dev/null | python3 -c "
import sys, json, re

ports = []
for line in sys.stdin:
    line = line.strip()
    if line.startswith('State') or not line:
        continue
    parts = line.split()
    if len(parts) < 5:
        continue
    state = parts[0]
    local_addr = parts[3] if len(parts) > 3 else ''
    # Parse addr:port
    if ':' in local_addr:
        idx = local_addr.rfind(':')
        addr = local_addr[:idx]
        port = local_addr[idx+1:]
    else:
        continue
    # Extract process name
    proc_info = parts[-1] if len(parts) > 5 else ''
    proc_match = re.search(r'\"([^\"]+)\"', proc_info)
    process = proc_match.group(1) if proc_match else 'unknown'

    ports.append({
        'proto': 'tcp',
        'addr': addr,
        'port': int(port) if port.isdigit() else port,
        'process': process
    })
print(json.dumps(ports, indent=2))
" > "${BASELINES_DIR}/ports.json"
    elif command -v netstat &>/dev/null; then
        netstat -tlnp 2>/dev/null | python3 -c "
import sys, json, re

ports = []
for line in sys.stdin:
    line = line.strip()
    if not line.startswith('tcp'):
        continue
    parts = line.split()
    local_addr = parts[3]
    if ':' in local_addr:
        idx = local_addr.rfind(':')
        addr = local_addr[:idx]
        port = local_addr[idx+1:]
    else:
        continue
    proc = parts[-1] if len(parts) > 5 else 'unknown'
    ports.append({
        'proto': 'tcp',
        'addr': addr,
        'port': int(port) if port.isdigit() else port,
        'process': proc.split('/')[-1] if '/' in proc else proc
    })
print(json.dumps(ports, indent=2))
" > "${BASELINES_DIR}/ports.json"
    else
        log_warn "Neither ss nor netstat available — skipping ports baseline"
        echo "[]" > "${BASELINES_DIR}/ports.json"
    fi

    log_info "  → ports.json"
}

# ============================================================
# 2. Docker Compose config hash
# ============================================================

capture_compose() {
    log_info "Capturing compose config..."

    if command -v docker &>/dev/null; then
        # Find compose file
        local compose_file=""
        for candidate in \
            "${AUDIT_ROOT}/../../docker-compose.yml" \
            "${AUDIT_ROOT}/../../docker-compose.yaml" \
            "/opt/app/docker-compose.yml"; do
            if [[ -f "$candidate" ]]; then
                compose_file="$(realpath "$candidate")"
                break
            fi
        done

        if [[ -n "$compose_file" ]]; then
            python3 -c "
import hashlib, json, sys

compose_path = sys.argv[1]
with open(compose_path, 'rb') as f:
    content = f.read()
    sha256 = hashlib.sha256(content).hexdigest()

result = {
    'compose_file': compose_path,
    'sha256': sha256,
    'size_bytes': len(content)
}
print(json.dumps(result, indent=2))
" "$compose_file" > "${BASELINES_DIR}/compose.json"
            log_info "  → compose.json"
        else
            log_warn "No docker-compose file found — skipping"
            echo '{"compose_file": null, "sha256": null}' > "${BASELINES_DIR}/compose.json"
        fi
    else
        log_warn "Docker not available — skipping compose baseline"
        echo '{"compose_file": null, "sha256": null}' > "${BASELINES_DIR}/compose.json"
    fi
}

# ============================================================
# 3. Docker images with SHAs
# ============================================================

capture_images() {
    log_info "Capturing docker images..."

    if command -v docker &>/dev/null; then
        docker images --format '{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedAt}}' 2>/dev/null | python3 -c "
import sys, json

images = []
for line in sys.stdin:
    parts = line.strip().split('\t')
    if len(parts) >= 4:
        images.append({
            'repository': parts[0],
            'tag': parts[1],
            'id': parts[2],
            'size': parts[3],
            'created': parts[4] if len(parts) > 4 else ''
        })
print(json.dumps(images, indent=2))
" > "${BASELINES_DIR}/images.json"
    else
        echo "[]" > "${BASELINES_DIR}/images.json"
    fi

    log_info "  → images.json"
}

# ============================================================
# 4. Firewall rules
# ============================================================

capture_firewall() {
    log_info "Capturing firewall rules..."

    local fw_data='{"tool": null, "rules": []}'

    if command -v ufw &>/dev/null; then
        local ufw_output
        ufw_output="$(sudo ufw status verbose 2>/dev/null || ufw status verbose 2>/dev/null || echo 'unavailable')"
        fw_data="$(python3 -c "
import json, sys
print(json.dumps({'tool': 'ufw', 'output': sys.argv[1]}))
" "$ufw_output")"
    elif command -v iptables &>/dev/null; then
        local ipt_output
        ipt_output="$(sudo iptables-save 2>/dev/null || iptables-save 2>/dev/null || echo 'unavailable')"
        fw_data="$(python3 -c "
import json, sys
print(json.dumps({'tool': 'iptables', 'output': sys.argv[1]}))
" "$ipt_output")"
    else
        log_warn "No firewall tool found (ufw/iptables)"
    fi

    echo "$fw_data" > "${BASELINES_DIR}/firewall.json"
    log_info "  → firewall.json"
}

# ============================================================
# 5. System users + sudoers
# ============================================================

capture_users() {
    log_info "Capturing users..."

    python3 -c "
import json, subprocess, os

users = []
try:
    result = subprocess.run(['getent', 'passwd'], capture_output=True, text=True)
    for line in result.stdout.strip().split('\n'):
        if not line:
            continue
        parts = line.split(':')
        if len(parts) >= 7:
            users.append({
                'username': parts[0],
                'uid': int(parts[2]),
                'gid': int(parts[3]),
                'home': parts[5],
                'shell': parts[6]
            })
except FileNotFoundError:
    pass

# Check sudoers
sudoers = []
sudoers_dir = '/etc/sudoers.d'
if os.path.isdir(sudoers_dir):
    try:
        for f in os.listdir(sudoers_dir):
            sudoers.append(f)
    except PermissionError:
        sudoers = ['permission_denied']

result = {'users': users, 'sudoers_files': sudoers}
print(json.dumps(result, indent=2))
" > "${BASELINES_DIR}/users.json"

    log_info "  → users.json"
}

# ============================================================
# 6. Dependency audit results
# ============================================================

capture_deps() {
    log_info "Capturing dependency audit..."

    local deps='{"pip_audit": [], "npm_audit": []}'

    # pip-audit
    if command -v pip-audit &>/dev/null; then
        local pip_result
        pip_result="$(pip-audit --format json 2>/dev/null || echo '[]')"
        deps="$(python3 -c "
import json, sys
d = json.loads(sys.argv[1])
d['pip_audit'] = json.loads(sys.argv[2])
print(json.dumps(d))
" "$deps" "$pip_result")"
    fi

    # npm audit
    if command -v npm &>/dev/null; then
        local npm_result
        npm_result="$(npm audit --json 2>/dev/null || echo '{}')"
        deps="$(python3 -c "
import json, sys
d = json.loads(sys.argv[1])
d['npm_audit'] = json.loads(sys.argv[2])
print(json.dumps(d))
" "$deps" "$npm_result")"
    fi

    echo "$deps" | python3 -m json.tool > "${BASELINES_DIR}/deps.json"
    log_info "  → deps.json"
}

# ============================================================
# Run all captures
# ============================================================

capture_ports
capture_compose
capture_images
capture_firewall
capture_users
capture_deps

log_info "Baseline capture complete. Files in ${BASELINES_DIR}:"
ls -la "${BASELINES_DIR}/"
