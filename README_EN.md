# iDRAC Web SSH Console

[中文说明](README.md)

This project may be used for commercial purposes, but you must give proper attribution!

Because older Dell server models only support TLS 1.0 encryption, many modern browsers can no longer open the iDRAC web interface properly. To make it easier to use, I created this tool for more convenient access to iDRAC.

This is a lightweight web console for connecting to Dell iDRAC via SSH. The iDRAC SSH port does not need to be exposed to the public internet, making it convenient to use anytime and anywhere, while displaying the results in a way that is more suitable for viewing in a browser.

## Features

- App-level login before opening any SSH session
- Optional TOTP-based 2FA for the web login
- Connect to iDRAC with either password auth or an SSH private key
- One-click shortcuts for common `racadm` operations
- Recent server shortcuts stored in the browser
- Docker and Docker Compose support for quick deployment

## Tech Stack

- Node.js
- Express
- WebSocket (`ws`)
- `ssh2`
- Plain HTML, CSS, and browser-side JavaScript

## Project Structure

```text
.
|-- public/
|   |-- app.js
|   |-- index.html
|   `-- styles.css
|-- server.js
|-- package.json
|-- Dockerfile
`-- docker-compose.yml
```

## Local Development

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Update the values in `.env`, especially:
   - `APP_USERNAME`
   - `APP_PASSWORD`
   - `SESSION_SECRET`
   - `APP_TOTP_SECRET`
   - `SSH_ALLOWED_HOSTS`

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000).

## Docker

Build and run with Docker Compose:

```bash
docker compose up --build
```

The service listens on port `3000` by default.

## Environment Variables

| Variable | Description |
| --- | --- |
| `PORT` | HTTP port for the web app |
| `APP_USERNAME` | Username required for the web login |
| `APP_PASSWORD` | Password required for the web login |
| `SESSION_SECRET` | Secret used to sign the session cookie |
| `APP_TOTP_SECRET` | Base32 TOTP secret for optional 2FA |
| `SSH_ALLOWED_HOSTS` | Comma-separated allowlist of target hosts |

## Security Notes

- Change all default credentials before exposing the app to a network.
- Keep `.env` local and do not commit it.
- Set a long random `SESSION_SECRET`.
- Use `SSH_ALLOWED_HOSTS` to restrict which iDRAC hosts the app may reach.
- Enable HTTPS and set up reverse-proxy protection when deploying publicly.

## Typical Use Cases

- Quick Dell iDRAC health checks
- Power control from a browser
- Reading system, firmware, network, and sensor information
- Reviewing SEL logs, active sessions, and job queue status

## License

See the repository `LICENSE` file for license details.
