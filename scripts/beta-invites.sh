#!/bin/bash
# Look up, pause or resume a friend's private beta invite by the email they sign in with on the download page.
# Only a hash of the email is stored (cloudflare/peta-download/src/index.ts emailHash), so this computes it locally.
# Usage:
#   bash scripts/beta-invites.sh status <email> [prod|dev]
#   bash scripts/beta-invites.sh pause  <email> [prod|dev]   # that Mac stops connecting; the page hides the download
#   bash scripts/beta-invites.sh resume <email> [prod|dev]
#   bash scripts/beta-invites.sh summary [prod|dev]          # counts only
# Also remove someone from the Cloudflare Access policy to stop them signing in at all.
set -euo pipefail
action=${1:-}
case "$action" in
  status|pause|resume) email=${2:?an email address}; target=${3:-prod};;
  summary) target=${2:-prod};;
  *) sed -n '2,10p' "$0" >&2; exit 2;;
esac
case "$target" in prod|dev) ;; *) echo 'The target is prod or dev.' >&2; exit 2;; esac
db=peta-$target
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root/cloudflare/peta-download"
d1() { npx wrangler d1 execute "$db" --env "$target" --remote --command "$1"; }
if [[ $action == summary ]]; then
  d1 "SELECT COUNT(*) AS invites, COUNT(key_hash) AS macs_in_use, COUNT(revoked_at) AS paused FROM invites; SELECT version, COUNT(*) AS downloads, COUNT(DISTINCT email_hash) AS friends FROM downloads GROUP BY version ORDER BY MAX(at) DESC;"
  exit
fi
hash=$(printf 'peta.invite.v1\n%s' "$(printf '%s' "$email" | tr '[:upper:]' '[:lower:]' | xargs)" | shasum -a 256 | cut -d' ' -f1)
[[ $hash =~ ^[a-f0-9]{64}$ ]] || exit 1
case "$action" in
  status) d1 "SELECT substr(code,1,5)||'-'||substr(code,6) AS code, key_hash IS NOT NULL AS in_use, datetime(bound_at,'unixepoch') AS since, datetime(revoked_at,'unixepoch') AS paused FROM invites WHERE email_hash='$hash'; SELECT version, datetime(at,'unixepoch') AS downloaded FROM downloads WHERE email_hash='$hash' ORDER BY at DESC LIMIT 10;";;
  pause) d1 "UPDATE invites SET revoked_at=unixepoch() WHERE email_hash='$hash' AND revoked_at IS NULL;";;
  resume) d1 "UPDATE invites SET revoked_at=NULL WHERE email_hash='$hash';";;
esac
