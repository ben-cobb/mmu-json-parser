#!/usr/bin/env bash
#
# check-site-health.sh - is the deployed MMU JSON Parser reachable over HTTPS
# with a valid certificate that is not about to expire?
#
# Usage:
#   bash scripts/check-site-health.sh [URL]
#
# Environment overrides:
#   MIN_DAYS     fail if the certificate expires within this many days (default 14)
#   EXPECT_TEXT  text the page body must contain (default "MMU Json Parser")
#   ORIGIN_URL   the github.io address of the same site. While a custom domain is
#                attached to the user site, GitHub answers this address with a
#                redirect to the custom domain, so it tells us whether the domain
#                is still attached (default https://ben-cobb.github.io/mmu-json-parser/)
#
# Exit status is 0 when everything is healthy and 1 otherwise. Needs curl and
# openssl, which ship with macOS, Linux and the GitHub Actions runners.
#
# The certificate for www.ben-cobb.com is NOT produced by this repository. GitHub
# Pages obtains it from Let's Encrypt (90-day validity, renewed by GitHub) for the
# user site ben-cobb/ben-cobb.github.io, whose custom domain is what places this
# project at https://www.ben-cobb.com/mmu-json-parser/. README.md has the runbook
# to follow when this check fails.

set -u

URL="${1:-https://www.ben-cobb.com/mmu-json-parser/}"
MIN_DAYS="${MIN_DAYS:-14}"
EXPECT_TEXT="${EXPECT_TEXT:-MMU Json Parser}"
ORIGIN_URL="${ORIGIN_URL:-https://ben-cobb.github.io/mmu-json-parser/}"

hostport="${URL#*://}"; hostport="${hostport%%/*}"
host="${hostport%%:*}"
port="${hostport##*:}"; [ "$port" = "$hostport" ] && port=443

failures=0
ok()   { echo "ok:   $*"; }
warn() { echo "warn: $*"; }
fail() { echo "FAIL: $*"; failures=$((failures + 1)); }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Does $1 match any of the DNS names given after it? Wildcards cover one label.
name_matches() {
  local h="$1" n; shift
  for n in "$@"; do
    case "$n" in
      "$h") return 0 ;;
      \*.*) [ "${h#*.}" = "${n#\*.}" ] && [ "${h#*.}" != "$h" ] && return 0 ;;
    esac
  done
  return 1
}

echo "== 1. HTTPS request: $URL"
code="$(curl -sS -o "$tmp/body" -w '%{http_code}' --max-time 30 "$URL" 2>"$tmp/curl.err")"; rc=$?
if [ "$rc" -ne 0 ]; then
  fail "curl exit $rc: $(tr '\n' ' ' <"$tmp/curl.err")"
  case "$rc" in
    60|51) echo "      (the certificate is not trusted: expired, wrong host name, or unknown issuer)" ;;
    35)    echo "      (TLS handshake failed)" ;;
    6|7|28) echo "      (could not resolve or connect to $host: DNS problem or outage)" ;;
  esac
elif [ "$code" != "200" ]; then
  fail "HTTP $code (expected 200)"
elif ! grep -q "$EXPECT_TEXT" "$tmp/body"; then
  fail "HTTP 200 but the page does not contain \"$EXPECT_TEXT\": wrong site or broken deploy"
else
  ok "HTTP 200 and the page contains \"$EXPECT_TEXT\""
fi

echo "== 2. Certificate presented for $host"
openssl s_client -connect "$host:$port" -servername "$host" -showcerts \
  </dev/null >"$tmp/s_client" 2>"$tmp/s_client.err"
sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' "$tmp/s_client" >"$tmp/chain.pem"
if ! grep -q 'BEGIN CERTIFICATE' "$tmp/chain.pem"; then
  fail "no certificate received (connection or TLS handshake failed): $(tail -n 3 "$tmp/s_client.err" | tr '\n' ' ')"
else
  # openssl x509 reads only the first (leaf) certificate of the chain.
  openssl x509 -in "$tmp/chain.pem" -noout -subject -issuer -dates | sed 's/^/      /'
  sans="$(openssl x509 -in "$tmp/chain.pem" -noout -text \
          | awk '/Subject Alternative Name/ { getline; print }' | sed 's/^ *//')"
  echo "      names:  ${sans:-<none>}"
  grep -m1 'Verify return code' "$tmp/s_client" | sed 's/^ */      /'
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$(openssl x509 -in "$tmp/chain.pem" -noout -enddate | cut -d= -f2)" <<'PY' || true
import datetime, sys
end = datetime.datetime.strptime(sys.argv[1], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=datetime.timezone.utc)
left = end - datetime.datetime.now(datetime.timezone.utc)
print(f"      expires in {left.days} days ({end:%Y-%m-%d})")
PY
  fi

  if openssl x509 -in "$tmp/chain.pem" -noout -checkend $((MIN_DAYS * 86400)) >/dev/null; then
    ok "certificate is valid for more than $MIN_DAYS days"
  elif openssl x509 -in "$tmp/chain.pem" -noout -checkend 0 >/dev/null; then
    fail "certificate expires within $MIN_DAYS days; GitHub should already have renewed it"
  else
    fail "certificate has EXPIRED"
  fi

  # shellcheck disable=SC2046
  if name_matches "$host" $(printf '%s\n' "$sans" | tr ',' '\n' | sed -n 's/^ *DNS://p'); then
    ok "certificate covers $host"
  else
    fail "certificate does not cover $host. GitHub is serving a fallback certificate, so the custom domain is not attached or its certificate was never provisioned"
  fi
fi

echo "== 3. github.io origin: $ORIGIN_URL"
out="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 30 "$ORIGIN_URL" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ]; then
  warn "could not reach the origin (curl exit $rc): $out"
else
  ocode="${out%% *}"; oredir="${out#* }"
  case "$ocode" in
    301|302|307|308)
      case "$oredir" in
        *"://$host"*) ok "origin redirects to $oredir, so the custom domain is attached to the user site" ;;
        *)            warn "origin redirects to $oredir rather than to $host" ;;
      esac ;;
    200) warn "origin serves the site directly with no redirect: the custom domain $host no longer appears to be attached to ben-cobb/ben-cobb.github.io" ;;
    *)   warn "origin returned HTTP $ocode" ;;
  esac
fi

echo "== 4. DNS for $host"
apex="${host#www.}"
if command -v dig >/dev/null 2>&1; then
  echo "      $host CNAME -> $(dig +short "$host" CNAME | tr '\n' ' ')(expected: ben-cobb.github.io.)"
  echo "      $host A     -> $(dig +short "$host" A | tr '\n' ' ')(expected: 185.199.108-111.153)"
  echo "      $apex CAA   -> $(dig +short "$apex" CAA | tr '\n' ' ')(expected: empty, or one that allows letsencrypt.org)"
elif command -v host >/dev/null 2>&1; then
  host -t CNAME "$host" | sed 's/^/      /'
  host -t A "$host" | sed 's/^/      /'
  host -t CAA "$apex" | sed 's/^/      /'
else
  warn "neither dig nor host is installed; skipping the DNS lookup"
fi

echo "== Summary"
if [ "$failures" -eq 0 ]; then
  echo "HEALTHY: $URL"
  exit 0
fi
echo "UNHEALTHY: $failures problem(s) with $URL. See README.md, section \"When the certificate breaks\"."
exit 1
