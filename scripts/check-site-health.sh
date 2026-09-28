#!/usr/bin/env bash
#
# check-site-health.sh - is the deployed MMU JSON Parser reachable over HTTPS
# with a valid certificate that is not about to expire, and does DNS send its
# host name to GitHub Pages and nowhere else?
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
#                is still attached. Its host name also supplies GitHub's addresses
#                for the DNS check (default https://ben-cobb.github.io/mmu-json-parser/)
#
# Exit status is 0 when everything is healthy, 1 otherwise, 2 on bad usage.
# Needs curl, openssl and dig (Debian and Ubuntu: dnsutils), as found on Linux
# and on the GitHub Actions runners.
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

# MIN_DAYS goes into shell arithmetic below, so it must be digits and nothing else.
case "$MIN_DAYS" in
  ''|*[!0-9]*) echo "MIN_DAYS must be a whole number of days, got \"$MIN_DAYS\"" >&2; exit 2 ;;
esac

hostport="${URL#*://}"; hostport="${hostport%%/*}"
host="${hostport%%:*}"
port="${hostport##*:}"; [ "$port" = "$hostport" ] && port=443

failures=0
ok()   { echo "ok:   $*"; }
warn() { echo "warn: $*"; }
fail() { echo "FAIL: $*"; failures=$((failures + 1)); }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# openssl s_client has no time limit of its own; use coreutils timeout where it exists.
limit=""; command -v timeout >/dev/null 2>&1 && limit="timeout 30"

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
code="$(curl -sS -o "$tmp/body" -w '%{http_code}' --connect-timeout 10 --max-time 30 \
        --retry 2 --retry-delay 5 "$URL" 2>"$tmp/curl.err")"; rc=$?
if [ "$rc" -ne 0 ]; then
  fail "curl exit $rc: $(tr '\n' ' ' <"$tmp/curl.err")"
  case "$rc" in
    60|51) echo "      (the certificate is not trusted: expired, wrong host name, or unknown issuer)" ;;
    35)    echo "      (TLS handshake failed)" ;;
    6|7|28) echo "      (could not resolve or connect to $host: DNS problem or outage)" ;;
  esac
elif [ "$code" != "200" ]; then
  fail "HTTP $code (expected 200)"
elif ! grep -qF -- "$EXPECT_TEXT" "$tmp/body"; then
  fail "HTTP 200 but the page does not contain \"$EXPECT_TEXT\": wrong site or broken deploy"
else
  ok "HTTP 200 and the page contains \"$EXPECT_TEXT\""
fi

echo "== 2. Certificate presented for $host"
# shellcheck disable=SC2086
$limit openssl s_client -connect "$host:$port" -servername "$host" -showcerts \
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

  # Names such as *.github.io must reach name_matches as they are, not expanded
  # against the files of the current directory.
  set -f
  # shellcheck disable=SC2046
  if name_matches "$host" $(printf '%s\n' "$sans" | tr ',' '\n' | sed -n 's/^ *DNS://p'); then
    ok "certificate covers $host"
  else
    fail "certificate does not cover $host. GitHub is serving a fallback certificate, so the custom domain is not attached or its certificate was never provisioned"
  fi
  set +f
fi

echo "== 3. github.io origin: $ORIGIN_URL"
out="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --connect-timeout 10 --max-time 30 \
       --retry 2 --retry-delay 5 "$ORIGIN_URL" 2>&1)"; rc=$?
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
# GitHub only renews the certificate while $host leads to GitHub Pages and
# nowhere else. This section fails on the faults found after the outage of
# September 2026: address records next to the CNAME, and an address that is not
# GitHub's. GitHub's addresses are read from the github.io name at run time.
origin_host="${ORIGIN_URL#*://}"; origin_host="${origin_host%%[/:]*}"

# answers NAME TYPE [dig options]: the answer section of the reply, one record
# per line as "owner ttl class type data". Non-zero status if no server replied.
answers() {
  local name="$1" type="$2"; shift 2
  dig +noall +answer +time=5 +tries=2 "$@" "$name" "$type" 2>/dev/null
}

# addresses NAME: every IPv4 and IPv6 address NAME leads to, CNAMEs followed,
# on one line.
addresses() {
  { answers "$1" A; answers "$1" AAAA; } \
    | awk '$4 == "A" || $4 == "AAAA" { print tolower($5) }' | sort -u | paste -sd' ' -
}

# strangers ADDRESS...: those of the given addresses that are not GitHub's.
strangers() {
  local a out=""
  for a in "$@"; do
    case " $pages_addrs " in *" $a "*) ;; *) out="$out $a" ;; esac
  done
  echo "${out# }"
}

# Word splitting of the address and name server lists below is intended.
# shellcheck disable=SC2046,SC2086
if [ "$host" = "$origin_host" ]; then
  ok "$host is GitHub's own name, so there are no DNS records of ours to check"
elif ! command -v dig >/dev/null 2>&1; then
  fail "dig is not installed, so DNS was not checked (Debian and Ubuntu: sudo apt install dnsutils)"
