#!/usr/bin/env bash
# Install audit tool dependencies on Ubuntu/Debian
# Usage: sudo ./install_deps.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [INFO]  $*"; }
log_warn()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WARN]  $*"; }

# Minimum versions (for reference/pinning)
TRIVY_VERSION="0.58.2"
GITLEAKS_VERSION="8.22.0"

# ============================================================
# trivy — container/filesystem vulnerability scanner
# ============================================================

install_trivy() {
    if command -v trivy &>/dev/null; then
        log_info "trivy already installed: $(trivy --version 2>&1 | head -1)"
        return
    fi

    log_info "Installing trivy ${TRIVY_VERSION}..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq wget apt-transport-https gnupg lsb-release

    wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo gpg --dearmor -o /usr/share/keyrings/trivy.gpg
    echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" | \
        sudo tee /etc/apt/sources.list.d/trivy.list > /dev/null
    sudo apt-get update -qq
    sudo apt-get install -y -qq "trivy=${TRIVY_VERSION}-1" || sudo apt-get install -y -qq trivy

    log_info "trivy installed: $(trivy --version 2>&1 | head -1)"
}

# ============================================================
# gitleaks — secrets detection
# ============================================================

install_gitleaks() {
    if command -v gitleaks &>/dev/null; then
        log_info "gitleaks already installed: $(gitleaks version 2>&1)"
        return
    fi

    log_info "Installing gitleaks ${GITLEAKS_VERSION}..."
    local arch
    arch="$(dpkg --print-architecture)"
    case "$arch" in
        amd64) arch="x64" ;;
        arm64) arch="arm64" ;;
    esac

    local url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${arch}.tar.gz"
    local tmpdir
    tmpdir="$(mktemp -d)"
    wget -qO "${tmpdir}/gitleaks.tar.gz" "$url"
    tar -xzf "${tmpdir}/gitleaks.tar.gz" -C "$tmpdir"
    sudo mv "${tmpdir}/gitleaks" /usr/local/bin/gitleaks
    sudo chmod +x /usr/local/bin/gitleaks
    rm -rf "$tmpdir"

    log_info "gitleaks installed: $(gitleaks version 2>&1)"
}

# ============================================================
# pip-audit — Python dependency vulnerability scanner
# ============================================================

install_pip_audit() {
    if command -v pip-audit &>/dev/null; then
        log_info "pip-audit already installed: $(pip-audit --version 2>&1)"
        return
    fi

    log_info "Installing pip-audit..."
    pip3 install --quiet pip-audit
    log_info "pip-audit installed: $(pip-audit --version 2>&1)"
}

# ============================================================
# bandit — Python SAST scanner
# ============================================================

install_bandit() {
    if command -v bandit &>/dev/null; then
        log_info "bandit already installed: $(bandit --version 2>&1 | head -1)"
        return
    fi

    log_info "Installing bandit..."
    pip3 install --quiet bandit
    log_info "bandit installed: $(bandit --version 2>&1 | head -1)"
}

# ============================================================
# Run installations
# ============================================================

log_info "=== DR3 Audit Dependency Installer ==="
log_info "Target: Ubuntu/Debian"

install_trivy
install_gitleaks
install_pip_audit
install_bandit

log_info "=== All dependencies installed ==="
log_info ""
log_info "Installed tools:"
command -v trivy    && echo "  trivy:     $(trivy --version 2>&1 | head -1)" || log_warn "  trivy: NOT FOUND"
command -v gitleaks && echo "  gitleaks:  $(gitleaks version 2>&1)"          || log_warn "  gitleaks: NOT FOUND"
command -v pip-audit && echo "  pip-audit: $(pip-audit --version 2>&1)"      || log_warn "  pip-audit: NOT FOUND"
command -v bandit   && echo "  bandit:    $(bandit --version 2>&1 | head -1)" || log_warn "  bandit: NOT FOUND"
