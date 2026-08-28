const fs = require('fs');
const vm = require('vm');

function makeEl(id) {
    return {
        id,
        style: {},
        innerHTML: '',
        textContent: '',
        value: '',
        disabled: false,
        onclick: null,
        onsubmit: null,
        addEventListener() {},
        focus() {},
        querySelectorAll() { return []; },
    };
}

const els = {};
const documentStub = {
    getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
    addEventListener() {},
    querySelectorAll() { return []; },
    body: makeEl('body'),
};
const windowStub = {
    addEventListener() {},
    querySelectorAll() { return []; },
    Church2API: undefined,
};

global.window = windowStub;
global.document = documentStub;
global.localStorage = { getItem: () => null, setItem() {} };
global.navigator = { serviceWorker: { getRegistrations: () => Promise.resolve([]), register: () => Promise.resolve() } };
global.console = console;

const src = fs.readFileSync('app.js', 'utf8');
vm.runInThisContext(src, { filename: 'app.js' });

// Fire window.onload: it exposes window.ChurchApp before init() runs, and init
// failures are caught inside the handler, so this mirrors a real page load.
if (typeof windowStub.onload === 'function') windowStub.onload();

const App = windowStub.ChurchApp;
if (!App) { console.error('FAIL: ChurchApp not exposed'); process.exit(1); }
App.handleMfaRequest = () => {};
App.apiEnabled = () => false;

function render(step, ctx) {
    const auth = documentStub.getElementById('auth-screen');
    App.showAuthScreen(step, ctx || {});
    return auth.innerHTML;
}

const checks = [];
function expect(name, cond) { checks.push([name, !!cond]); }

let html = render('credentials');
expect('login has auth-shell', html.includes('class="auth-shell"'));
expect('login has brand panel', html.includes('auth-brand-panel'));
expect('login has brand CTA', html.includes('id="auth-brand-cta"'));
expect('login has form panel', html.includes('auth-form-panel'));
expect('login has band', html.includes('auth-band'));
expect('login form present', html.includes('id="login-form"'));
expect('login gradient title', html.includes('class="grad"'));
expect('login org name', html.includes('Maximum Miracle Centre'));

html = render('register');
expect('register form present', html.includes('id="register-form"'));
expect('register has brand CTA', html.includes('id="auth-brand-cta"'));
expect('register back link', html.includes('id="register-back"'));
expect('register campus select', html.includes('id="reg-branch"'));

html = render('mfa', { email: 'a@b.c', methods: ['email'] });
expect('mfa form present', html.includes('id="mfa-form"'));
expect('mfa code input', html.includes('id="mfa-code"'));
expect('mfa brand CTA', html.includes('id="auth-brand-cta"'));

// brand CTA wiring: credentials -> register
els['auth-screen'].innerHTML = render('credentials');
els['auth-brand-cta'].onclick(); // should call showAuthScreen('register')
expect('brand CTA wired on login', documentStub.getElementById('auth-screen').innerHTML.includes('id="register-form"'));

let pass = 0, fail = 0;
for (const [name, ok] of checks) {
    if (ok) { pass++; console.log('PASS: ' + name); }
    else { fail++; console.log('FAIL: ' + name); }
}
console.log(`\nRender smoke test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);