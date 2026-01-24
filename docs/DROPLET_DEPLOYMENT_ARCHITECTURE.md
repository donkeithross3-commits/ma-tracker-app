# Droplet Deployment Architecture - Critical Learnings

**Last Updated:** December 26, 2025  
**Droplet:** 134.199.204.12 (dr3-ma-dev)

---

## Critical Discovery: Code is Baked Into Docker Image

### The Problem We Discovered

Initially, we thought code changes could be deployed by just syncing files to the droplet. **This was wrong.**

The droplet runs Docker containers where:
1. **Code is baked into the Docker image** during build
2. **Only `/app/data/krj` is mounted as a volume** (for CSV data)
3. **Application code is NOT mounted** - it's copied into the image at build time

### Why This Matters

When you sync files to the host:
```bash
rsync app/krj/page.tsx don@droplet:/home/don/apps/ma-tracker-app/app/krj/
```

The running container **does not see these changes** because:
- The container uses code from the Docker image (built earlier)
- The host filesystem at `/home/don/apps/ma-tracker-app/` is NOT mounted into the container
- Only `/home/don/apps/data/krj` is mounted (for data files)

### The Correct Deployment Process

```bash
# 1. Sync code to the build directory on droplet
rsync -avz app/ don@droplet:/home/don/apps/ma-tracker-app/app/

# 2. Build a NEW Docker image with the updated code
ssh don@droplet "cd /home/don/apps/ma-tracker-app && docker build --no-cache -t ma-tracker-app-dev -f Dockerfile ."

# 3. Restart the container to use the new image
ssh don@droplet "cd /home/don/apps && docker compose down && docker compose up -d web"
```

---

## Architecture Details

### Docker Compose Configuration

**Location:** `/home/don/apps/docker-compose.yml`

```yaml
services:
  web:
    image: ma-tracker-app-dev          # ← Uses pre-built image (not built by compose)
    container_name: ma-tracker-app-web
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NEXTAUTH_URL: "http://134.199.204.12:3000"
    working_dir: /app
    volumes:
      - ./data/krj:/app/data/krj       # ← ONLY data is mounted, not code!
```

**Key Points:**
- No `build:` section - compose doesn't build the image
- Uses existing image named `ma-tracker-app-dev`
- Only mounts data directory, not application code

### Dockerfile

**Location:** `/home/don/apps/ma-tracker-app/Dockerfile`

```dockerfile
FROM node:22-bullseye

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Copy prisma schema
COPY prisma ./prisma

# Install deps (runs prisma generate)
RUN npm install

# Copy the rest of the app ← CODE IS BAKED IN HERE
COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]  # ← Runs in dev mode (not production)
```

**Key Points:**
- Runs in **dev mode** (`npm run dev`), not production
- Code is copied into image with `COPY . .`
- Changes to host files don't affect running container
- Must rebuild image to pick up code changes

### Directory Structure on Droplet

```
/home/don/apps/
├── docker-compose.yml           # Orchestration (references image)
├── data/
│   └── krj/                     # Mounted into container (read-only)
│       ├── latest_equities.csv
│       ├── latest_etfs_fx.csv
│       ├── latest_sp500.csv
│       ├── latest_sp100.csv
│       └── metadata.json
├── ma-tracker-app/              # Build directory (NOT mounted)
│   ├── Dockerfile
│   ├── app/
│   │   └── krj/
│   │       └── page.tsx         # ← Synced here, then baked into image
│   ├── components/
│   ├── package.json
│   └── ...
└── py_proj/
    └── daily_data/              # Mounted into krj-batch container
```

---

## Deployment Workflow (Correct)

### Step-by-Step Process

1. **Sync Files to Build Directory**
   ```bash
   rsync -avz \
     --exclude 'node_modules' \
     --exclude '.next' \
     --exclude '.git' \
     /Users/donaldross/dev/ma-tracker-app/ \
     don@134.199.204.12:/home/don/apps/ma-tracker-app/
   ```

2. **Build Docker Image**
   ```bash
   ssh don@134.199.204.12 \
     "cd /home/don/apps/ma-tracker-app && \
      docker build --no-cache -t ma-tracker-app-dev -f Dockerfile ."
   ```
   - Must run from `/home/don/apps/ma-tracker-app` (where code was synced)
   - `--no-cache` ensures fresh build (recommended for code changes)
   - Tags image as `ma-tracker-app-dev` (matches docker-compose.yml)

3. **Restart Container**
   ```bash
   ssh don@134.199.204.12 \
     "cd /home/don/apps && \
      docker compose down && \
      docker compose up -d web"
   ```
   - `down` stops and removes old container
   - `up -d` creates new container from new image

4. **Verify Deployment**
   ```bash
   # Check container is running
   ssh don@134.199.204.12 "docker compose ps"
   
   # Check logs
   ssh don@134.199.204.12 "docker compose logs --tail 20 web"
   
   # Verify code in container
   ssh don@134.199.204.12 \
     "docker exec ma-tracker-app-web cat /app/app/krj/page.tsx | head -20"
   ```

### Why Each Step is Necessary

| Step | Why It's Critical |
|------|-------------------|
| **Sync Files** | Updates source code on droplet host |
| **Build Image** | Bakes new code into Docker image |
| **Restart Container** | Loads new image (old container uses old image) |
| **Verify** | Confirms changes are actually deployed |

---

## Common Mistakes & Fixes

### Mistake 1: Only Syncing Files

❌ **Wrong:**
```bash
rsync app/ don@droplet:/home/don/apps/ma-tracker-app/app/
# Container still shows old code!
```

