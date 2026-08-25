# Security note — Antigravity / CloudCode configurable endpoint

**Component:** Antigravity CLI (observed `antigravity/cli/1.1.19`, `auth_method=consumer`)
and the shared CloudCode client used by the Antigravity IDE.
**Class:** Two related observations from the same testing session:
**(A)** a low‑severity hardening/transparency suggestion for a legitimate,
client‑configurable endpoint feature; **(B)** a confirmed, reproducible gap in
how regional/tier eligibility is enforced (CWE‑602, Client‑Side Enforcement of
Server‑Side Security / CWE‑284, Improper Access Control).
**Reporter environment:** Linux (WSL2), consumer Google account, tested with
outbound traffic routed through a network path in a region this product
currently restricts.

> Note on scope: Part A is **not** claiming that the endpoint‑override
> feature itself is a bug — overriding the API base URL (`CLOUD_CODE_URL` /
> `jetski.cloudCodeUrl`) is a legitimate, intentional feature, the same shape
> as `ANTHROPIC_BASE_URL` in Claude Code and the equivalent setting in every
> other major AI CLI/IDE tool. Enterprises rely on it to route traffic
> through internal proxies, DLP scanners, and guardrail layers, and Google is
> not expected to (and should not) remove it. Part B **is** about regional
> eligibility — it was found as a side effect of testing Part A, not sought
> out, and it is a confirmed (not hypothetical) bypass, reproduced against a
> real Google‑computed "ineligible" response. See "Honest scope note" for how
> we'd expect this to be triaged.

---

## A. Endpoint‑override transparency (low severity, informational)

The CloudCode client resolves its API base URL from user configuration that it
treats as fully trusted:

- CLI: the `CLOUD_CODE_URL` environment variable.
- IDE: the `jetski.cloudCodeUrl` setting in `settings.json`.

This is by design — it is what makes enterprise proxying, DLP inspection, and
guardrail layers possible in the first place, and any such layer necessarily
needs to see the same OAuth token and request bodies the client would
otherwise send straight to Google. When this override points at a plain
`http://` origin, the client:

1. Sends the user's **live OAuth Bearer access token** (`ya29.…`) to that origin
   in cleartext, in the `Authorization` header of every request, including
   `streamGenerateContent`.
2. Sends the user's **prompts and source code** (the `contents`/`parts`/`text`
   of `streamGenerateContent`) to that origin in cleartext.
3. **Trusts the responses** from that origin for account state
   (`loadCodeAssist`, `fetchUserInfo`, `retrieveUserQuotaSummary`,
   eligibility/quota) **and for model output** (the `streamGenerateContent`
   stream), with no observed integrity or origin check.

No visible indicator distinguishes "talking to Google directly" from "talking
to whatever `CLOUD_CODE_URL` currently points at," and no warning is shown
when that target is plaintext HTTP rather than HTTPS.

### Impact of A

The override itself is not the issue — every AI coding tool needs one for
proxy/DLP/guardrail deployments, and requiring or forcing TLS on it would
break legitimate local proxy setups (many enterprise inspection proxies
terminate on `127.0.0.1` without a trusted cert). The residual, narrower gap
is **silent, invisible use of the override**: if something *other* than the
intended enterprise proxy sets this value (local malware, a poisoned
dotfile/project `.env`, a shared or synced settings file, a co‑tenant on a
multi‑user host, a CI/container image), the client gives no sign that it is no
longer talking to Google directly, and if that target happens to be plaintext
HTTP, the OAuth token and all prompt/code content are readable to anyone who
can observe that local traffic.

This is a transparency/defense‑in‑depth gap, not a bypass of any protection
Google currently offers on its own — there is no authentication boundary
being crossed on its own; whoever sets the override already has local write
access to the user's environment or config. (Part B below describes what
becomes reachable once this trust is combined with a second, independent
gap.)

---

## B. Confirmed: `streamGenerateContent` does not independently re‑verify regional eligibility

While reproducing A with outbound traffic routed through a network path in a
region this product currently restricts, the real Google backend behaved
correctly on its own:

