# KRJ Production Deployment - Final Checklist

**Use this checklist to ensure safe deployment**

---

## Pre-Deployment Validation (Local Machine)

### Build Verification
- [x] `npm run build` succeeds without errors
- [x] `.next/standalone/` directory created
- [x] `server.js` file exists in standalone output
- [x] Build completed in reasonable time (<2 minutes)

### File Verification
- [x] `Dockerfile.prod` exists and is correct
- [x] `docker-compose.prod.yml` exists and is correct
- [x] `next.config.ts` has `output: 'standalone'`
- [x] `next.config.ts` has `typescript.ignoreBuildErrors: true`
- [x] Disabled routes return 501 (not crash)

### Local Testing
- [ ] Run `npm start` locally
- [ ] Access http://localhost:3000/krj
- [ ] Verify basic auth prompts
- [ ] Verify CSV data loads (all 4 tabs)
- [ ] Check browser console for errors (should be none)
- [ ] Stop local server (Ctrl+C)

### Docker Testing (Optional but Recommended)
- [ ] Build Docker image: `docker build -f Dockerfile.prod -t ma-tracker-app-prod:test .`
- [ ] Run container: `docker run -d --name krj-test -p 3000:3000 -v $(pwd)/data/krj:/app/data/krj:ro --env-file .env.local ma-tracker-app-prod:test`
- [ ] Check logs: `docker logs krj-test`
- [ ] Access http://localhost:3000/krj
- [ ] Verify KRJ works in container
- [ ] Clean up: `docker stop krj-test && docker rm krj-test`

### Documentation Review
- [ ] Read `KRJ_PRODUCTION_DEPLOYMENT.md` completely
- [ ] Understand rollback procedure
- [ ] Note disabled features in `DISABLED_FEATURES.md`
- [ ] Have backup plan ready

---

## Server Deployment

### Phase 1: Backup
- [ ] SSH to droplet: `ssh don@<DROPLET_IP>`
- [ ] Navigate to apps: `cd /home/don/apps`
- [ ] Create backup: `tar -czf backup-$(date +%Y%m%d-%H%M%S).tar.gz docker-compose.yml ma-tracker-app/Dockerfile ma-tracker-app/.env.local`
- [ ] Verify backup: `ls -lh backup-*.tar.gz`
- [ ] Note backup filename for rollback

### Phase 2: File Sync
- [ ] Sync files from Mac to server (rsync or git)
- [ ] Verify `Dockerfile.prod` on server: `ls -l ma-tracker-app/Dockerfile.prod`
- [ ] Verify `next.config.ts` on server: `cat ma-tracker-app/next.config.ts | grep standalone`
- [ ] Verify disabled routes on server: `head -15 ma-tracker-app/app/api/research/fetch-filings/route.ts`

### Phase 3: Update docker-compose.yml
- [ ] Backup old compose: `cp docker-compose.yml docker-compose.yml.old`
- [ ] Copy new compose: `cp ma-tracker-app/docker-compose.prod.yml docker-compose.yml`
- [ ] Verify Dockerfile.prod referenced: `cat docker-compose.yml | grep Dockerfile.prod`
- [ ] Verify volume paths unchanged: `cat docker-compose.yml | grep "data/krj"`

### Phase 4: Build Production Image
- [ ] Build image: `docker compose build web`
- [ ] Wait for build to complete (2-5 minutes)
- [ ] Check for errors in build output
- [ ] Verify image created: `docker images | grep ma-tracker-app-prod`
- [ ] Note image size (~200-300MB)

### Phase 5: Cutover (DOWNTIME)
- [ ] Stop old container: `docker compose stop web`
- [ ] Remove old container: `docker compose rm -f web`
- [ ] Start new container: `docker compose up -d web`
- [ ] Watch logs: `docker compose logs -f web`
- [ ] Wait for "Ready in X ms" message
- [ ] Press Ctrl+C to stop following logs

**Downtime duration:** Record actual time (should be 30-60 seconds)

### Phase 6: Server Validation
- [ ] Check container status: `docker compose ps`
- [ ] Verify status shows "Up" and "healthy"
- [ ] Check logs for errors: `docker compose logs web | grep -i error`
- [ ] Test health endpoint: `curl -I http://localhost:3000`
- [ ] Verify 200 OK response
- [ ] Check resource usage: `docker stats ma-tracker-app-web --no-stream`
- [ ] Note CPU and RAM usage

### Phase 7: Functional Testing
- [ ] Test krj-batch: `docker compose run --rm krj-batch`
- [ ] Verify files copied successfully
- [ ] Check CSV files exist: `ls -lh data/krj/`
- [ ] Verify 4 CSV files present

---

## End-to-End Validation (From Your Mac)

### KRJ Dashboard Testing
- [ ] Open browser: `http://<DROPLET_IP>:3000/krj`
- [ ] Verify basic auth prompt appears
- [ ] Enter credentials (KRJ_BASIC_USER, KRJ_BASIC_PASS)
- [ ] Verify dashboard loads
- [ ] Check SP500 tab loads with data
- [ ] Check SP100 tab loads with data
- [ ] Check ETFs/FX tab loads with data
- [ ] Check Equities tab loads with data
- [ ] Verify no console errors in browser (F12)
- [ ] Note page load time (should be <2 seconds)

