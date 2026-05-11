# Backend Deployment Verification

## Pre-Deployment Checklist

### Local Testing
```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Create local .env file
cp .env.example .env.local
# Edit .env.local with your local MongoDB and Groq keys

# 3. Run locally
uvicorn main:app --host 0.0.0.0 --port 8000

# 4. Test endpoints
curl http://localhost:8000/api/health        # Check if server responds
curl http://localhost:8000/api/history       # Check MongoDB connectivity
```

## Render Deployment Steps

### 1. Push to GitHub
```bash
# Make sure .env files are NOT committed
git status  # Verify no .env files listed
git add .
git commit -m "Prepare backend for Render deployment"
git push origin main
```

### 2. Create Render Web Service
- Go to https://dashboard.render.com
- Click "New +" → "Web Service"
- Connect GitHub repository
- Select your repo and branch (main)
- Configure:
  - **Name**: `testops-backend`
  - **Environment**: Python 3
  - **Build Command**: `pip install -r requirements.txt`
  - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`

### 3. Add Environment Variables
In Render dashboard → Environment tab, add:
```
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxx
ALLOWED_ORIGINS=https://your-frontend.onrender.com
```

### 4. Deploy
Click "Create Web Service" — Render automatically deploys

## Post-Deployment Verification

### Check Render Logs
1. Go to your Web Service in Render dashboard
2. Click "Logs" tab
3. Should see:
   ```
   Uvicorn running on http://0.0.0.0:PORT
   ```

### Test API Endpoint
```bash
# Replace with your actual Render URL
curl https://testops-backend.onrender.com/api/health

# Should return:
# {"status": "ok"}
```

### Test with Frontend
1. Update frontend `.env.local`:
   ```
   REACT_APP_API_URL=https://testops-backend.onrender.com
   ```
2. Build and deploy frontend
3. Check browser console for any CORS errors
4. Try creating a scan from the frontend

## Troubleshooting

### Deploy Fails During Build
```
Error: pip install failed
```
**Solution**: Check `requirements.txt` syntax and versions

```bash
# Verify locally:
pip install -r requirements.txt
```

### Service won't start (Health check failed)
```
Health check failed after multiple retries
```
**Causes**:
- Start command is wrong
- App crashed during startup
- Port binding failed

**Debug**:
1. Check Render logs for actual error
2. Verify start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
3. Test locally: `uvicorn main:app --host 127.0.0.1 --port 8000`

### MongoDB connection fails
```
Error: ServerSelectionTimeoutError
```
**Solutions**:
1. Verify `MONGODB_URI` format is correct
2. In MongoDB Atlas → Security → Network Access
   - Ensure Render IP is whitelisted (add `0.0.0.0/0` for testing)
3. Test locally with same URI before deploying

### CORS errors on frontend
```
Access to XMLHttpRequest blocked by CORS policy
```
**Solution**:
1. Check `ALLOWED_ORIGINS` in Render environment variables
2. Must match exactly (including protocol and domain)
3. Example: `https://your-frontend.onrender.com`
4. For multiple origins, use comma-separated: `https://example.com,https://www.example.com`

### Groq API key not found
```
The AI assistant backend is not configured
```
**Solution**:
1. In Render dashboard → Environment
2. Verify `GROQ_API_KEY` is set
3. Trigger redeploy after setting it

## Performance Monitoring

### Monitor Real-Time Logs
```
Render Dashboard → Your Service → Logs
```

### Check Resource Usage
```
Render Dashboard → Your Service → Metrics
```
Monitor CPU and memory usage

### Scale Up if Needed
```
Render Dashboard → Your Service → Instance Type
```
Upgrade from free tier to paid if required

## Environment Variables Reference

| Variable | Required | Default | Example |
|----------|----------|---------|---------|
| `MONGODB_URI` | Yes | None | `mongodb+srv://user:pwd@cluster.mongodb.net` |
| `GROQ_API_KEY` | Yes | None | `gsk_xxxxxxxxxxxxx` |
| `ALLOWED_ORIGINS` | No | `*` | `https://frontend.onrender.com` |

## Security Checklist

- [ ] `.env` files are in `.gitignore`
- [ ] No secrets committed to GitHub
- [ ] ALLOWED_ORIGINS is restricted to your frontend domain
- [ ] MongoDB has strong password
- [ ] MongoDB network access restricted (or Render IP whitelisted)
- [ ] GROQ_API_KEY is not exposed in logs or responses

## API Status Endpoints

These endpoints are automatically available:

```bash
# Info endpoint (no auth required)
GET /docs          # Swagger UI documentation
GET /redoc         # ReDoc documentation
GET /openapi.json  # OpenAPI schema
```

## Need Help?

- **Render Status**: https://status.render.com
- **FastAPI Docs**: https://fastapi.tiangolo.com/deployment/concepts/
- **Uvicorn Docs**: https://www.uvicorn.org/
- **MongoDB Atlas Support**: https://docs.mongodb.com/atlas/
