#!/bin/bash
# Render Web Service Configuration
# This file documents the exact settings needed to deploy on Render.com

# Use this as a reference when setting up your Web Service on Render

# Build Command:
# pip install -r requirements.txt

# Start Command:
# uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers --no-server-header

# Environment Variables to set in Render Dashboard:
# MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net
# GROQ_API_KEY=your_api_key_here
# ALLOWED_ORIGINS=https://your-frontend.onrender.com

# Notes:
# - Render automatically sets $PORT environment variable
# - Use 0.0.0.0 to listen on all interfaces (required for containerized deployment)
# - uvicorn with --host 0.0.0.0 and --port $PORT is production-grade
# - No need to use Gunicorn - Uvicorn handles async efficiently
