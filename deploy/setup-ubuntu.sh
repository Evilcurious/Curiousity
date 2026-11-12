#!/usr/bin/env bash
# Curiousity — Ubuntu 24.04 provisioning script.
# Installs Docker Engine + Compose plugin and prepares the host.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo ./deploy/setup-ubuntu.sh"
  exit 1
fi

echo "==> Updating apt"
apt-get update
apt-get install -y ca-certificates curl gnupg git ufw

echo "==> Installing Docker"
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "==> Enabling Docker"
systemctl enable --now docker

TARGET_USER="${SUDO_USER:-$USER}"
if [[ "$TARGET_USER" != "root" ]]; then
  usermod -aG docker "$TARGET_USER"
  echo "==> Added $TARGET_USER to the docker group (log out and back in)"
fi

echo "==> Configuring firewall (allow SSH + HTTP/HTTPS)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo ""
echo "Done. Next steps:"
echo "  1. Log out and back in (docker group)."
echo "  2. cd into the repository, cp .env.example .env, edit secrets."
echo "  3. docker compose up -d --build"