✅ **Correct:**
```bash
rsync app/ don@droplet:/home/don/apps/ma-tracker-app/app/
ssh don@droplet "cd /home/don/apps/ma-tracker-app && docker build --no-cache -t ma-tracker-app-dev ."
ssh don@droplet "cd /home/don/apps && docker compose down && docker compose up -d web"
```

### Mistake 2: Using `docker compose build`

❌ **Wrong:**
```bash
ssh don@droplet "cd /home/don/apps && docker compose build web"
# Error: no build configuration found!
```

✅ **Correct:**
```bash
ssh don@droplet "cd /home/don/apps/ma-tracker-app && docker build -t ma-tracker-app-dev ."
# Build from the directory with Dockerfile
```

### Mistake 3: Only Restarting Container

❌ **Wrong:**
```bash
ssh don@droplet "docker compose restart web"
# Uses old image, doesn't pick up new code!
```

✅ **Correct:**
```bash
ssh don@droplet "docker compose down && docker compose up -d web"
# Recreates container from new image
```

### Mistake 4: Not Using `--no-cache`

❌ **Risky:**
```bash
docker build -t ma-tracker-app-dev .
# May use cached layers with old code
```

✅ **Safe:**
```bash
docker build --no-cache -t ma-tracker-app-dev .
# Guarantees fresh build with new code
```

---

## Verification Commands

### Check What's Actually Running

```bash
# 1. Verify container is using new image
ssh don@droplet "docker inspect ma-tracker-app-web | grep Image"

# 2. Check file timestamp in container
ssh don@droplet "docker exec ma-tracker-app-web ls -la /app/app/krj/page.tsx"

# 3. Check actual code in container
ssh don@droplet "docker exec ma-tracker-app-web cat /app/app/krj/page.tsx | grep 'KRJ Weekly Signals'"

# 4. Compare host vs container
ssh don@droplet "ls -la /home/don/apps/ma-tracker-app/app/krj/page.tsx"
ssh don@droplet "docker exec ma-tracker-app-web ls -la /app/app/krj/page.tsx"
# Timestamps will differ - container has build time, host has sync time
```

### Debugging Deployment Issues

```bash
# If changes aren't showing up:

# 1. Verify files synced to host
ssh don@droplet "cat /home/don/apps/ma-tracker-app/app/krj/page.tsx | grep 'YOUR_CHANGE'"

# 2. Check if image was rebuilt
ssh don@droplet "docker images ma-tracker-app-dev"
# Look at "CREATED" timestamp - should be recent

# 3. Check if container is using new image
ssh don@droplet "docker ps -a | grep ma-tracker-app-web"
# Look at "CREATED" timestamp - should match image

# 4. Check container logs for errors
ssh don@droplet "docker compose logs --tail 50 web"
```

---

## Browser Caching

Even after correct deployment, browsers aggressively cache Next.js pages.

### Always Use Hard Refresh

- **Mac:** `Cmd + Shift + R`
- **Windows/Linux:** `Ctrl + Shift + R`
- **Alternative:** Open in incognito/private window

### Why Hard Refresh is Critical

Next.js serves static assets with cache headers. Without hard refresh:
- Browser uses cached HTML
- Cached JavaScript bundles
- Cached CSS styles
- Changes appear not deployed (but they are!)

---

## Automated Deployment Script

**Location:** `/Users/donaldross/dev/ma-tracker-app/scripts/deploy-to-droplet.sh`

**Usage:**
```bash
cd /Users/donaldross/dev/ma-tracker-app
./scripts/deploy-to-droplet.sh full
```

**What It Does:**
1. Syncs all files to droplet
2. Builds Docker image with `--no-cache`
3. Restarts container
4. Verifies deployment
5. Reminds you to hard refresh browser

**Modes:**
- `quick`: Rebuild without `--no-cache` (faster, but may miss changes)
- `full`: Rebuild with `--no-cache` (slower, but guaranteed fresh)
- `batch`: Only run krj-batch container (for data updates)

---

## Key Takeaways

### For Future Deployments

1. ✅ **Always rebuild the Docker image** after syncing code
2. ✅ **Use `--no-cache`** for code changes (not just data)
3. ✅ **Restart with `down` then `up`** (not just `restart`)
4. ✅ **Verify code in container** (not just on host)
5. ✅ **Hard refresh browser** (not just reload)

### Architecture Understanding

- **Code:** Baked into Docker image at build time
- **Data:** Mounted as volume, changes immediately visible
- **Dev Mode:** Runs `npm run dev` (not production build)
- **No Hot Reload:** Container doesn't watch host files
- **Image Name:** `ma-tracker-app-dev` (referenced by docker-compose)

### Common Gotchas

- Syncing files alone doesn't deploy changes
- `docker compose build` doesn't work (no build config)
- Container restart doesn't pick up new image
- Browser caching hides successful deployments
- Host file timestamps ≠ container file timestamps

---

## Future Improvements

### Consider for Production

1. **Production Build:** Use `npm run build` + `npm start` instead of `npm run dev`
2. **Volume Mounting:** Mount code as volume for faster iteration (dev only)
3. **Build in Compose:** Add `build:` section to docker-compose.yml
4. **CI/CD Pipeline:** Automate sync → build → deploy
5. **Health Checks:** Add proper health check endpoint
6. **Rollback Plan:** Keep previous image tagged for quick rollback

### For Now (Working Solution)

Current setup works well for:
- Small team (1-2 developers)
- Infrequent deployments
- Manual quality control
- Simple rollback (redeploy previous code)

---

**Remember:** When in doubt, rebuild the image! It's the only way to guarantee code changes are deployed.

---

*Last verified: December 26, 2025*  
*Deployment successful with this process*

