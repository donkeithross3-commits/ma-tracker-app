# M&A Tracker - Deployment Guide

This guide will help you deploy the M&A Tracker application to production using Vercel (hosting) and Neon (PostgreSQL database).

## Total Cost: $0/month (Free Tier)

---

## Prerequisites

- GitHub account (to connect with Vercel)
- Vercel account (free tier) - https://vercel.com
- Neon account (free tier) - https://neon.tech

---

## Step 1: Set Up Neon Database (5 minutes)

### 1.1 Create Neon Account and Project
1. Go to https://neon.tech and sign up for a free account
2. Create a new project:
   - **Project Name**: `ma-tracker-production`
   - **Region**: Choose closest to your users (US East or US West)
   - **PostgreSQL Version**: Latest (default)
3. Save your connection string (you'll need it for Vercel)

### 1.2 Get Your Connection String
1. In Neon dashboard, go to your project
2. Click on "Connection Details"
3. Copy the connection string - it should look like:
   ```
   postgresql://user:password@ep-xxx-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### 1.3 Set Up Database Schema
You'll run migrations after deploying to Vercel, or you can do it now using:
```bash
# Set your Neon DATABASE_URL temporarily
export DATABASE_URL="postgresql://user:password@ep-xxx-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"

# Push schema to Neon
npx prisma db push

# Seed the database with users and deals
npx prisma db seed
```

---

## Step 2: Prepare Repository (2 minutes)

### 2.1 Push to GitHub
If you haven't already, push your code to GitHub:

```bash
cd /Users/donaldross/ma-tracker-app

# Initialize git if not already done
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit - M&A Tracker with authentication"

# Create GitHub repository and push
# (Follow GitHub instructions to create a new repo)
git remote add origin https://github.com/YOUR-USERNAME/ma-tracker-app.git
git branch -M main
git push -u origin main
```

---

## Step 3: Deploy to Vercel (5 minutes)

### 3.1 Connect Vercel to GitHub
1. Go to https://vercel.com and sign in
2. Click "Add New Project"
3. Import your GitHub repository: `ma-tracker-app`
4. Vercel will auto-detect it's a Next.js project

### 3.2 Configure Environment Variables
Before clicking "Deploy", add these environment variables:

| Name | Value | Notes |
|------|-------|-------|
| `DATABASE_URL` | Your Neon connection string | From Step 1.2 |
| `AUTH_SECRET` | Generate a secure secret | Run: `openssl rand -base64 32` |

To add environment variables:
1. Scroll down to "Environment Variables" section
2. Add each variable one by one
3. Select "Production", "Preview", and "Development" for each

### 3.3 Deploy
1. Click "Deploy"
2. Wait 2-3 minutes for deployment to complete
3. Once done, you'll get a URL like: `https://ma-tracker-app.vercel.app`

### 3.4 Set Up Database (if not done in Step 1.3)
1. After first deployment, go to your Vercel project
2. Click on "Settings" → "Environment Variables"
3. Open a terminal and run:
   ```bash
   # Use your Vercel deployment URL
   vercel env pull .env.production

   # Or manually set DATABASE_URL and run:
   export DATABASE_URL="your-neon-connection-string"
   npx prisma db push
   npx prisma db seed
   ```

Alternatively, use Vercel CLI:
```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Link to your project
vercel link

# Run migrations in Vercel environment
vercel env pull
npx prisma db push
npx prisma db seed
```

---

## Step 4: Test the Deployment (2 minutes)

### 4.1 Access the Application
1. Visit your Vercel URL: `https://ma-tracker-app.vercel.app`
2. You should be redirected to `/login`

### 4.2 Test Authentication
Login with one of the seeded accounts:

**Account 1 (Admin):**
- Email: `don@limitlessventures.us`
- Password: `limitless2025`

**Account 2 (Analyst):**
- Email: `luis@limitlessventures.us`
- Password: `limitless2025`

### 4.3 Verify Functionality
- ✅ Login works
- ✅ Dashboard loads with 69 deals
- ✅ Can view individual deals
- ✅ Can edit deals
- ✅ Sign out works

---

## Step 5: Configure Custom Domain (Optional)

If you want to use a custom domain:

1. Go to Vercel project → "Settings" → "Domains"
2. Add your domain (e.g., `ma-tracker.limitlessventures.us`)
3. Follow Vercel's DNS instructions
4. No need to update `AUTH_SECRET` - NextAuth will work automatically

---

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string | `postgresql://user:pass@ep-xxx.neon.tech/db` |
| `AUTH_SECRET` | Yes | NextAuth secret for JWT signing | Generate with: `openssl rand -base64 32` |

---

## Post-Deployment Tasks

### Change Default Passwords
⚠️ **IMPORTANT**: After first login, both users should change their passwords from the default `limitless2025`.

To add password change functionality (future enhancement):
1. Create a "Profile" or "Settings" page
2. Add password update form
3. Use bcrypt to hash new passwords

### Set Up Automatic Backups

**Neon Backups (Included in Free Tier):**
- Neon automatically backs up your database
- Free tier: 7-day retention
- Can restore from any point in time

**Additional Google Drive Backup:**
For manual exports to Google Drive:
```bash
# Export data
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Upload to Google Drive manually or use rclone
```

---

## Monitoring & Maintenance

### Vercel Monitoring
- **Analytics**: Available in Vercel dashboard (free tier)
- **Logs**: View in Vercel dashboard → Project → Logs
- **Alerts**: Vercel sends email alerts for deployment failures

### Neon Monitoring
- **Dashboard**: Monitor connections, storage, and queries
- **Free Tier Limits**:
  - 512 MB storage
  - 10 concurrent connections
  - This is sufficient for 2 users

---

## Troubleshooting

### Issue: "Database connection failed"
**Solution**: Check that DATABASE_URL is correctly set in Vercel environment variables

### Issue: "Invalid credentials" on login
**Solution**:
1. Verify database was seeded: Check Neon dashboard
2. Re-run seed script if needed
3. Verify password is `limitless2025`

### Issue: "Middleware error" or "AUTH_SECRET missing"
**Solution**: Generate new AUTH_SECRET and add to Vercel environment variables

### Issue: "Too many database connections"
**Solution**:
1. Neon free tier allows 10 concurrent connections
2. Prisma uses connection pooling by default
3. If needed, add `?connection_limit=5` to DATABASE_URL

---

## Costs & Scaling

### Current Setup (Free Tier)
- **Vercel Free Tier**:
  - Unlimited deployments
  - 100 GB bandwidth/month
  - Sufficient for 2 users

- **Neon Free Tier**:
  - 512 MB storage (sufficient for thousands of deals)
  - 10 concurrent connections
  - 7-day backups

### When to Upgrade

**Upgrade Vercel** ($20/month) when:
- Need more than 100 GB bandwidth/month
- Want custom domains with more flexibility
- Need priority support

**Upgrade Neon** ($19/month) when:
- Storage exceeds 512 MB
- Need more than 10 concurrent connections
- Want 30-day backup retention

For your 2-user setup tracking 69 deals, free tier should last indefinitely.

---

## Next Steps

1. **✅ Deploy to Vercel** following steps above
2. **✅ Test authentication** with both user accounts
3. **✅ Verify all 69 deals** loaded correctly
4. **📅 Monday**: Share Vercel URL with Luis for testing
5. **📅 Tuesday**: Go live with production access

---

## Support

- **Vercel Docs**: https://vercel.com/docs
- **Neon Docs**: https://neon.tech/docs
- **Next.js Docs**: https://nextjs.org/docs
- **NextAuth Docs**: https://authjs.dev

---

**Deployment Checklist:**
- [ ] Neon database created
- [ ] Database schema pushed with `prisma db push`
- [ ] Database seeded with users and deals
- [ ] GitHub repository created and pushed
- [ ] Vercel project created and linked to GitHub
- [ ] Environment variables set in Vercel
- [ ] Application deployed successfully
- [ ] Login tested with both accounts
- [ ] All 69 deals visible in dashboard
- [ ] Can edit and save deal changes
- [ ] Sign out functionality works
