# Production Deployment Guide

## Environment Variables

The React frontend now supports environment-based configuration for the backend API URL.

### Setup

1. **Copy the example environment file:**
   ```bash
   cp .env.example .env.local
   ```

2. **Edit `.env.local` with your production backend URL:**
   ```
   REACT_APP_API_URL=https://api.your-domain.com
   ```

### Available Variables

- **`REACT_APP_API_URL`** (required for production)
  - Backend API base URL
  - Default (development): `http://localhost:8000`
  - Example (production): `https://api.testpilot.example.com`

### Build & Deployment

#### Local Development
```bash
npm start
```
Uses default `http://localhost:8000` if `.env.local` is not set.

#### Production Build
```bash
# Create .env.local with production URL
echo "REACT_APP_API_URL=https://your-api-url.com" > .env.local

# Build optimized production bundle
npm run build
```

The `build/` folder is ready for deployment to any static hosting service (Vercel, Netlify, AWS S3, etc.).

### Deployment Checklist

- [ ] Backend API is deployed and accessible
- [ ] `.env.local` is created with correct `REACT_APP_API_URL`
- [ ] Backend URL uses HTTPS in production
- [ ] CORS is properly configured on backend
- [ ] Build succeeds: `npm run build`
- [ ] Test API connectivity before deploying
- [ ] Never commit `.env.local` to version control

### Hosting Options

1. **Vercel** - Recommended for React apps
   - Set `REACT_APP_API_URL` in Vercel dashboard environment variables

2. **Netlify** - Drag & drop deployment
   - Set `REACT_APP_API_URL` in build environment settings

3. **AWS S3 + CloudFront**
   - Build locally with `.env.local`
   - Upload to S3, configure CloudFront

4. **Docker** - For containerized deployment
   - Build with environment build args
   - Runtime API URL via environment variables

### Files Modified

- `src/services/api.js` - Uses `REACT_APP_API_URL` env var
- `src/components/AuditHistory.jsx` - Updated all fetch calls
- `src/components/ProgressConsole.jsx` - EventSource uses env var
- `src/pages/NewScanPage.jsx` - Updated fetch calls
- `.env.example` - Template for environment configuration
- `.gitignore` - Prevents `.env*` files from being committed

### Architecture Preserved

- No components were redesigned
- All existing functionality maintained
- Backward compatible with development setup
- Minimal code changes only