### Disabled Routes Testing
- [ ] Test fetch-filings: `curl http://<DROPLET_IP>:3000/api/research/fetch-filings`
- [ ] Verify returns 501 with "Not Implemented" message
- [ ] Test generate-report: `curl http://<DROPLET_IP>:3000/api/research/generate-report`
- [ ] Verify returns 501 with "Not Implemented" message

### Other Features Testing (Optional)
- [ ] Test M&A options: `http://<DROPLET_IP>:3000/ma-options`
- [ ] Test deals page: `http://<DROPLET_IP>:3000/deals`
- [ ] Verify other features work normally

---

## Performance Validation

### Resource Usage
- [ ] Check CPU usage: `docker stats ma-tracker-app-web --no-stream`
- [ ] Record CPU % (should be <5% idle)
- [ ] Record Memory usage (should be 150-250MB)
- [ ] Compare to previous dev mode usage

### Performance Metrics
- [ ] Measure page load time (KRJ dashboard)
- [ ] Should be <2 seconds
- [ ] Check startup time from logs
- [ ] Should be 3-5 seconds
- [ ] Verify image size: `docker images | grep ma-tracker-app-prod`
- [ ] Should be 200-300MB

### Stability Testing
- [ ] Let container run for 10 minutes
- [ ] Check logs for errors: `docker compose logs web | tail -50`
- [ ] Verify no crashes or restarts: `docker compose ps`
- [ ] Test auto-restart: `docker kill ma-tracker-app-web`
- [ ] Wait 30 seconds
- [ ] Verify container restarted: `docker compose ps`

---

## Post-Deployment Monitoring

### First Hour
- [ ] Monitor logs: `docker compose logs -f web`
- [ ] Watch for errors or warnings
- [ ] Check resource usage every 15 minutes
- [ ] Test KRJ dashboard multiple times
- [ ] Verify data updates correctly

### First 24 Hours
- [ ] Check container hasn't restarted unexpectedly
- [ ] Verify no memory leaks (memory usage stable)
- [ ] Test weekly KRJ update workflow
- [ ] Document actual performance gains
- [ ] Note any issues or improvements

---

## Success Criteria

### Must Pass (Critical)
- [x] Build succeeds on server
- [ ] Container starts successfully
- [ ] KRJ dashboard loads and displays data
- [ ] Basic auth works
- [ ] krj-batch runs successfully
- [ ] No critical errors in logs
- [ ] Disabled routes return 501 (not crash)

### Should Pass (Important)
- [ ] CPU usage <5% idle
- [ ] Memory usage <250MB
- [ ] Page load time <2 seconds
- [ ] Container auto-restarts on crash
- [ ] No errors after 1 hour

### Nice to Have (Bonus)
- [ ] CPU usage reduced by >50% vs dev mode
- [ ] Memory usage reduced by >50% vs dev mode
- [ ] Image size reduced by >70% vs dev mode
- [ ] Startup time <5 seconds

---

## Rollback Procedure (If Needed)

### When to Rollback
- Container won't start
- KRJ dashboard doesn't load
- CSV data not displaying
- Critical errors in logs
- krj-batch broken

### Rollback Steps
1. [ ] Stop broken container: `docker compose stop web`
2. [ ] Remove broken container: `docker compose rm -f web`
3. [ ] Restore old compose: `cp docker-compose.yml.old docker-compose.yml`
4. [ ] Rebuild old image: `docker compose build web`
5. [ ] Start old container: `docker compose up -d web`
6. [ ] Verify old service works: `curl http://localhost:3000/krj`
7. [ ] Check logs: `docker compose logs web`

**Rollback time:** Should be <5 minutes

---

## Documentation Updates

### After Successful Deployment
- [ ] Update `.claude-rules` with production status
- [ ] Document actual performance gains
- [ ] Note any issues encountered
- [ ] Update `DEPLOYMENT_KRJ.md` if needed
- [ ] Create deployment notes for future reference

### Share Results
- [ ] CPU/RAM usage before vs after
- [ ] Page load times
- [ ] Image size reduction
- [ ] Any surprises or learnings
- [ ] Recommendations for future deployments

---

## Final Sign-Off

### Deployment Complete When:
- [ ] All critical success criteria met
- [ ] KRJ dashboard fully functional
- [ ] No critical errors for 1 hour
- [ ] Performance gains documented
- [ ] Team notified of deployment

### Deployment Failed If:
- [ ] Cannot rollback successfully
- [ ] KRJ dashboard broken
- [ ] Data flow disrupted
- [ ] Critical errors persist

---

## Notes Section

**Deployment Date:** _______________

**Deployment Time:** _______________

**Downtime Duration:** _______________

**Issues Encountered:**
- 
- 
- 

**Performance Gains:**
- CPU: _____ → _____ (___% reduction)
- RAM: _____ → _____ (___% reduction)
- Load time: _____ → _____ seconds

**Next Steps:**
- 
- 
- 

---

*Use this checklist during deployment to ensure nothing is missed*
*Check off items as you complete them*
*Keep for future reference*