elif ! pages_addrs="$(addresses "$origin_host")" || [ -z "$pages_addrs" ]; then
  fail "could not look up $origin_host, so DNS was not checked"
else
  # 4a. What the zone's own name servers hold for $host. Asking them directly
  # matters: a resolver that has the CNAME cached hides the extra records.
  # The zone is the closest parent of $host that has name servers.
  zone="$host"; ns_list=""
  while :; do
    ns_list="$(answers "$zone" NS \
      | awk -v z="$zone." 'tolower($1) == tolower(z) && $4 == "NS" { print $5 }' | paste -sd' ' -)"
    [ -n "$ns_list" ] && break
    case "$zone" in *.*.*) zone="${zone#*.}" ;; *) break ;; esac
  done
  own=""; ns_used=""
  for ns in $ns_list; do
    if own="$(answers "$host" CNAME "@$ns" +norecurse \
              && answers "$host" A "@$ns" +norecurse \
              && answers "$host" AAAA "@$ns" +norecurse)"; then
      ns_used="$ns"; break
    fi
  done
  # Keep the records that belong to $host itself, as "owner type data".
  own="$(printf '%s\n' "$own" \
    | awk -v h="$host." 'tolower($1) == tolower(h) { print tolower($1), $4, tolower($5) }' | sort -u)"
  own_cname="$(printf '%s\n' "$own" | awk '$2 == "CNAME" { print $3 }' | paste -sd' ' -)"
  own_addrs="$(printf '%s\n' "$own" | awk '$2 == "A" || $2 == "AAAA" { print $3 }' | paste -sd' ' -)"

  if [ -z "$ns_used" ]; then
    fail "no name server of the zone that holds $host answered (tried: ${ns_list:-none found}), so its records were not checked at the source"
  else
    echo "      records for $host on $ns_used (zone $zone):"
    printf '%s\n' "${own:-<none>}" | sed 's/^/        /'
    if [ -n "$own_cname" ] && [ -n "$own_addrs" ]; then
      fail "$host has address records next to its CNAME: $own_addrs. A name with a CNAME must have no other records, because resolvers then answer with one or the other depending on their cache. At the DNS provider delete every A, AAAA and URL Redirect record for this host and keep only the CNAME"
    elif [ "$own_cname" = "$origin_host." ]; then
      ok "$host is a CNAME to $origin_host and has no address records of its own"
    elif [ -n "$own_cname" ]; then
      fail "$host is a CNAME to $own_cname but should be a CNAME to $origin_host."
    elif [ -n "$own_addrs" ]; then
      warn "$host has address records and no CNAME. For a subdomain GitHub recommends a CNAME to $origin_host"
    else
      fail "$ns_used has no CNAME, A or AAAA record for $host"
    fi
  fi

  # 4b. Every address the name leads to, by resolver or by the zone itself.
  seen="$(printf '%s\n' $(addresses "$host") $own_addrs | sort -u | paste -sd' ' -)"
  bad="$(strangers $seen)"
  if [ -z "$seen" ]; then
    fail "$host does not resolve to any address"
  elif [ -n "$bad" ]; then
    fail "$host leads to $bad, which is not a GitHub Pages address. Visitors sent there do not reach the site, and GitHub may stop renewing the certificate"
  else
    ok "every address $host leads to is a GitHub Pages address"
  fi

  # 4c. The bare domain, which GitHub pairs with www. Informational only.
  if [ "$host" = "www.$zone" ]; then
    apex_addrs="$(addresses "$zone")"
    bad="$(strangers $apex_addrs)"
    if [ -z "$apex_addrs" ]; then
      warn "$zone has no address records, so http://$zone/ and https://$zone/ do not work"
    elif [ -n "$bad" ]; then
      warn "$zone points at $bad, not only at GitHub Pages: https://$zone/ cannot work reliably and the certificate may not cover $zone"
    else
      ok "$zone points at GitHub Pages, which redirects it to $host"
    fi
  fi

  # 4d. CAA: if the domain names who may issue for it, Let's Encrypt must be listed.
  caa=""
  for name in "$host" "$zone"; do
    caa="$(answers "$name" CAA | awk '$4 == "CAA" && $6 == "issue" { print $7 }' | paste -sd' ' -)"
    [ -n "$caa" ] && break
  done
  case "$caa" in
    "")                ok "no CAA record restricts who may issue certificates for $host" ;;
    *letsencrypt.org*) ok "CAA allows letsencrypt.org" ;;
    *)                 fail "CAA allows only $caa to issue certificates, so GitHub cannot obtain one from Let's Encrypt. Add a CAA record 0 issue \"letsencrypt.org\" or remove the CAA records" ;;
  esac
fi

echo "== Summary"
if [ "$failures" -eq 0 ]; then
  echo "HEALTHY: $URL"
  exit 0
fi
echo "UNHEALTHY: $failures problem(s) with $URL. See README.md, section \"When the certificate breaks\"."
exit 1
