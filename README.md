# MMU Parser

This project was created to simplify a workflow for other coworkers.

## Where it runs

- The app is built with Create React App. `npm run deploy` builds it and pushes the
  `build/` folder to the `gh-pages` branch, which GitHub Pages publishes.
- It is served at https://www.ben-cobb.com/mmu-json-parser/ and at
  https://ben-cobb.github.io/mmu-json-parser/. The second address redirects to the
  first while the custom domain is attached.
- The `www.ben-cobb.com` domain, its DNS records and its HTTPS certificate belong to
  the user site repository `ben-cobb/ben-cobb.github.io` (Settings, then Pages), not to
  this repository. GitHub obtains that certificate from Let's Encrypt. It is valid for
  90 days and GitHub renews it on its own for as long as the domain's DNS keeps passing
  GitHub's check. Redeploying this app has no effect on the certificate.

## Health check

`scripts/check-site-health.sh` verifies that the site answers 200 over HTTPS with a
certificate that covers the host name and is not within 14 days of expiry. It also
reports whether the custom domain is still attached and what DNS says.

- `.github/workflows/site-health.yml` runs it daily and on demand from the Actions tab.
  A failed run e-mails the person who last changed the schedule line in the workflow file.
- GitHub pauses scheduled workflows in a public repository after 60 days without a
  commit. It warns by e-mail first; re-enable the workflow from the Actions tab.
- Run it yourself with:

  ```sh
  bash scripts/check-site-health.sh
  ```

## When the certificate breaks

Symptoms: browsers show "Your connection is not private". `NET::ERR_CERT_DATE_INVALID`
means the certificate expired. `NET::ERR_CERT_COMMON_NAME_INVALID` means GitHub is
serving its fallback `*.github.io` certificate because the custom domain is not
attached or its certificate was never provisioned. Nothing in this repository can fix
either one. Do this instead:

1. Open https://github.com/ben-cobb/ben-cobb.github.io/settings/pages. The custom
   domain must read `www.ben-cobb.com` with "DNS check successful" and "Enforce HTTPS"
   ticked. Any warning shown there names the cause.
2. Check DNS at the registrar or DNS host:
   - `www.ben-cobb.com` must be a CNAME to `ben-cobb.github.io`.
   - `ben-cobb.com` (the apex) must either point at GitHub's A records
     185.199.108.153, 185.199.109.153, 185.199.110.153 and 185.199.111.153, or have no
     records for the site at all. Do not leave it pointing at another host.
   - Any CAA record on `ben-cobb.com` must allow `letsencrypt.org`, or be removed.
   - Do not proxy the records through a CDN such as Cloudflare's orange cloud. GitHub
     cannot issue a certificate for a proxied domain.
3. If the domain is missing from the settings page, or DNS is right but the
   certificate is still expired or missing: remove the custom domain, save, add it
   back, save. GitHub re-runs the DNS check and requests a new certificate, which
   usually takes minutes and at most about an hour. Then tick "Enforce HTTPS".
4. Confirm with `bash scripts/check-site-health.sh`.

Optional hardening: verify the domain for the whole account under
https://github.com/settings/pages (add `ben-cobb.com` and publish the TXT record it
gives you). This stops anyone else from claiming the domain on GitHub Pages if it is
ever detached, and it does not need to be repeated.
