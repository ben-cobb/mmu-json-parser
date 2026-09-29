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
  90 days and GitHub renews it on its own, about 30 days before it expires, for as long
  as the domain's DNS keeps passing GitHub's check. Redeploying this app has no effect
  on the certificate.

## Health check

`scripts/check-site-health.sh` verifies that the site answers 200 over HTTPS with a
certificate that covers the host name and is not within 14 days of expiry, that the
custom domain is still attached, and that DNS sends `www.ben-cobb.com` to GitHub Pages
and nowhere else.

- `.github/workflows/site-health.yml` runs it daily, on demand from the Actions tab, and
  on pull requests that change the script or the workflow. A failed scheduled run
  e-mails the person who last changed the schedule line in the workflow file.
- To test the alarm, start the workflow by hand with `min_days` set to 400. No
  certificate is valid that long, so the run must turn red and the e-mail must arrive.
- GitHub pauses scheduled workflows in a public repository after 60 days without
  repository activity. It warns by e-mail first; re-enable the workflow from the
  Actions tab. Act on that e-mail: a paused check cannot report a missed renewal.
- Let's Encrypt shortens certificate lifetimes to 64 days in February 2027 and to 45
  days in February 2028. If the check then fails although renewals still arrive, lower
  `MIN_DAYS` in the workflow.
- Run it yourself (needs `curl`, `openssl` and `dig`):

  ```sh
  bash scripts/check-site-health.sh
  ```

## When the certificate breaks

Symptoms: browsers show "Your connection is not private". `NET::ERR_CERT_DATE_INVALID`
means the certificate expired. `NET::ERR_CERT_COMMON_NAME_INVALID` means GitHub is
serving its fallback `*.github.io` certificate because the custom domain is not
attached or its certificate was never provisioned. Nothing in this repository can fix
either one.

### What broke in September 2026

The certificate expired on 24 September 2026 because GitHub had not renewed it. At
Namecheap the `www` host carried the correct CNAME and, next to it, five A records:
GitHub's four addresses and 162.255.119.104, the server behind Namecheap's URL
redirects. A name with a CNAME may not have other records, so resolvers answered with
one set or the other depending on their cache. GitHub does not issue a certificate for
a name that leads to an address other than its own. Renewals had been arriving late
since March 2026. The extra records are the most likely cause and the only fault found;
GitHub does not say why a renewal fails.

Namecheap never lists 162.255.119.104 in Advanced DNS. It exists for as long as a URL
Redirect Record exists for the host. The Host Records list shows only its first five
rows; the two redirect records sat below them, behind "Show more".

The full record, with the timeline, every change made and what to watch for next, is
in [docs/incidents/2026-09-certificate-outage.md](docs/incidents/2026-09-certificate-outage.md).

### Expected DNS records (Namecheap, Advanced DNS)

| Type | Host | Value | Note |
| --- | --- | --- | --- |
| CNAME | `www` | `ben-cobb.github.io.` | the only record for `www` |
| A | `@` | `185.199.108.153` `185.199.109.153` `185.199.110.153` `185.199.111.153` | four records; GitHub redirects the bare domain to `www` |
| TXT | `_github-pages-challenge-ben-cobb` | code from https://github.com/settings/pages | keeps the domain verified; never delete |
| MX, TXT (SPF) | `@` | set by Mail Settings | e-mail forwarding; leave alone |

No URL redirects, no A records on `www`, no CDN proxy such as Cloudflare's orange cloud
in front. A CAA record, if one is ever added, must allow `letsencrypt.org`.

### Steps

1. Run `bash scripts/check-site-health.sh`. Section 4 names any DNS fault.
2. Fix DNS first, at Namecheap. Click "Show more" under Host Records to see every
   row. Delete extra records in place; do not delete and re-create the `www` CNAME. A
   change takes up to 30 minutes to reach every resolver.
3. Check GitHub's own view with
   `gh api repos/ben-cobb/ben-cobb.github.io/pages/health`. Both hosts should report
   `is_https_eligible: true`.
4. Open https://github.com/ben-cobb/ben-cobb.github.io/settings/pages, remove the custom
   domain, save, add `www.ben-cobb.com` back, save. Do this once and allow an hour;
   repeating it restarts the request.
5. Keep that settings page open, or reload it. Loading it is what makes GitHub run the
   DNS check and request the certificate: in September 2026 the request sat untouched
   after the domain was re-added through the API, and completed within a minute of
   the page being opened.
6. When the certificate is issued, tick "Enforce HTTPS" there and in this repository's
   Pages settings.
7. No certificate after an hour: remove the custom domain and use
   https://ben-cobb.github.io/mmu-json-parser/, which has GitHub's own certificate.
   Contact GitHub Support and add the domain back later.

Never put a `CNAME` file on this repository's `gh-pages` branch and never set a custom
domain in this repository's settings: the domain belongs to the user site.
