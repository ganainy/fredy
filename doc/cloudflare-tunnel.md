# Running Fredy behind a Cloudflare Tunnel

Reach Fredy from anywhere at your own hostname, without opening router ports.

1. In Cloudflare Zero Trust create a tunnel (Networks > Tunnels > Cloudflared) and copy its token.
2. Add a published application: your hostname, service `http://fredy:9998`.
3. Recommended: add a Cloudflare Access application for the same hostname (Allow, your email) so a login sits in front of Fredy.
4. `cp .env.example .env` and set `TUNNEL_TOKEN=` in it. Never commit `.env`.
5. `docker compose up -d` starts Fredy, `docker compose --profile tunnel up -d` also starts the tunnel.

Fredy listens only on `127.0.0.1:9998` on the host. Change the default `admin` password right after first login.

## Updating

`./deploy.sh` pulls (fast-forward only), builds, restarts Fredy and waits for the health check.
If the new container is not healthy within `HEALTH_TIMEOUT` seconds (default 150) the previous
image is restored automatically. `conf/` and `db/` are archived to `~/fredy-backups` first
(last 5 kept). `./deploy.sh --no-pull` deploys the checkout as it is, `./deploy.sh --rollback`
puts the previous image back. Rollback restores the image only, not database changes.
