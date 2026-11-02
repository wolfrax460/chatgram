# Vercel support request — chatgram.qd.je cannot be verified

Measured 2026-11-02 with the logged-in Vercel CLI (64.5.0) and public DNS.

## Facts

| Item | Value |
|---|---|
| Vercel account / team | `mugishaishaq8-2444` / `mugishaishaq8-2444s-projects` |
| Project | `chatgram` (production alias `chatgram-xi.vercel.app`) |
| Domain to attach | `chatgram.qd.je` |
| Zone owner (us) | `chatgram.qd.je`, NS `dns1.digitalplat.org`, `dns2.digitalplat.org` (DigitalPlat) |
| A record | `chatgram.qd.je A 76.76.21.21` (Vercel anycast) — resolves publicly |
| TXT record we can create | `_vercel.chatgram.qd.je TXT "vc-domain-verify=chatgram.qd.je,9cec421a5d4a7d41fac7"` — published and resolving |
| Parent zone `qd.je` | **not controlled by us** — DigitalPlat assigned us the subdomain only; we cannot create records at `qd.je` |

`npx vercel domains verify chatgram.qd.je` output:

```
Status
  DNS Configuration    ! DNS Change Recommended
  Project              ☓ Verification Needed for chatgram
  Ownership            ☓ Not accessible under mugishaishaq8-2444s-projects

What to fix
  2. Verify domain ownership by adding the following record to your DNS provider:
     TXT _vercel.qd.je "vc-domain-verify=chatgram.qd.je,9cec421a5d4a7d41fac7"
     Last attempt: Domain _vercel.qd.je is missing required TXT Record
     "vc-domain-verify=chatgram.qd.je,9cec421a5d4a7d41fac7"

Currently resolves to: A 76.76.21.21
Nameservers: dns2.digitalplat.org, dns1.digitalplat.org
```

`npx vercel domains add chatgram.qd.je chatgram` → `Error: Not authorized to use chatgram.qd.je (403)`.

Traffic already reaches Vercel: `curl -I http://chatgram.qd.je/` → `HTTP/1.1 404`, `Server: Vercel`,
`X-Vercel-Error: DEPLOYMENT_NOT_FOUND`; `https://chatgram.qd.je/` fails the TLS handshake because no
certificate has been issued for a domain that is not attached to a project.

## Text to send to Vercel support

> Subject: Cannot attach chatgram.qd.je to project "chatgram" — verification asks for a TXT record at the parent zone qd.je, which I do not control
>
> Hello,
>
> I am trying to attach the domain **chatgram.qd.je** to my Vercel project **chatgram** (team
> `mugishaishaq8-2444s-projects`, account `mugishaishaq8-2444`, current production alias
> `chatgram-xi.vercel.app`) and Vercel keeps answering "Verification Required" /
> "linked to another Vercel account".
>
> DNS for `chatgram.qd.je` is hosted at DigitalPlat (`dns1.digitalplat.org`, `dns2.digitalplat.org`).
> DigitalPlat assigned me the **subdomain** `chatgram.qd.je`; I control the zone `chatgram.qd.je`
> itself, but I do **not** control the parent zone `qd.je` and cannot create records there.
>
> What is already published right now and resolves publicly:
>
> - `chatgram.qd.je A 76.76.21.21`
> - `_vercel.chatgram.qd.je TXT "vc-domain-verify=chatgram.qd.je,9cec421a5d4a7d41fac7"`
>
> Traffic for the domain already reaches Vercel: `curl -I http://chatgram.qd.je/` returns
> `404 DEPLOYMENT_NOT_FOUND` with `Server: Vercel`, and HTTPS fails the TLS handshake because no
> certificate is issued for a domain that is not attached to a project.
>
> `vercel domains verify chatgram.qd.je` tells me:
>
> - Project: "Verification Needed for chatgram" (the domain is already added to my project the way the dashboard describes)
> - Ownership: "Not accessible under mugishaishaq8-2444s-projects"
> - Fix: add `TXT _vercel.qd.je "vc-domain-verify=chatgram.qd.je,9cec421a5d4a7d41fac7"`
>
> I cannot add that record: `qd.je` is not my zone. `vercel domains add chatgram.qd.je chatgram`
> also fails with `Error: Not authorized to use chatgram.qd.je (403)`.
>
> Could you please:
>
> 1. remove the stale claim on `chatgram.qd.je` from whichever other Vercel account holds it, and
> 2. verify and attach `chatgram.qd.je` to project `chatgram` using the subdomain-level proof I can
>    publish (TXT at `_vercel.chatgram.qd.je`, and the A record already pointing at 76.76.21.21),
>    or tell me exactly which record at `_vercel.chatgram.qd.je` you would accept as proof of
>    ownership for this subdomain?
>
> Please do not ask for a record at `_vercel.qd.je` — that zone belongs to DigitalPlat, not to me.
> I am happy to publish any additional TXT/CNAME records under `chatgram.qd.je`.
>
> Thank you.

## What must NOT be done meanwhile

No workaround: no wildcard DNS tricks, no second project, no requests to third parties to fake
ownership. Until the domain is attached, `https://chatgram.qd.je` stays unlinked and the site keeps
serving from `chatgram-xi.vercel.app`.
