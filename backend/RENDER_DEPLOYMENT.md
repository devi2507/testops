# Render Deployment Guide for TestOps Backend

## Prerequisites

- Render.com account
- MongoDB Atlas cluster (free tier available)
- Groq API key (free tier available at https://console.groq.com)
- GitHub repository with backend code

## Step 1: Prepare Environment Variables

### Create a `.env.local` file (local development only):
```bash
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority
GROQ_API_KEY=your_groq_api_key_here
ALLOWED_ORIGINS=http://localhost:3000
```

**Do NOT commit `.env` to GitHub** — `.env.local` is in `.gitignore`

## Step 2: Deploy on Render

### Create New Web Service:

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New +** → **Web Service**
3. Connect your GitHub repository
4. Configure service:

| Setting | Value |
|---------|-------|
| **Name** | `testops-backend` |
| **Environment** | `Python 3` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn main:app --host 0.0.0.0 --port $PORT` |

### Add Environment Variables in Render Dashboard:

Go to **Environment** tab and add:

| Key | Value |
|-----|-------|
| `MONGODB_URI` | Your MongoDB Atlas connection string |
| `GROQ_API_KEY` | Your Groq API key |
| `ALLOWED_ORIGINS` | `https://your-frontend.render.com,https://www.your-frontend.render.com` |

**Never paste sensitive values in build scripts** — always use Render's environment variable management.

### Deploy:

- Render automatically deploys on push to main branch
- Deployment logs show at: https://dashboard.render.com
- Your API will be available at: `https://testops-backend.onrender.com`

## Step 3: Configure Frontend for Production

Update frontend `.env.local`:
```bash
REACT_APP_API_URL=https://testops-backend.onrender.com
```

Then rebuild and redeploy frontend.

## Monitoring & Troubleshooting

### View Logs:
```bash
# On Render dashboard → Logs tab
# Errors typically show immediately
```

### Common Issues:

#### ❌ CORS Error on Frontend
**Problem:** Browser blocks requests from frontend to backend

**Solution:**
1. Update `ALLOWED_ORIGINS` in Render environment variables
2. Must include protocol (https://), no trailing slash
3. Separate multiple origins with commas

#### ❌ "Cannot reach MongoDB"
**Problem:** Connection string is invalid or network access not allowed

**Solution:**
1. Verify `MONGODB_URI` is correct (includes username, password, cluster)
2. In MongoDB Atlas → Network Access → Add Render IP (`0.0.0.0/0` for testing, restrict later)
3. Test connection string locally before deploying

#### ❌ "GROQ_API_KEY not found"
**Problem:** Environment variable not set in Render

**Solution:**
1. Verify `GROQ_API_KEY` is set in Render → Environment
2. Trigger a redeploy after setting the variable
3. Check logs to confirm value is loaded

#### ❌ "Health check timeout"
**Problem:** API takes too long to start

**Solution:**
1. Render default health check hits `/` (info)
2. If startup is slow, Render may restart the service
3. Add `/health` endpoint if needed (optional)

## Environment Variables Explained

### Required:
- **`MONGODB_URI`**: MongoDB Atlas connection string
  - Format: `mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority`
  
- **`GROQ_API_KEY`**: Groq API key for AI analysis
  - Get at: https://console.groq.com/keys
  - Free tier includes enough quota for development

### Optional:
- **`ALLOWED_ORIGINS`**: CORS allowed origins (default: `*`)
  - Development: `*`
  - Production: `https://your-frontend.com`

## Production Checklist

- [ ] Backend deployed on Render
- [ ] MongoDB Atlas cluster created and secured
- [ ] Groq API key obtained and added to environment
- [ ] `ALLOWED_ORIGINS` set to your frontend domain
- [ ] `.env` file is in `.gitignore` (verify: `git status`)
- [ ] Frontend `REACT_APP_API_URL` points to Render backend
- [ ] Frontend built and deployed
- [ ] Test API connectivity from frontend (should see data flowing)
- [ ] Monitor logs for errors: https://dashboard.render.com

## Scaling & Performance

- Render free tier: 0.5 CPU, 512 MB RAM
- If backend grows, upgrade plan in Render dashboard
- For production: use paid PostgreSQL + MongoDB Atlas paid tier

## Architecture

- **Framework**: FastAPI (async-first, production-ready)
- **Server**: Uvicorn (ASGI, designed for containerized deployment)
- **Database**: MongoDB (Atlas for managed service)
- **AI Engine**: Groq API (via HTTP, no local LLM)
- **Deployment**: Render (container-based with auto-scaling)

## Security Notes

- ✅ `.env` files never committed to GitHub
- ✅ API keys managed via Render environment variables
- ✅ CORS whitelist restricts cross-origin requests
- ✅ HTTPS enforced on Render (free SSL certificate)
- ✅ MongoDB password-protected and network-restricted
- ⚠️ API is public — implement authentication if exposing to clients

## Support

- Render Status: https://status.render.com
- FastAPI Docs: https://fastapi.tiangolo.com
- Groq API Docs: https://console.groq.com/docs
- MongoDB Atlas Docs: https://docs.mongodb.com/atlas
