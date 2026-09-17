// Frees port 4000 before the server starts, so `npm start` always lands on the
// port the frontend expects (js/api.js only enables the API on port 4000).
//
// It only kills a process that is answering /api/health like this server does,
// so an unrelated program that happens to hold 4000 is left untouched.
import { execSync } from 'node:child_process';

const PORT = Number(process.env.PORT || 4000);

function pidsListeningOn(port) {
  const pids = new Set();
  try {
    const cmd = process.platform === 'win32'
      ? 'netstat -ano'
      : `lsof -ti tcp:${port} -sTCP:LISTEN`;
    const out = execSync(cmd, { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      if (process.platform === 'win32') {
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const local = parts[1] || '';
        const pid = parts[parts.length - 1];
        if (local.split(':').pop() !== String(port)) continue;
        if (/^\d+$/.test(pid)) pids.add(pid);
      } else if (/^\d+$/.test(line.trim())) {
        pids.add(line.trim());
      }
    }
  } catch { /* nothing listening, or the tool is unavailable */ }
  return [...pids];
}

async function ourServerIsUp() {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return Boolean(data && data.status === 'ok');
  } catch { return false; }
}

function stop(pid) {
  if (process.platform !== 'win32') {
    try { execSync(`kill -9 ${pid}`, { stdio: 'ignore' }); return true; } catch { return false; }
  }
  try {
    execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execSync(`powershell -NoProfile -Command Stop-Process -Id ${pid} -Force`, { stdio: 'ignore' });
      return true;
    } catch { return false; }
  }
}

const pids = pidsListeningOn(PORT);

if (pids.length === 0) {
  console.log(`Port ${PORT} is free.`);
  process.exit(0);
}

if (!(await ourServerIsUp())) {
  console.log(`Port ${PORT} is held by something that is not Church Connect - leaving it alone.`);
  process.exit(0);
}

for (const pid of pids) {
  if (pid === String(process.pid)) continue;
  if (stop(pid)) {
    console.log(`Freed port ${PORT}: stopped a previous Church Connect server (PID ${pid}).`);
  } else {
    console.log(`Could not stop PID ${pid} on port ${PORT}.`);
  }
}

// Give the operating system a moment to release the socket before binding.
await new Promise((done) => setTimeout(done, 500));
