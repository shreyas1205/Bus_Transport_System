import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';
import { transformSync } from '@babel/core';
import { parse } from '@babel/parser';
import postcss from 'postcss';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const read = name => readFileSync(resolve(root, name), 'utf8');

// Transform JSX to inspectable elements and execute the real component functions.
// Hooks and APIs are mocked: no browser, persistence, database, or network access.
function compile(name) {
  return transformSync(read(name), {
    configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] },
    plugins: [({ types: t }) => {
      const value = node => t.isJSXExpressionContainer(node) ? node.expression : t.isJSXText(node) ? t.stringLiteral(node.value) : node;
      const children = node => node.children.map(value).filter(n => !t.isJSXEmptyExpression(n));
      return { visitor: {
      ImportDeclaration(path) { path.remove(); },
      ExportDefaultDeclaration(path) { path.replaceWith(path.node.declaration); },
      JSXFragment: { exit(path) { path.replaceWith(t.callExpression(t.identifier('h'), [t.stringLiteral('Fragment'), t.nullLiteral(), ...children(path.node)])); } },
      JSXElement: { exit(path) {
        const el = path.node.openingElement;
        const name = el.name.name;
        const props = el.attributes.map(a => t.isJSXSpreadAttribute(a)
          ? t.spreadElement(a.argument)
          : t.objectProperty(t.stringLiteral(a.name.name), a.value ? value(a.value) : t.booleanLiteral(true)));
        path.replaceWith(t.callExpression(t.identifier('h'), [
          /^[a-z]/.test(name) ? t.stringLiteral(name) : t.identifier(name),
          t.objectExpression(props), ...children(path.node)
        ]));
      } }
    } }; }]
  }).code;
}
function harness(file, component, additions = {}) {
  let cursor = 0;
  const state = [], effects = [];
  const context = vm.createContext({
    console, URLSearchParams, ...additions,
    h: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn) { cursor++; effects.push(fn); },
    useRef(initial) { const index = cursor++; return state[index] ||= { current: initial }; },
  });
  vm.runInContext(compile(file), context);
  return {
    state, effects,
    render(props) { cursor = 0; effects.length = 0; const tree = context[component](props); return { tree, hooks: cursor }; }
  };
}
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.children);
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.children)];
}

test('all active JS/JSX and CSS parse; relative imports resolve', () => {
  const files = readdirSync(root, { recursive: true }).filter(f => /\.(jsx?|css)$/.test(f));
  for (const file of files) {
    if (file.endsWith('.css')) { postcss.parse(read(file), { from: file }); continue; }
    const ast = parse(read(file), { sourceType: 'module', plugins: ['jsx'] });
    for (const node of ast.program.body.filter(n => n.type === 'ImportDeclaration' && n.source.value.startsWith('.'))) {
      const target = resolve(dirname(resolve(root, file)), node.source.value);
      assert.ok(['', '.js', '.jsx', '.css'].some(ext => existsSync(target + ext)), `${file}: ${node.source.value}`);
    }
  }
});

test('FeeSettings keeps hook order through loading, populated and failed requests', async () => {
  let fail = false;
  const ui = harness('pages/FeeSettings.jsx', 'FeeSettings', {
    useLocation: () => ({ search: '?route=r1' }),
    api: { get: async path => {
      if (fail) throw new Error('offline');
      return { data: path.endsWith('settings') ? [{ id: 's1', name: 'Library', amount: 1200, routes: [{ id: 'r1', code: 'R1' }] }] : path.endsWith('summary') ? { total: 0, paid: 0, outstanding: 0, overdue: 0, collectionRate: 0 } : [] };
    } }
  });
  const initial = ui.render();
  assert.match(text(initial.tree), /Loading pickup-point fees/);
  ui.effects[0]();
  await new Promise(setImmediate);
  const populated = ui.render();
  assert.equal(populated.hooks, initial.hooks);
  assert.match(text(populated.tree), /Library/);
  fail = true;
  ui.effects[0]();
  await new Promise(setImmediate);
  const failed = ui.render();
  assert.equal(failed.hooks, initial.hooks);
  assert.match(text(failed.tree), /Could not load fee settings/);
  assert.match(text(failed.tree), /Retry loading/);
});