- `POST /v1internal:loadCodeAssist` → `200 OK`, with an `ineligibleTiers`
  field present — i.e. the server‑side eligibility check correctly reported
  the account as not eligible from that region/network. The unmodified CLI
  honored this and refused to proceed ("...not currently available in your
  location").

Using the same, legitimate endpoint‑override mechanism from Part A, we ran an
intermediary that forwarded every request to the real backend **unchanged**,
except that it stripped the `ineligibleTiers` field (and flipped the boolean
`isEligible`) on the `loadCodeAssist` / `fetchUserInfo` responses before
returning them to the client — nothing else was touched. With only that
change:

- The CLI proceeded past its local gate.
- `POST /v1internal:streamGenerateContent?alt=sse` — the actual
  model‑inference call — was sent to, and answered by, the **real, unmodified**
  Google backend, and came back `200 OK`, **untouched by the intermediary**.
  Google's own inference service served the request for an account it had
  itself, moments earlier in the same session, marked ineligible for that
  region.

This was reproduced twice in one session: two separate `streamGenerateContent`
calls, both genuine `200 OK` responses from upstream, neither rewritten.

**What this shows:** regional/tier eligibility for this product is enforced
at exactly one point in the call chain we observed — the boolean/reason
fields on `loadCodeAssist` / `fetchUserInfo` — and the resource that actually
matters, the inference endpoint itself, does not independently check it.
Whoever controls what the client believes that flag says, controls whether
the restriction applies at all.

### Impact of B

- This is a genuine, reproducible bypass of a real, server‑computed regional
  restriction, verified against an account and network path Google's own
  backend independently flagged as ineligible — not a hypothetical based on
  code inspection.
- Same precondition as Part A: local control of the endpoint‑override
  configuration. No remote or unauthenticated component.
- We recognize region/tier restrictions are usually treated as business logic
  rather than a security boundary, and that many VRPs explicitly exclude this
  class of bypass (paywall/region‑restriction bypass). We're reporting it
  anyway, with evidence, because it was found as a direct side effect of
  testing Part A rather than sought out, and because the underlying
  architecture — one trusted‑but‑unverified flag gating an otherwise
  unauthenticated resource call — is worth knowing about regardless of how it
  gets triaged.

---

## Reproduction

A small Node.js localhost endpoint is enough for both A and B; no CA, no
cert, no MITM — because none is needed. The client is *designed* to accept
this override.

1. Run a plain HTTP server on `127.0.0.1:8788` that forwards to
   `https://daily-cloudcode-pa.googleapis.com` and logs each request/response
   (optionally rewriting `loadCodeAssist`/`fetchUserInfo` eligibility fields
   in the response, for B).
2. Point the client at it and run it:
   ```
   export CLOUD_CODE_URL="http://127.0.0.1:8788"
   agy            # run the CLI in the same shell
   ```
3. For A — observe in the server log:
   - `POST /v1internal:streamGenerateContent?alt=sse` with header
     `authorization: Bearer ya29.<REDACTED>` over **http**.
   - The request body carrying `"role":"user"` … `"parts":[{"text": …}]` — the
     user's prompt/code in cleartext.
4. For B — from a region‑restricted network path, without any rewrite:
   `loadCodeAssist` genuinely returns `ineligibleTiers` and the CLI refuses to
   continue. Re‑run with the eligibility fields stripped from the same,
   otherwise‑unmodified responses: the CLI proceeds, and `streamGenerateContent`
   — forwarded as‑is to the real backend — returns genuine `200 OK` content.

Observed client build: `antigravity/cli/1.1.19 (aidev_client; os_type=linux;
arch=amd64; auth_method=consumer)`.

## Suggested hardening (optional — does not restrict the override)

For A:
- **Visible indicator when a non‑default endpoint is active.** Show the
  resolved destination host (CLI banner line / IDE status bar) whenever
  `CLOUD_CODE_URL` or `jetski.cloudCodeUrl` differs from the default, so a
  silently‑planted override is noticeable rather than invisible.
- **Optional, non‑blocking warning on plaintext HTTP.** A one‑time notice
  ("sending credentials to `http://…` — not encrypted") when the resolved
  scheme is `http://`, without refusing the connection, preserves local
  plaintext proxy setups (common in dev/debug) while giving the user a chance
  to notice a target they did not expect.

For B:
- **Re‑verify region/tier eligibility at the resource‑serving layer itself**
  (i.e., inside whatever service handles `streamGenerateContent`), based on
  server‑held account state, independent of whatever the calling client
  presents from an earlier, separate call. This is an internal
  server‑to‑server check — it does not touch the endpoint‑override feature
  and is invisible to legitimate DLP/guardrail deployments.
- Where practical, binding session/eligibility state to server‑signed
  material rather than a plain JSON flag would also help — but re‑checking
  at the point that actually matters (B) closes the gap on its own, even
  without that.

Explicitly **not** suggested: enforcing HTTPS on the endpoint, certificate
pinning, or gating credential attachment by allowlist — all of these would
break the legitimate enterprise proxy/DLP/guardrail use case that the
override exists for, without addressing B (which is a server‑side gap, not a
transport one).

## Evidence handling

The captured OAuth token is **redacted** in this report. The raw session logs
on the test machine contain a live token, prompt content, and the
`loadCodeAssist` / `streamGenerateContent` exchanges described in Part B, and
are treated as sensitive; they can be shared with the security team over a
secure channel on request.

## Honest scope note (for the reporter, not for Google)

Part A is a minor, by‑design transparency gap — likely to be triaged as
informational or intended behavior, and we've scoped the suggested fix to
match (no HTTPS enforcement, no pinning, no allowlisting — all of that would
break the legitimate proxy use case).

Part B started as a side effect of testing A, not as an attempt to defeat
regional restrictions, but the result is a confirmed, working bypass of a
real server‑computed decision, reproduced against a genuinely‑ineligible
account. We expect Google may still treat region/tier bypass as out of scope
for reward under most VRP policies (it's business logic, not classic
confidentiality/integrity/availability impact on other users' data) — but the
underlying architecture gap (one unauthenticated, unverified flag gating an
otherwise‑open resource call) is real, evidenced, and worth fixing regardless
of the triage outcome. Set severity/reward expectations accordingly; we are
reporting this for the fix, not the bounty.
