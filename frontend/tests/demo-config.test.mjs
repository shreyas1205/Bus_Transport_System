import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformSync } from '@babel/core';
import config from '../vite.config.js';

test('demo pins API, polling and WebSocket traffic; normal configuration is preserved', () => {
  const demo = config({ mode: 'demo' });
  assert.equal(demo.server.host, '127.0.0.1');
  assert.equal(demo.server.port, 5173);
  assert.equal(demo.server.strictPort, true);
  for (const path of ['/api', '/socket.io']) {
    assert.equal(demo.server.proxy[path].target, 'http://127.0.0.1:4001');
  }
  assert.equal(demo.server.proxy['/socket.io'].ws, true);
  assert.equal(demo.define['import.meta.env.VITE_API_URL'], '"/api"');
  assert.equal(demo.define['import.meta.env.VITE_SOCKET_URL'], '"http://localhost:5173"');

  for (const mode of ['development', 'production']) {
    const normal = config({ mode });
    assert.equal(normal.server.proxy['/api'].target, 'http://127.0.0.1:4000');
    assert.equal(normal.server.host, '0.0.0.0');
    assert.equal(normal.define, undefined);
    assert.equal(normal.server.strictPort, undefined);
    assert.equal(normal.server.proxy['/socket.io'], undefined);
  }
});

test('every active frontend source eliminates port-4000 URLs with demo definitions', async () => {
  const root = new URL('../src/', import.meta.url);
  const files = await readdir(root, { recursive: true });
  for (const file of files.filter(name => /\.(js|jsx)$/.test(name))) {
    const source = await readFile(new URL(file.replaceAll('\\', '/'), root), 'utf8');
    const definitions = config({ mode: 'demo' }).define;
    const { code } = transformSync(source, {
      configFile: false,
      babelrc: false,
      parserOpts: { plugins: ['jsx'] },
      plugins: [({ types: t }) => ({
        visitor: {
          MemberExpression(path) {
            const key = Object.keys(definitions).find(key => path.matchesPattern(key));
            if (key) path.replaceWith(t.stringLiteral(JSON.parse(definitions[key])));
          },
          LogicalExpression: {
            exit(path) {
              const result = path.evaluate();
              if (result.confident) path.replaceWith(t.valueToNode(result.value));
            },
          },
        },
      })],
    });
    assert.doesNotMatch(code, /https?\\?:[^"'`\s]*:4000\b/, file);
  }
});