test('Fees hides checkout for paid, empty, loading and unavailable data', () => {
  const ui = harness('pages/Fees.jsx', 'Fees', { useAuth: () => ({ user: { role: 'STUDENT', name: 'Test' } }) });
  assert.match(text(ui.render().tree), /Loading fee information/);
  ui.state[1] = false;
  assert.match(text(ui.render().tree), /No fee record available/);
  ui.state[0] = { fees: [{ id: 'f', amount: 100, status: 'PAID', payments: [] }] };
  assert.match(text(ui.render().tree), /No payment required/);
  assert.doesNotMatch(text(ui.render().tree), /Choose how you want to pay/);
  ui.state[0].fees[0].status = 'PENDING';
  assert.match(text(ui.render().tree), /Choose how you want to pay/);
  ui.state[5] = 'Unavailable';
  assert.match(text(ui.render().tree), /Payment information unavailable/);
  assert.doesNotMatch(text(ui.render().tree), /Choose how you want to pay/);
});

test('ProtectedRoute preserves all role gates and login redirect', () => {
  let user = null;
  const ui = harness('components/ProtectedRoute.jsx', 'ProtectedRoute', { Navigate: 'Navigate', useAuth: () => ({ user, loading: false }) });
  assert.equal(ui.render({ roles: ['ADMIN'], children: 'settings' }).tree.props.to, '/login');
  for (const role of ['ADMIN', 'DRIVER', 'STUDENT', 'PARENT', 'STAFF']) {
    user = { role };
    const result = ui.render({ roles: ['ADMIN'], children: 'settings' }).tree;
    if (role === 'ADMIN') assert.equal(result, 'settings');
    else assert.equal(result.type, 'Navigate');
  }
});

test('MapViewport resizes in place and does not refit for routine GPS updates', () => {
  let fits = 0, resizes = 0, disconnects = 0;
  const map = { getContainer: () => ({}), invalidateSize: () => resizes++, fitBounds: () => fits++ };
  const ui = harness('components/MapViewport.jsx', 'MapViewport', {
    useMap: () => map,
    ResizeObserver: class { observe() {} disconnect() { disconnects++; } },
    requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {},
    window: { addEventListener() {}, removeEventListener() {} }
  });
  ui.render({ viewKey: 'bus1', points: [[12, 77]] });
  const cleanup = ui.effects[0]();
  ui.effects[1]();
  ui.render({ viewKey: 'bus1', points: [[12.1, 77.1]] });
  ui.effects[1]();
  assert.equal(fits, 1);
  ui.render({ viewKey: 'bus2', points: [[13, 78]] });
  ui.effects[1]();
  assert.equal(fits, 2);
  assert.equal(resizes, 1);
  cleanup();
  assert.equal(disconnects, 1);
});

test('Login starts empty and preserves five-role login, Remember Me and destinations', async () => {
  let role, destination, received;
  const ui = harness('pages/Login.jsx', 'Login', {
    Reveal: 'Reveal', SupportDialog: 'SupportDialog', Link: 'Link',
    useNavigate: () => path => { destination = path; },
    useAuth: () => ({ login: async (...args) => { received = args; return { role }; }, logout() {} }),
    localStorage: { setItem() {}, removeItem() {} }
  });
  for (const [key, path] of Object.entries({ STUDENT: '/live-location', DRIVER: '/routes', STAFF: '/fees', PARENT: '/', ADMIN: '/' })) {
    role = key;
    let tree = ui.render().tree;
    const button = nodes(tree).find(n => n.type === 'button' && n.props?.['aria-pressed'] !== undefined && text(n).trim().toUpperCase() === key);
    button.props.onClick();
    tree = ui.render().tree;
    const email = nodes(tree).find(n => n.type === 'input' && n.props.type === 'email');
    const password = nodes(tree).find(n => n.type === 'input' && n.props.type === 'password');
    assert.equal(email.props.value, '');
    assert.equal(password.props.value, '');
    email.props.onChange({ target: { value: 'test@example.invalid' } });
    password.props.onChange({ target: { value: 'test-only-input' } });
    nodes(tree).find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: false } });
    tree = ui.render().tree;
    await nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.deepEqual(received, ['test@example.invalid', 'test-only-input', false]);
    assert.equal(destination, path);
  }
});
