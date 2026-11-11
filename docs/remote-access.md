# Using RoninFlow away from home

RoninFlow runs on your own computer or home server. To use it from your phone or another place, give it a
private, encrypted route — **never forward its port on your router**.

Before anything else: open **Settings → Security & privacy → Password & network access** and set a password.

## Option 1 — Tailscale (recommended)

Tailscale puts your devices on a private network only you can reach. Nothing is exposed to the internet.

1. Install Tailscale on the computer that runs the journal and on your phone: <https://tailscale.com/download>.
   Sign in to both with the same account.
2. On the journal computer, turn on HTTPS for it:
   - Windows install: in the journal folder run `npm run phone:https`
   - Anywhere else: `tailscale serve --bg 5173`
   This gives an address like `https://my-pc.tailnet-name.ts.net`.
3. In the journal: **Settings → Security & privacy → Password & network access → Allow devices on my home network**.
4. On your phone, with Tailscale on, open the `https://…ts.net` address and sign in with your password.
   Install it as an app: Android Chrome ⋮ → *Install app*; iPhone Safari Share → *Add to Home Screen*.

Docker: run Tailscale on the host and use `tailscale serve --bg 5173`, or add the official
`tailscale/tailscale` sidecar container.

## Option 2 — Cloudflare Tunnel (a public address on your own domain)

Use this if you want a normal web address (e.g. `journal.example.com`). You need a free Cloudflare account and a
domain on Cloudflare.

1. Install `cloudflared`: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>.
2. Quick test (temporary random address): `cloudflared tunnel --url http://localhost:5173`
3. Permanent setup:
   ```
   cloudflared tunnel login
   cloudflared tunnel create roninflow
   cloudflared tunnel route dns roninflow journal.example.com
   cloudflared tunnel run --url http://localhost:5173 roninflow
   ```
4. Strongly recommended: protect the address with **Cloudflare Access** (Zero Trust → Access → Applications) so
   only your email can reach the sign-in page at all.
5. Turn on **Allow devices on my home network** in the journal (requests through the tunnel count as other devices,
   so they always need your password).

## What is protected

- Every device except the computer running the journal must sign in with your password (you can require it on that
  computer too). Sessions end after 30 days without a visit; repeated wrong passwords are blocked for a minute.
- Broker logins and API keys are stored encrypted in the data folder (`secret.key` unlocks them — keep the data
  folder private and out of public cloud folders).
- Platform add-ons and webhooks from other devices need the token from **Connections → Webhook / API**.
