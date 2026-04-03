#!/bin/bash

echo "=========================================="
echo " Compiling Application for Mobile Testing "
echo "=========================================="

echo "[1/2] Building Vite Frontend for single-port tunneling..."
cd rppg-client
npm install
npm run build
cd ..

echo "=========================================="
echo " Web App Compiled successfully. "
echo "=========================================="
echo ""
echo "[2/2] Starting Unified Server on port 8000..."
echo ""
echo "---> TO TEST ON MOBILE:"
echo "---> Open a SECOND terminal tab and run: ngrok http 8000"
echo "---> Then open the ngrok HTTPS link on your phone!"
echo ""
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
