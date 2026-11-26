#!/usr/bin/env bash
# Sets up and deploys the collab server on Fly.io. Safe to run again: each step
# skips what already exists, so a second run only redeploys.
#
#   ./scripts/deploy-fly.sh               # app name brb-collab
#   FLY_APP=my-name ./scripts/deploy-fly.sh
#
# Fly builds the Docker image on its own builders, so nothing compiles on this Mac.
set -euo pipefail

# Skip Homebrew's slow self-update when it installs flyctl.
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1

APP="${FLY_APP:-brb-collab}"
REGION="${FLY_REGION:-iad}"
VOLUME="collab_data"

cd "$(dirname "$0")/.."

step() { printf '\n==> %s\n' "$*"; }

step "Checking for flyctl"
if ! command -v fly >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install flyctl
  else
    curl -L https://fly.io/install.sh | sh
    export PATH="$HOME/.fly/bin:$PATH"
  fi
fi
fly version

step "Checking Fly login"
if ! fly auth whoami >/dev/null 2>&1; then
  echo "Not logged in. A browser window opens to sign in or sign up."
  echo "Fly asks for a card before it runs machines. This app costs about \$2-3 a month."
  fly auth login
fi
echo "Logged in as $(fly auth whoami)"

step "Creating app $APP"
if fly status --app "$APP" >/dev/null 2>&1; then
  echo "App $APP exists."
else
  # App names are global on Fly. If this fails with "name has already been taken",
  # rerun with FLY_APP=<another-name>.
  fly apps create "$APP" --org personal
fi

step "Creating volume $VOLUME in $REGION"
if fly volumes list --app "$APP" 2>/dev/null | grep -q "$VOLUME"; then
  echo "Volume $VOLUME exists."
else
  fly volumes create "$VOLUME" --size 1 --region "$REGION" --app "$APP" --yes
fi

step "Deploying (remote build, one machine)"
# --ha=false keeps one machine. Rooms live in memory, so two machines would split them.
fly deploy --app "$APP" --remote-only --ha=false

step "Checking /healthz"
URL="https://$APP.fly.dev"
for _ in 1 2 3 4 5 6; do
  if curl -fsS "$URL/healthz"; then
    echo
    break
  fi
  sleep 5
done

cat <<NEXT

Done. The server is at wss://$APP.fly.dev

Last step: point the website at it. In Vercel, open the be-right-back project,
then Settings > Environment Variables, and add:

  NEXT_PUBLIC_COLLAB_URL = wss://$APP.fly.dev   (Production and Preview)

Then redeploy the site, because Next.js bakes NEXT_PUBLIC_ values in at build time.
With the Vercel CLI, from apps/website:

  vercel env add NEXT_PUBLIC_COLLAB_URL production   # paste wss://$APP.fly.dev
  vercel env add NEXT_PUBLIC_COLLAB_URL preview
  vercel --prod
NEXT
