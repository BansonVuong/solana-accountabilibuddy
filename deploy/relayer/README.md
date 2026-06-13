# Relayer deployment

The production relayer runs as the unprivileged `accountabilibuddy` user,
listens only on `127.0.0.1:8787`, and is exposed through Caddy at
`https://66.42.115.38.nip.io`. The `nip.io` hostname resolves directly to
`66.42.115.38` and allows Caddy to issue a browser-trusted TLS certificate.

## Initial install

Push these files to GitHub, then run on the server:

```bash
git clone https://github.com/BansonVuong/solana-accountabilibuddy.git /tmp/accountabilibuddy-install
sudo /tmp/accountabilibuddy-install/deploy/relayer/install.sh
```

Provision the existing relayer oracle key outside Git at:

```text
/etc/accountabilibuddy/oracle.json
```

It must be owned by `root:accountabilibuddy` with mode `640`. Configure MongoDB
and other secrets in `/etc/accountabilibuddy/relayer.env`, then start:

```bash
sudo systemctl restart accountabilibuddy-relayer
curl https://66.42.115.38.nip.io/health
```

## Automatic deploys

`accountabilibuddy-update.timer` checks `origin/main` every minute. When a
fast-forward update exists, it installs locked dependencies, typechecks the
relayer, refreshes the systemd/Caddy configuration, and restarts the service.
A failed install or typecheck leaves the currently running process untouched.

```bash
systemctl status accountabilibuddy-relayer accountabilibuddy-update.timer caddy
journalctl -u accountabilibuddy-relayer -f
systemctl start accountabilibuddy-update.service
```
