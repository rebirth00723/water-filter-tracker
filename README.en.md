# Water Filter Tracker

Self-hosted, mobile-first tracker for RO water purifier consumables and water quality.

Records filter purchases and replacements with cost, logs raw and pure TDS (ppm) readings,
overlays both on a shared timeline so filter degradation becomes visible, and pushes a
reminder through [ntfy](https://ntfy.sh) as a replacement date approaches.

> 📌 This is a secondary translation. The [Chinese README](./README.md) is the primary
> document — if the two ever disagree, that one is correct.

---

## Why this exists

Filter replacement dates live in your head, so you forget them. And because raw water
quality shifts with the season, the pure-water number alone doesn't tell you whether the
membrane is degrading — 12 ppm in summer and 18 ppm in winter can be the same healthy
filter. What you actually need is the rejection rate over time, with replacement events
marked on the same axis.

That's the whole app: two numbers, a list of what you changed, and a chart that puts them
together.

## Features

**Consumables** — Log a replacement in about 30 seconds while standing at the sink.
Template chips fill the whole list from your last replacement; a two-stage picker shows
each filter stage with its stock and overdue days, so the picker doubles as a to-do list.
Purchases track cost and vendor.

**Water quality** — Raw and pure ppm with a live rejection-rate readout. Readings entered
during a replacement are owned by that event: edit the event's date and the chart point
moves with it.

**Report** — A ppm line chart with a replacement swimlane below it, sharing one time axis.
Tap anywhere to snap to the nearest date and see both the readings and everything replaced
that day. Pinch to zoom five years of data on a phone.

**Reminders** — Per-rule advance notices (14 days, 3 days, day-of) and repeating overdue
notices, each with its own send time, message template, and priority. Filter reminders and
security events go to two separate ntfy topics so the latter isn't buried by the former.

**Multiple devices** — Each purifier gets its own URL (`/d/1`, `/d/2`) and its own
downloadable QR code with the device name burned into the image. Stick one on each machine.

**Login** — Password always; [passkey](#passkeys) as an optional shortcut where HTTPS is
available. Data lives in a single SQLite file you can export as JSON and import elsewhere.

## Quick start

```bash
mkdir water-filter-tracker && cd water-filter-tracker
curl -O https://raw.githubusercontent.com/rebirth00723/water-filter-tracker/main/compose.yaml
docker compose up -d
```

Then open `http://<host>:8085` and set a username and password. That's the whole setup —
no token, no CLI step, no config file to edit first.

> [!IMPORTANT]
> **Finish that first-run setup before exposing the service to the internet.** The setup
> page is deliberately unprotected — whoever reaches it first claims the account. If the
> service is only on your LAN this doesn't matter; if it's behind a tunnel, set the password
> before you point a public hostname at it.

Everything else — the outward URL, ntfy connection, notification rules — is configured in
the web UI. There are **no required environment variables**.

## Two ways to run it

### (a) LAN only

No domain, no certificate, no reverse proxy. Publish the port and you're done:

```yaml
services:
  app:
    image: ghcr.io/rebirth00723/water-filter-tracker:latest
    ports: ['8085:8085']
    volumes: ['./data:/data']
```

Everything works — recording, reports, reminders, QR codes (fill in
`http://192.168.x.x:8085` as the outward URL in Admin). The only feature you can't use is
passkeys, because browsers don't expose WebAuthn over plain HTTP. Password login works
fine.

### (b) Remote access

You need HTTPS with a real domain name. Point a tunnel or reverse proxy at the container
and set the outward URL in Admin (or via `PUBLIC_URL`).

**The HTTPS requirement is the browser's, not this project's.** WebAuthn does not exist in
non-secure contexts, and a WebAuthn Relying Party ID must be a domain name — IP addresses
are invalid per spec. If you want passkeys, you need a certificate. Ways to get one without
buying anything:

| Situation | Approach |
|---|---|
| You use Tailscale | `tailscale cert <host>.<tailnet>.ts.net` — free, auto-renewing |
| You have a public domain | Cloudflare Tunnel, or Caddy/Traefik with Let's Encrypt |
| Internal-only domain | Let's Encrypt via DNS-01 (no inbound port needed) |
| No domain at all | [mkcert](https://github.com/FiloSottile/mkcert) internal CA — you must install the root cert on each device |

**Keep the LAN port published as well.** Password login works over plain HTTP, so if the
tunnel goes down you can still reach the app and record a replacement. That's the practical
payoff of making password the floor rather than passkey-only.

If you use a reverse proxy, **do not rewrite the `Host` header** — Next.js compares
`Origin` against `Host` to block cross-site writes, and rewriting Host makes that check
fail. (In Cloudflare Tunnel, this is the `httpHostHeader` option; leave it unset.)

## QR codes

Settings → Devices → pick a device → **Download PNG**.

The image contains the QR plus the device name and URL. Print one, stick it on the machine,
and scanning it opens that specific purifier's page — no URL to remember, no device to
switch, no app to install. With three purifiers this is the difference between the tool
getting used and not.

The URL is composed on the server from your configured outward URL, never derived from
`window.location`. That's deliberate: if you open Settings from a LAN IP, a
browser-derived QR would encode an address that fails from outside.

## Notifications

Point it at any ntfy server (self-hosted or ntfy.sh) in Admin. Leave it blank and
notifications are simply off; everything else still works.

Two topics, one credential:

- **Filter reminders** — "the first stage is due in 14 days"
- **Security events** — a passkey was registered or revoked

They're separate because a filter reminder every few weeks would bury the one message you
need to see immediately.

### Is the topic name a secret?

**It depends on your ntfy server, and the advice is opposite in the two cases:**

| Server config | Topic = password? | What to do |
|---|---|---|
| `ntfy.sh`, or self-hosted with `auth-default-access: read-write` | **Yes.** Anyone who knows the topic can subscribe and publish. | Add a long random suffix: `water-filter-a8f3d91c` |
| Self-hosted with `auth-default-access: deny-all` | **No.** The name is useless without a token or account authorized for it. | Use a readable name |

Prefer an access token over a username/password: a leaked token can be revoked on its own,
whereas a leaked password means changing the whole ntfy account.

Credentials are stored in the database **in plaintext**. The only key available to encrypt
them sits in the same directory as the database, so anyone who can read one can read the
other — encrypting would be theatre. They're excluded from JSON export for the same reason
they'd otherwise leak.

## Configuration

Every setting has a UI equivalent. Environment variables exist for people who prefer
declarative config, and **they take precedence** — a field controlled by an env var shows
up read-only in Admin, labelled as such, rather than letting you edit a value that won't
take effect.

| Variable | Default | Notes |
|---|---|---|
| `PUBLIC_URL` | UI | Outward URL. **Required for passkeys, and must be HTTPS with a domain name.** Also used for QR codes and notification click-through. Changing it invalidates every existing passkey |
| `PORT` | `8085` | The only outward port |
| `BASE_PATH` | — | Mount the whole app under a sub-path (e.g. `/water`) when the path collides on a shared domain. `PUBLIC_URL` must include the same prefix |
| `TEMP_PASSWORD` | — | Rescue password. **Leaving it set is a permanent backdoor** — see [Security](#security) |
| `DATABASE_PATH` | `/data/app.sqlite3` | |
| `SESSION_SECRET` | auto | Generated at `/data/session.key` (mode 0600) on first start. Set it only if you want to manage it yourself |
| `SESSION_MAX_AGE_DAYS` | `30` | |
| `COOKIE_SECURE` | `auto` | `auto` follows `X-Forwarded-Proto`. A `Secure` cookie is silently dropped over plain HTTP, which looks like "login succeeds then immediately fails" |
| `NTFY_URL` | UI | Base URL only, **no topic** — this app posts to ntfy's JSON endpoint at the root path |
| `NTFY_TOPIC_FILTER` / `NTFY_TOPIC_SECURITY` | UI | |
| `NTFY_TOKEN` | UI | Or `NTFY_USER` + `NTFY_PASSWORD`. Token wins if both are set |
| `TZ` | system, `Asia/Taipei` in the image | IANA name. Affects what counts as "today", due-date maths, and notification send times. A typo falls back to the system zone and logs a line rather than refusing to start |
| `SESSION_KEY_PATH` | next to the database | Where the auto-generated session key lives |
| `REAL_IP_HEADER` | auto | Names a single header for the visitor IP. **Only affects log accuracy** — authorization never looks at IPs or headers |
| `LOG_LEVEL` | `info` | |

Any variable also accepts a `_FILE` suffix pointing at a file (for Docker secrets):
`NTFY_PASSWORD_FILE=/run/secrets/ntfy`.

Running as a non-root user? The image doesn't hardcode `USER`, because every host has a
different uid (1000 on most Linux, 1026 on some NAS boxes, different again in LXC).
Set Docker's own field instead:

```yaml
user: "1000:1000"   # your `id -u`:`id -g`
```

## Data and backups

Everything is one file: `./data/app.sqlite3`.

There is **no built-in backup feature** — snapshots, rsync and Restic are more reliable
than anything the app could do, and you probably already run one of them.

> [!WARNING]
> **Do not copy `app.sqlite3` while the container is running.** WAL mode keeps recent
> transactions in the `-wal` sidecar, so the copy can be missing data. Either stop the
> container first, or use `sqlite3 app.sqlite3 ".backup out.sqlite3"`.

Also: **never put the database on NFS or SMB.** SQLite's file locking is unreliable there
and will silently corrupt data.

For moving to another machine, Settings → Export/Import produces a single human-readable
JSON file. It deliberately excludes credentials, passkeys, the audit log and the ntfy
connection: passkeys are bound to a domain and would be useless anyway, an importable
credentials file would be a backdoor, and an audit log from another machine isn't evidence
of anything.

## Security

What this project does:

- Password login with scrypt hashing, per-password salt, constant-time comparison
- Rate limiting keyed on the account (2 per 30s, 4 failures → 10 minute lock)
- Every login failure returns an identical response — same status, message, URL, and
  timing — so the response can't be used to probe for a valid username
- Session tokens signed with a per-deployment key generated on first start
- Content Security Policy with a per-request nonce, `frame-ancestors 'none'`,
  `Referrer-Policy`, `X-Content-Type-Options`
- `Origin`/`Host` comparison on every write (Next.js Server Actions do this natively)
- Audit log of every login and data change, with before/after values

What it deliberately does not do, and why:

- **No HSTS.** A long `max-age` is irreversible and would lock out anyone self-hosting over
  plain HTTP on their LAN.
- **The first-run setup page is unprotected.** Whether the service faces the internet is the
  operator's decision; accidental exposure before setup is explicitly out of scope. Finish
  setup before exposing it.
- **No vendor-specific auth** (e.g. Cloudflare Access). Tying an open-source project to one
  provider defeats the point.

Things worth knowing:

- **`TEMP_PASSWORD` left in your config is a permanent backdoor.** It exists so that
  changing your password and then forgetting it doesn't lock you out. Logging in with it
  forces a password change immediately, and the login page keeps warning you on *every*
  login for as long as it's set. Remove it and restart when you're done.
- **Passkeys are bound to the domain.** Change `PUBLIC_URL` and every registered passkey
  stops working; you re-register from the same page.
- **Passkeys can't be used over plain HTTP.** That's the browser, not this app. Password
  login always works, which is why it's the floor rather than an afterthought.
- Regenerating the session key in Admin logs out every device. **Passkeys are unaffected**
  and don't need re-registering.

### Passkeys

Password first, passkey as an upgrade — never passkey-only. A passkey is bound to a device
and a domain, so a lost phone, a domain change, or a plain-HTTP fallback all leave you with
the password as the only way in.

Registration involves **no QR code and no one-time token**: log in with your password, open
Settings → Quick login, tap once, use Face ID. Being logged in with a password *is* the
authorization. The server stores only public keys, so a database leak can't be used to log
in.

Enable it globally in Admin (which requires HTTPS with a domain, and a password already
set), then register each device from Settings → Quick login. Admin also holds the full
credential list with emergency revoke, for when a phone goes missing.

## Development

```bash
npm install
npm run dev              # http://localhost:3000
```

Migrations and seed data run automatically at server start
(`src/instrumentation.ts` → `src/lib/boot.ts`). After changing `src/lib/db/schema.ts`:

```bash
npm run db:generate      # writes a new migration to drizzle/
```

```bash
npm test                 # vitest
npm run typecheck        # these are separate on purpose — vitest uses esbuild
npm run build            # and does NOT typecheck
```

### Layout

```
src/
  app/
    (app)/               authenticated shell
      d/[deviceId]/      per-device: home, consumables, water, report
      settings/          devices, notifications, data, quick login, audit
      admin/             outward URL, ntfy, session key, passkey toggle
    api/                 auth, passkey, export, import, health
    setup|login|change-password/
  lib/
    db/                  Drizzle schema, migrations, seed
    auth/                password, session, rate limit, passkey
    notify/              ntfy client, sweep, croner schedule
    schemas/             zod — shared by client forms and server actions
  components/
```

### Conventions worth knowing before you change things

- **User-visible dates are `TEXT` in `YYYY-MM-DD`, never DateTime.** These are calendar
  dates, not instants. Lexicographic order equals chronological order (so `MAX()`,
  `ORDER BY` and `BETWEEN` work directly), they cross the server/client boundary without
  serialization, and there's no timezone off-by-one waiting to happen.
- **Pages are Server Components that query SQLite directly.** There is no read API layer;
  that's the biggest simplification this stack allows. Client Components are leaves.
- **Writes go through Server Actions**, and every one re-checks authorization — a Server
  Action is a public HTTP endpoint, so the page that rendered the form is not a boundary.
- **One zod schema per shape, shared** by react-hook-form and the Server Action. Client and
  server validation cannot drift.
- **`foreign_keys = ON`** is set per connection. SQLite defaults it off, and without it
  every cascade and restrict in the schema is decorative.
- Modules that touch the database import `'server-only'`. Anything a Client Component needs
  lives in a separate pure module (`device-path.ts`, `ppm.ts`, `audit-groups.ts`).

## Contributing

Issues and pull requests are welcome. Bug reports are most useful with the failing input
and what you expected instead.

If you're changing behaviour, please include a test. `npm test && npm run typecheck` should
both pass — they check different things.

## License

[MIT](./LICENSE)
