import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'ssh2';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const appUsername = process.env.APP_USERNAME || 'admin';
const appPassword = process.env.APP_PASSWORD || 'admin123';
const sessionSecret = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const appTotpSecret = (process.env.APP_TOTP_SECRET || '').replace(/\s+/g, '').toUpperCase();
const allowedHosts = (process.env.SSH_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const idracActions = {
  'power-status': 'racadm serveraction powerstatus',
  'service-tag': 'racadm getsvctag',
  'system-info': 'racadm getsysinfo',
  'firmware-version': 'racadm getversion',
  'network-info': 'racadm getniccfg',
  'sensor-info': 'racadm getsensorinfo',
  'sel-count': 'racadm getsel -i',
  'sel-first-20': 'racadm getsel -s 1 -c 20',
  'session-info': 'racadm getssninfo',
  'jobqueue-view': 'racadm jobqueue view',
  'graceful-shutdown': 'racadm serveraction graceshutdown',
  'force-power-off': 'racadm serveraction powerdown',
  'power-on': 'racadm serveraction powerup',
  'power-cycle': 'racadm serveraction powercycle',
  'idrac-reset': 'racadm racreset'
};

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/terminal' });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separator = cookie.indexOf('=');
        if (separator === -1) {
          return [cookie, ''];
        }

        return [cookie.slice(0, separator), decodeURIComponent(cookie.slice(separator + 1))];
      })
  );
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function createSessionToken(username) {
  const payload = Buffer.from(
    JSON.stringify({
      username,
      expiresAt: Date.now() + 8 * 60 * 60 * 1000
    })
  ).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';

  for (const char of value.replace(/=+$/g, '')) {
    const index = alphabet.indexOf(char);

    if (index === -1) {
      throw new Error('Invalid Base32 secret.');
    }

    bits += index.toString(2).padStart(5, '0');
  }

  const bytes = [];

  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateTotp(secret, timeStep = Math.floor(Date.now() / 30000)) {
  const key = decodeBase32(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timeStep));

  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

function verifyTotp(secret, code) {
  const normalizedCode = String(code || '').replace(/\s+/g, '');

  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  const currentStep = Math.floor(Date.now() / 30000);

  for (const offset of [-1, 0, 1]) {
    if (safeCompare(generateTotp(secret, currentStep + offset), normalizedCode)) {
      return true;
    }
  }

  return false;
}

function readSession(req) {
  const token = parseCookies(req.headers.cookie).web_ssh_session;

  if (!token) {
    return null;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature || !safeCompare(sign(payload), signature)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (session.expiresAt < Date.now()) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function setSessionCookie(res, username) {
  const token = createSessionToken(username);
  res.cookie('web_ssh_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  });
}

function clearSessionCookie(res) {
  res.clearCookie('web_ssh_session', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  });
}

function isAllowedHost(host) {
  return allowedHosts.length === 0 || allowedHosts.includes(host);
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function cleanCommandOutput(command, output) {
  return stripAnsi(output)
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^[\w.-]+\s*(>>|>|#|\$)\s*/i, '')
        .replace(command, '')
        .trim()
    )
    .filter(Boolean)
    .filter((line) => !/^(>>|>|#|\$)$/.test(line))
    .join('\n')
    .trim();
}

app.get('/api/session', (req, res) => {
  const session = readSession(req);
  res.json({ authenticated: Boolean(session), username: session?.username || null, twoFactorEnabled: Boolean(appTotpSecret) });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  const totpCode = String(req.body?.totpCode || '');

  if (!safeCompare(username, appUsername) || !safeCompare(password, appPassword)) {
    res.status(401).json({ error: '用户名或密码错误。' });
    return;
  }

  if (appTotpSecret && !verifyTotp(appTotpSecret, totpCode)) {
    res.status(401).json({ error: '2FA 验证码错误或已过期。' });
    return;
  }

  setSessionCookie(res, username);
  res.json({ authenticated: true, username });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ authenticated: false });
});

wss.on('connection', (ws, req) => {
  if (!readSession(req)) {
    send(ws, { type: 'error', message: 'Please log in first.' });
    ws.close();
    return;
  }

  let ssh = null;
  let shell = null;
  let pendingAction = null;
  let pendingTimer = null;
  let pendingDeadline = null;
  let recentAction = null;
  let recentActionTimer = null;

  const closeSsh = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }

    if (pendingDeadline) {
      clearTimeout(pendingDeadline);
      pendingDeadline = null;
    }

    if (recentActionTimer) {
      clearTimeout(recentActionTimer);
      recentActionTimer = null;
    }

    pendingAction = null;
    recentAction = null;

    if (shell) {
      shell.end();
      shell = null;
    }

    if (ssh) {
      ssh.end();
      ssh = null;
    }
  };

  const finishPendingAction = () => {
    if (!pendingAction) {
      return;
    }

    const result = {
      action: pendingAction.action,
      output: cleanCommandOutput(pendingAction.command, pendingAction.output),
      rawOutput: stripAnsi(pendingAction.output).trim()
    };

    recentAction = {
      action: pendingAction.action,
      command: pendingAction.command,
      output: pendingAction.output
    };

    if (recentActionTimer) {
      clearTimeout(recentActionTimer);
    }

    recentActionTimer = setTimeout(() => {
      recentAction = null;
      recentActionTimer = null;
    }, 10000);

    pendingAction = null;
    pendingTimer = null;
    if (pendingDeadline) {
      clearTimeout(pendingDeadline);
      pendingDeadline = null;
    }
    send(ws, { type: 'idrac-result', ...result });
  };

  const handleShellData = (data) => {
    const text = data.toString('utf8');

    if (!pendingAction) {
      if (recentAction) {
        recentAction.output += text;
        send(ws, {
          type: 'idrac-result',
          action: recentAction.action,
          output: cleanCommandOutput(recentAction.command, recentAction.output),
          rawOutput: stripAnsi(recentAction.output).trim()
        });
      }

      send(ws, { type: 'data', data: text });
      return;
    }

    pendingAction.output += text;

    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }

    pendingTimer = setTimeout(finishPendingAction, 2500);
  };

  ws.on('message', (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'Invalid message format.' });
      return;
    }

    if (message.type === 'connect') {
      closeSsh();

      const host = String(message.host || '').trim();
      const username = String(message.username || '').trim();
      const portNumber = Number(message.port || 22);

      if (!host || !username) {
        send(ws, { type: 'error', message: 'Host and username are required.' });
        return;
      }

      if (!isAllowedHost(host)) {
        send(ws, { type: 'error', message: `Host "${host}" is not allowed by server policy.` });
        return;
      }

      ssh = new Client();

      ssh
        .on('ready', () => {
          send(ws, { type: 'status', message: 'SSH connected.' });

          ssh.shell(
            {
              term: 'xterm-256color',
              cols: Number(message.cols || 120),
              rows: Number(message.rows || 32)
            },
            (err, stream) => {
              if (err) {
                send(ws, { type: 'error', message: err.message });
                closeSsh();
                return;
              }

              shell = stream;
              send(ws, { type: 'ready', message: 'iDRAC SSH session is ready.' });
              shell
                .on('data', handleShellData)
                .on('close', () => {
                  send(ws, { type: 'status', message: 'SSH session closed.', ready: false });
                  closeSsh();
                })
                .stderr.on('data', handleShellData);
            }
          );
        })
        .on('error', (err) => {
          send(ws, { type: 'error', message: err.message });
          closeSsh();
        })
        .on('close', () => send(ws, { type: 'status', message: 'SSH disconnected.', ready: false }));

      const connection = {
        host,
        port: Number.isInteger(portNumber) ? portNumber : 22,
        username,
        readyTimeout: 20000,
        keepaliveInterval: 15000
      };

      if (message.privateKey) {
        connection.privateKey = String(message.privateKey);
        if (message.passphrase) {
          connection.passphrase = String(message.passphrase);
        }
      } else {
        connection.password = String(message.password || '');
      }

      send(ws, { type: 'status', message: `Connecting to ${host}...` });
      ssh.connect(connection);
      return;
    }

    if (message.type === 'input' && shell) {
      shell.write(String(message.data || '').replaceAll('\x7f', '\x08'));
      return;
    }

    if (message.type === 'idrac-action') {
      const command = idracActions[String(message.action || '')];

      if (!shell) {
        send(ws, { type: 'error', message: 'SSH session is not ready.' });
        return;
      }

      if (!command) {
        send(ws, { type: 'error', message: 'Unknown iDRAC action.' });
        return;
      }

      if (pendingAction) {
        send(ws, { type: 'error', message: '已有 iDRAC 任务正在执行，请稍后再试。' });
        return;
      }

      pendingAction = {
        action: String(message.action || ''),
        command,
        output: ''
      };

      pendingDeadline = setTimeout(finishPendingAction, 12000);
      send(ws, { type: 'action-started', action: pendingAction.action });
      shell.write(`${command}\n`);
      return;
    }

    if (message.type === 'resize' && shell) {
      shell.setWindow(Number(message.rows || 32), Number(message.cols || 120), 0, 0);
    }
  });

  ws.on('close', closeSsh);
});

server.listen(port, () => {
  console.log(`Web SSH console running at http://localhost:${port}`);
});
