# Deployment Guide for Options Scanner Python Service

## Important Note about Interactive Brokers

The Python service requires a connection to Interactive Brokers TWS (Trader Workstation) or IB Gateway to fetch real-time market data. This presents deployment challenges:

### Deployment Options

#### Option 1: Local Development Only (Recommended for now)
Run the Python service locally where you have IB TWS/Gateway installed:

```bash
cd python-service
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Set `PYTHON_SERVICE_URL=http://localhost:8000` in your Next.js `.env.local`

#### Option 2: Cloud Deployment with IB Gateway (Advanced)
Deploy to a cloud VM where you can install and run IB Gateway:
- AWS EC2
- Google Cloud Compute Engine
- DigitalOcean Droplet
- Azure VM

Requirements:
- Install IB Gateway on the VM
- Configure IB Gateway to run headless (with VNC or Xvfb)
- Set up API authentication
- Run the Python service on the same VM

#### Option 3: Railway/Render (Limited Functionality)
You can deploy the service to Railway or Render, but it won't be able to connect to IB unless you:
1. Set up a secure tunnel to your local IB Gateway, OR
2. Use IB Gateway cloud hosting service (if available)

### Railway Deployment (if IB connection is available)

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login and initialize:
```bash
cd python-service
railway login
railway init
```

3. Deploy:
```bash
railway up
```

4. Set environment variables in Railway dashboard:
- `IB_HOST`: Your IB Gateway host
- `IB_PORT`: Your IB Gateway port (7497 or 7496)
- `PORT`: 8000

### Render Deployment (if IB connection is available)

1. Push code to GitHub
2. Connect repository to Render
3. Render will auto-detect the `render.yaml` configuration
4. Set environment variables in Render dashboard

### Docker Local Testing

```bash
cd python-service
docker build -t ma-options-scanner .
docker run -p 8000:8000 ma-options-scanner
```

Note: IB Gateway must be accessible from within the container.

### Environment Variables

Required:
- `IB_HOST`: Interactive Brokers host (default: 127.0.0.1)
- `IB_PORT`: Interactive Brokers port (default: 7497)
- `PORT`: Service port (default: 8000)

Optional:
- `ALLOWED_ORIGINS`: CORS origins (comma-separated)

### Health Check

Once deployed, test the service:
```bash
curl http://your-service-url/health
```

### Connecting Next.js Frontend

Update `.env.local` in the Next.js app:
```
PYTHON_SERVICE_URL=http://your-deployed-service-url
```

Or for local:
```
PYTHON_SERVICE_URL=http://localhost:8000
```

### Troubleshooting

1. **Service can't connect to IB**: Ensure IB TWS/Gateway is running and accessible
2. **CORS errors**: Update `ALLOWED_ORIGINS` to include your frontend URL
3. **Timeout errors**: IB data fetching can be slow; consider increasing timeouts
4. **No option data**: Check that you have appropriate IB market data subscriptions

### Production Recommendations

For production use, consider:
1. Running IB Gateway on a dedicated server/VM
2. Implementing caching to reduce IB API calls
3. Adding authentication to the Python API
4. Setting up monitoring and alerting
5. Using a message queue for async data fetching
6. Implementing rate limiting to avoid IB API limits
