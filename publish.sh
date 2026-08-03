#!/bin/bash
# Pushes the current state of the ClueAtlas folder to GitHub.
# Cloudflare Pages is watching the repo and will auto-build/deploy
# within about a minute of every push.
#
# Usage: ./publish.sh "optional commit message"

set -e
cd "$(dirname "$0")"

MSG="${1:-Update Studio}"

git add -A
if git diff --cached --quiet; then
  echo "Nothing to publish — no changes since last commit."
else
  git commit -m "$MSG"
fi
git push
echo "Pushed. Cloudflare Pages will deploy the update shortly."
