#!/usr/bin/env bash
set -euo pipefail

MCP_KEY=$(openssl rand -hex 32)

echo ""
echo "===== Generated MCP_KEY ====="
echo "$MCP_KEY"
echo ""
echo "===== Step 1: Set in Cloudflare Worker (run in project root) ====="
echo "npx wrangler secret put MCP_KEY"
echo "(paste the key above when prompted)"
echo ""
echo "===== Step 2: Set in Cloud Run ====="
echo "gcloud run services update png2ss \\"
echo "  --update-env-vars MCP_KEY=$MCP_KEY \\"
echo "  --region us-central1"
echo ""
echo "gcloud run services update gif2ss \\"
echo "  --update-env-vars MCP_KEY=$MCP_KEY \\"
echo "  --region us-central1"
echo ""
echo "===== Step 3: Save to your local .env (for reference only) ====="
echo "MCP_KEY=$MCP_KEY"
echo ""
echo "IMPORTANT: This script generates a new key every time it runs."
echo "Run it only once and save the output."
