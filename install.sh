#!/bin/bash
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (e.g. sudo ./install.sh)"
  exit 1
fi

echo "========================================"
echo "  GP-Injector - RP2040 Input Engine Setup"
echo "========================================"

# Get the absolute path of the current directory
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/gp-injector"

echo "[1/5] Copying files to $INSTALL_DIR..."
if [ "$SOURCE_DIR" != "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR"
    cp -r "$SOURCE_DIR/"* "$INSTALL_DIR/"
fi

BRIDGE_SCRIPT="$INSTALL_DIR/gp_injector.py"

if [ ! -f "$BRIDGE_SCRIPT" ]; then
    echo "[X] Error: gp_injector.py not found in $INSTALL_DIR"
    exit 1
fi

echo "[2/5] Installing Python dependencies..."
# It's safest to use APT on newer Raspberry Pi OS (Debian Bookworm) to avoid PEP 668 externally-managed errors
apt-get update
apt-get install -y python3-pip python3-serial python3-flask python3-evdev python3-flask-sock || true

# Fallback to pip install if some packages were not found in apt
echo "Ensuring pip packages (ignoring managed-env warnings if any)..."
pip3 install pyserial flask evdev flask-sock --break-system-packages 2>/dev/null || pip3 install pyserial flask evdev

echo "[3/5] Setting execution permissions..."
chmod +x "$BRIDGE_SCRIPT"

echo "[4/5] Creating systemd service file..."
SERVICE_FILE="/etc/systemd/system/gp-injector.service"

cat << EOF > "$SERVICE_FILE"
[Unit]
Description=GP-Injector - RP2040 Input Translation Engine
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/env python3 $BRIDGE_SCRIPT
Restart=always
RestartSec=5
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=gp-injector

[Install]
WantedBy=multi-user.target
EOF

echo "[5/5] Enabling and starting GP-Injector service..."
systemctl daemon-reload
systemctl enable gp-injector.service
systemctl restart gp-injector.service

echo "========================================"
echo "  Installation Complete! 🚀"
echo "========================================"
echo "GP-Injector is now running in the background."
echo ""
echo "To check service status run:  sudo systemctl status gp-injector"
echo "To view raw output log run:   sudo journalctl -u gp-injector -f"
echo ""
echo "You can now access the web dashboard via your browser:"
echo "http://localhost:8080"
echo "========================================"
