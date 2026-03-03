# Deploy Safety Checklist

## Pre-Deploy

1. Confirm changes are committed and scoped.
2. Confirm user-visible changes have release-note coverage.
3. Confirm no secrets appear in diff, logs, or docs.

## Deploy

1. Use approved deploy script/path for target service.
2. Avoid ad-hoc command substitutions for production deploys.
3. Capture deploy command and timestamp in task notes.

## Post-Deploy

1. Check service health endpoint.
2. Check one critical user flow end-to-end.
3. Check logs for auth/routing errors.
4. Record rollback command/path if incident occurs.
