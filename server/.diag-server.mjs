process.env.PORT = '4999';
const { default: app } = await import('./src/index.js');
await new Promise((r) => setTimeout(r, 900));

async function post(path, body) {
  try {
    const res = await fetch('http://localhost:4999' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log('\nPOST ' + path + ' -> HTTP ' + res.status + ' | ' + text.slice(0, 300));
  } catch (e) {
    console.log('\nPOST ' + path + ' -> FETCH ERROR ' + e.message);
  }
}
await post('/api/auth/login', { email: 'admin@maximummiracle.org', password: 'grace' });
await post('/api/auth/register', { name: 'Diag', email: 'diag' + Date.now() + '@test.org', password: 'TestPass123!', branchId: 'b1' });
process.exit(0);
