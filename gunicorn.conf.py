"""
Gunicorn configuration for production.
Reads PORT and worker count from environment variables.
"""
import os

# Network
bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"

# Workers — 2 async workers is a safe default for autoscale containers
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
worker_class = "uvicorn.workers.UvicornWorker"

# Timeouts
timeout = 120
keepalive = 5

# Logging — send to stdout/stderr so Replit captures it
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info")
