const loginScreen = document.querySelector('#login-screen');
const appShell = document.querySelector('#app-shell');
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const totpField = document.querySelector('#totp-field');
const totpInput = document.querySelector('#app-totp');
const form = document.querySelector('#connect-form');
const status = document.querySelector('#status');
const connectButton = document.querySelector('#connect');
const disconnectButton = document.querySelector('#disconnect');
const logoutButton = document.querySelector('#logout');
const themeToggle = document.querySelector('#theme-toggle');
const idracButtons = document.querySelectorAll('[data-idrac-action]');
const savedServers = document.querySelector('#saved-servers');
const connectionState = document.querySelector('#connection-state');
const activeServer = document.querySelector('#active-server');
const lastAction = document.querySelector('#last-action');
const resultTitle = document.querySelector('#result-title');
const resultSummary = document.querySelector('#result-summary');
const resultOutput = document.querySelector('#result-output');
const debugOutput = document.querySelector('#debug-output');
const rememberedServerKey = 'web-ssh-remembered-servers';
const themeKey = 'web-ssh-theme';

const actionLabels = {
  'power-status': '查询电源',
  'service-tag': '服务标签',
  'system-info': '系统信息',
  'firmware-version': '版本信息',
  'network-info': '网络配置',
  'sensor-info': '传感器状态',
  'sel-count': '日志数量',
  'sel-first-20': '前 20 条日志',
  'session-info': '当前会话',
  'jobqueue-view': '任务队列',
  'graceful-shutdown': '正常关机',
  'force-power-off': '强制断电',
  'power-on': '开机',
  'power-cycle': '电源重启',
  'idrac-reset': '重启 iDRAC'
};

let socket = null;
let sshReady = false;
let currentServer = null;

function applyTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  themeToggle.textContent = nextTheme === 'light' ? '深色' : '浅色';
  localStorage.setItem(themeKey, nextTheme);
}

function loadTheme() {
  applyTheme(localStorage.getItem(themeKey) || 'dark');
}

function readRememberedServers() {
  try {
    const servers = JSON.parse(localStorage.getItem(rememberedServerKey) || '[]');
    return Array.isArray(servers) ? servers : [];
  } catch {
    return [];
  }
}

function writeRememberedServers(servers) {
  localStorage.setItem(rememberedServerKey, JSON.stringify(servers.slice(0, 12)));
}

function serverId(server) {
  return `${server.username}@${server.host}:${server.port}`;
}

function rememberServer(server) {
  const servers = readRememberedServers().filter((item) => serverId(item) !== serverId(server));
  writeRememberedServers([server, ...servers]);
  renderRememberedServers();
}

function fillServer(server) {
  form.elements.host.value = server.host;
  form.elements.port.value = server.port;
  form.elements.username.value = server.username;
}

function renderRememberedServers() {
  const servers = readRememberedServers();
  savedServers.innerHTML = '';

  if (servers.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'saved-empty';
    empty.textContent = '连接成功后会自动保存服务器。';
    savedServers.append(empty);
    return;
  }

  servers.forEach((server) => {
    const item = document.createElement('div');
    item.className = 'saved-server';

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'saved-server-main';
    pick.textContent = serverId(server);
    pick.addEventListener('click', () => fillServer(server));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'saved-server-remove';
    remove.textContent = '删除';
    remove.addEventListener('click', () => {
      if (!window.confirm(`确认删除已保存服务器 ${serverId(server)} 吗？`)) {
        return;
      }

      writeRememberedServers(readRememberedServers().filter((item) => serverId(item) !== serverId(server)));
      renderRememberedServers();
    });

    item.append(pick, remove);
    savedServers.append(item);
  });
}

function setAuthenticated(authenticated) {
  loginScreen.hidden = authenticated;
  appShell.hidden = !authenticated;
}

function setTwoFactorEnabled(enabled) {
  totpField.hidden = !enabled;
  totpInput.required = enabled;
  totpInput.disabled = !enabled;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || '请求失败。');
  }

  return body;
}

function appendDebug(text) {
  debugOutput.textContent += text;
  debugOutput.scrollTop = debugOutput.scrollHeight;
}

