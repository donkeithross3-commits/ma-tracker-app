#!/usr/bin/env bash
# Check: secrets/docker_env_audit
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "secrets/docker_env_audit"

REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

# Find all Dockerfiles
dockerfiles=()
while IFS= read -r f; do
    dockerfiles+=("$f")
done < <(find "$REPO_ROOT" -name 'Dockerfile*' \
    -not -path '*/node_modules/*' \
    -not -path '*/.git/*' \
    2>/dev/null || true)

# Find all docker-compose files
compose_files=()
while IFS= read -r f; do
    compose_files+=("$f")
done < <(find "$REPO_ROOT" -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' \
    2>/dev/null | grep -v node_modules | grep -v '.git' || true)

if [[ ${#dockerfiles[@]} -eq 0 && ${#compose_files[@]} -eq 0 ]]; then
    log_info "No Dockerfiles or docker-compose files found"
    finalize_check
fi

dockerfile_issues=0
compose_issues=0

# --- Scan Dockerfiles ---
for dockerfile in "${dockerfiles[@]}"; do
    rel_path="${dockerfile#"$REPO_ROOT"/}"
    log_info "Scanning Dockerfile: $rel_path"

    line_num=0
    while IFS= read -r line; do
        line_num=$((line_num + 1))

        # Skip comments and empty lines
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line// /}" ]] && continue

        # Look for ENV directives with hardcoded secret-like values
        # Match: ENV KEY_NAME=<non-empty-value>
        # But allow: empty values, ${VAR} references, ARG references
        if echo "$line" | grep -qiE '^[[:space:]]*ENV[[:space:]]'; then
            # Extract key=value pairs from ENV line
            # ENV can be: ENV KEY=VALUE or ENV KEY VALUE or ENV KEY=VALUE KEY2=VALUE2
            env_content="${line#*ENV}"
            env_content="${env_content#"${env_content%%[![:space:]]*}"}"  # trim leading whitespace

            # Check each potential secret pattern
            for pattern in 'KEY' 'PASSWORD' 'SECRET' 'TOKEN' 'API_KEY' 'APIKEY' 'PRIVATE' 'CREDENTIALS'; do
                if echo "$env_content" | grep -qiE "${pattern}[=[:space:]]"; then
                    # Extract the value part
                    # Get the value after the = sign for the matching key
                    value_part=$(echo "$env_content" | grep -oiE "[A-Z_]*${pattern}[A-Z_]*=[^ ]+" | head -1 | cut -d= -f2-) || true

                    # Skip safe patterns
                    [[ -z "$value_part" ]] && continue                      # empty value
                    [[ "$value_part" == '""' || "$value_part" == "''" ]] && continue  # empty quoted
                    [[ "$value_part" == *'${'* ]] && continue               # variable substitution
                    [[ "$value_part" == *'$('* ]] && continue               # command substitution
                    echo "$value_part" | grep -qiE '^\$[A-Z_]' && continue  # $VAR reference

                    # Skip known safe values
                    local_lower=$(echo "$value_part" | tr '[:upper:]' '[:lower:]')
                    [[ "$local_lower" == "production" || "$local_lower" == "development" || "$local_lower" == "staging" || "$local_lower" == "test" || "$local_lower" == "true" || "$local_lower" == "false" ]] && continue

                    json_finding "Hardcoded secret in Dockerfile: $rel_path" "$SEV_ALERT" \
                        "Line $line_num in $rel_path appears to contain a hardcoded secret (matched pattern: *${pattern}*). Use build args or runtime env vars instead."
                    dockerfile_issues=$((dockerfile_issues + 1))
                    break  # Only report once per line
                fi
            done
        fi
    done < "$dockerfile"
done

# --- Scan docker-compose files ---
for compose_file in "${compose_files[@]}"; do
    rel_path="${compose_file#"$REPO_ROOT"/}"
    log_info "Scanning docker-compose: $rel_path"

    # Check for environment sections with hardcoded secrets
    in_environment=false
    line_num=0

    while IFS= read -r line; do
        line_num=$((line_num + 1))

        # Skip comments
        [[ "$line" =~ ^[[:space:]]*# ]] && continue

        # Track if we're in an environment block
        if echo "$line" | grep -qE '^[[:space:]]+environment:'; then
            in_environment=true
            continue
        fi

        # If we hit a non-indented line or a new section, we're out of environment
        if $in_environment; then
            if echo "$line" | grep -qE '^[[:space:]]{2}[a-z]' && ! echo "$line" | grep -qE '^[[:space:]]{4,}'; then
                in_environment=false
                continue
            fi
        fi

        if ! $in_environment; then
            continue
        fi

        # Inside environment block — check for hardcoded secrets
        for pattern in 'KEY' 'PASSWORD' 'SECRET' 'TOKEN' 'API_KEY' 'APIKEY' 'PRIVATE' 'CREDENTIALS'; do
            if echo "$line" | grep -qiE "${pattern}"; then
                # Extract value part
                value_part=$(echo "$line" | sed 's/.*[=:][[:space:]]*//' | tr -d '"' | tr -d "'") || true

                # Skip safe patterns
                [[ -z "$value_part" ]] && continue
                [[ "$value_part" == *'${'* ]] && continue     # variable substitution
                [[ "$value_part" == *'$('* ]] && continue     # command substitution
                echo "$value_part" | grep -qE '^\$' && continue  # env var reference

                # Skip if line uses env_file reference style (no value, just key name)
                echo "$line" | grep -qE '^[[:space:]]+-[[:space:]]' && echo "$line" | grep -qvE '=' && continue

                # Skip keys without values (just listing env var names to pass through)
                if echo "$line" | grep -qE ':[[:space:]]*$' || echo "$line" | grep -qE '=[[:space:]]*$'; then
                    continue
                fi

                local_lower=$(echo "$value_part" | tr '[:upper:]' '[:lower:]')
                [[ "$local_lower" == "production" || "$local_lower" == "development" || "$local_lower" == "staging" || "$local_lower" == "true" || "$local_lower" == "false" ]] && continue

                json_finding "Possible hardcoded secret in docker-compose: $rel_path" "$SEV_WARN" \
                    "Line $line_num in $rel_path may contain a hardcoded secret in environment section (matched: *${pattern}*). Use env_file or variable substitution instead."
                compose_issues=$((compose_issues + 1))
                break  # Only report once per line
            fi
        done
    done < "$compose_file"

    # Also check if services use env_file directive (good practice)
    if ! grep -q 'env_file' "$compose_file" 2>/dev/null; then
        # Only warn if there ARE environment sections
        if grep -q 'environment:' "$compose_file" 2>/dev/null; then
            json_finding "docker-compose uses inline env, not env_file: $rel_path" "$SEV_INFO" \
                "$rel_path defines environment variables inline instead of using env_file. Consider using env_file for better secret management."
        fi
    fi
done

total_issues=$((dockerfile_issues + compose_issues))
if [[ $total_issues -eq 0 ]]; then
    log_info "No hardcoded secrets found in Docker configuration files"
fi

finalize_check