function setStatus(message, connected = false, ready = sshReady) {
  status.textContent = message;
  connectionState.textContent = ready ? '已连接' : connected ? '连接中' : '未连接';
  connectButton.disabled = connected;
  disconnectButton.disabled = !connected;
  sshReady = ready;
  idracButtons.forEach((button) => {
    button.disabled = !sshReady;
  });
}

function formatPowerStatus(output) {
  const match = output.match(/server power status:\s*(on|off)/i);

  if (match?.[1].toLowerCase() === 'on') {
    return '服务器当前电源状态：开机';
  }

  if (match?.[1].toLowerCase() === 'off') {
    return '服务器当前电源状态：关机';
  }

  return '电源状态查询完成。';
}

function translateValue(value) {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();

  if (lower === 'on') return '开机';
  if (lower === 'off') return '关机';
  if (lower === 'enabled' || lower === 'enable') return '已启用';
  if (lower === 'disabled' || lower === 'disable') return '已禁用';
  if (lower === 'yes') return '是';
  if (lower === 'no') return '否';
  if (lower === 'true') return '是';
  if (lower === 'false') return '否';
  if (lower === 'ok') return '正常';
  if (lower === 'critical') return '严重';
  if (lower === 'warning') return '警告';
  if (lower === 'unknown') return '未知';

  return normalized;
}

function translateKey(key) {
  const normalized = key.replace(/\s+/g, ' ').trim().toLowerCase();
  const dictionary = {
    'server power status': '服务器电源状态',
    'service tag': '服务标签',
    'express service code': '快速服务代码',
    'chassis service tag': '机箱服务标签',
    'chassis model': '机箱型号',
    'system model': '系统型号',
    'system id': '系统 ID',
    'bios version': 'BIOS 版本',
    'firmware version': '固件版本',
    'idrac version': 'iDRAC 版本',
    'idrac firmware version': 'iDRAC 固件版本',
    'lifecycle controller version': 'Lifecycle Controller 版本',
    'host name': '主机名',
    'os name': '操作系统',
    'os version': '操作系统版本',
    'nic enabled': '网卡启用',
    'dhcp enabled': 'DHCP 启用',
    'ip address': 'IP 地址',
    'subnet mask': '子网掩码',
    'gateway': '网关',
    'default gateway': '默认网关',
    'mac address': 'MAC 地址',
    'dns domain name': 'DNS 域名',
    'primary dns server': '首选 DNS',
    'secondary dns server': '备用 DNS',
    'current ip address': '当前 IP 地址',
    'current ip gateway': '当前网关',
    'current ip netmask': '当前子网掩码',
    'record': '记录',
    'date/time': '日期时间',
    'severity': '严重级别',
    'description': '描述',
    'status': '状态',
    'name': '名称',
    'state': '状态',
    'reading': '读数',
    'location': '位置',
    'user name': '用户名',
    'session id': '会话 ID',
    'ip address of the user': '用户 IP 地址',
    'job id': '任务 ID',
    'job name': '任务名称',
    'start time': '开始时间',
    'expiration time': '过期时间',
    'message': '消息'
  };

  return dictionary[normalized] || key.trim();
}

function translateStructuredOutput(output) {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return '';
  }

  return lines
    .map((line) => {
      const separator = line.includes('=') ? '=' : line.includes(':') ? ':' : null;

      if (!separator) {
        return line;
      }

      const index = line.indexOf(separator);
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();

      if (!key || !value) {
        return line;
      }

      return `${translateKey(key)}：${translateValue(value)}`;
    })
    .join('\n');
}

function actionSummary(action, output) {
  const clean = output.trim();

  if (action === 'power-status') {
    return formatPowerStatus(clean);
  }

  const successSummary = {
    'graceful-shutdown': '正常关机指令已发送。',
    'force-power-off': '强制断电指令已发送。',
    'power-on': '开机指令已发送。',
    'power-cycle': '电源重启指令已发送。',
    'idrac-reset': 'iDRAC 重启指令已发送。'
  };

  return successSummary[action] || `${actionLabels[action] || '操作'}完成。`;
}

function formatResult(action, output, rawOutput = '') {
  const clean = output.trim();
  const raw = rawOutput.trim();
  const source = clean || raw;
  const translated = translateStructuredOutput(source);

  return {
    summary: actionSummary(action, source),
    detail: translated || source || '暂时没有捕获到设备返回内容。请展开“调试输出”查看 SSH 原始交互。'
  };
}

function showResult(action, output, rawOutput) {
  const formatted = formatResult(action, output, rawOutput);
  resultTitle.textContent = actionLabels[action] || 'iDRAC 操作结果';
  resultSummary.textContent = formatted.summary;
  resultOutput.textContent = formatted.detail;
  lastAction.textContent = actionLabels[action] || action;
}

function connect(payload) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}/terminal`);

  socket.addEventListener('open', () => {
    setStatus('连接中...', true, false);
    socket.send(JSON.stringify({ type: 'connect', ...payload, cols: 120, rows: 32 }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'data') {
      appendDebug(message.data);
    }

    if (message.type === 'status') {
      const nextReady = typeof message.ready === 'boolean' ? message.ready : sshReady;
      setStatus(message.message, Boolean(socket && socket.readyState === WebSocket.OPEN), nextReady);
      appendDebug(`\n${message.message}\n`);
    }

    if (message.type === 'ready') {
      setStatus('iDRAC 已连接，可以开始操作。', true, true);
      currentServer = {
        host: form.elements.host.value.trim(),
        port: Number(form.elements.port.value || 22),
        username: form.elements.username.value.trim()
      };
      activeServer.textContent = serverId(currentServer);
      rememberServer(currentServer);
      resultSummary.textContent = '请选择一个 iDRAC 操作。';
    }

    if (message.type === 'action-started') {
      const label = actionLabels[message.action] || 'iDRAC 操作';
      setStatus(`正在执行：${label}`, true, true);
      resultTitle.textContent = label;
      resultSummary.textContent = '正在通过 SSH 与 iDRAC 交互...';
      resultOutput.textContent = '';
      idracButtons.forEach((button) => {
        button.disabled = true;
      });
    }

    if (message.type === 'idrac-result') {
      setStatus('操作完成', true, true);
      if (message.rawOutput) {
        appendDebug(`\n${message.rawOutput}\n`);
      }
      showResult(message.action, message.output || '', message.rawOutput || '');
    }

    if (message.type === 'error') {
      setStatus(message.message, Boolean(socket && socket.readyState === WebSocket.OPEN), false);
      resultTitle.textContent = '操作失败';
      resultSummary.textContent = message.message;
      appendDebug(`\n错误: ${message.message}\n`);
    }
  });

  socket.addEventListener('close', () => {
    setStatus('已断开', false, false);
    activeServer.textContent = '未连接';
  });
}

async function loadSession() {
  const session = await requestJson('/api/session');
  setTwoFactorEnabled(session.twoFactorEnabled);
  setAuthenticated(session.authenticated);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  payload.port = Number(payload.port || 22);

  debugOutput.textContent = '';
  resultTitle.textContent = '等待连接';
  resultSummary.textContent = '正在建立 iDRAC SSH 会话...';
  resultOutput.textContent = '';
  connect(payload);
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';

  const data = new FormData(loginForm);

  try {
    await requestJson('/api/login', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(data.entries()))
    });
    loginForm.reset();
    setAuthenticated(true);
  } catch (error) {
    loginError.textContent = error.message;
  }
});

disconnectButton.addEventListener('click', () => {
  socket?.close();
  socket = null;
  currentServer = null;
  setStatus('已断开', false, false);
  activeServer.textContent = '未连接';
});

logoutButton.addEventListener('click', async () => {
  socket?.close();
  socket = null;
  currentServer = null;
  setStatus('未连接', false, false);
  await requestJson('/api/logout', { method: 'POST' });
  setAuthenticated(false);
});

idracButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const confirmText = button.dataset.confirm;

    if (confirmText && !window.confirm(confirmText)) {
      return;
    }

    socket?.send(JSON.stringify({ type: 'idrac-action', action: button.dataset.idracAction }));
  });
});

themeToggle.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});

loadTheme();
renderRememberedServers();
loadSession().catch(() => setAuthenticated(false));
