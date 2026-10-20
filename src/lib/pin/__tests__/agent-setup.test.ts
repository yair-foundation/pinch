import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AGENT_SETUPS } from '../agent-setup';

const url = 'https://get-pinch.io/api/pin/mcp';
const key = 'pk_test123';
const steps = (id: string) => {
  const setup = AGENT_SETUPS.find((a) => a.id === id);
  assert.ok(setup, id);
  return setup.steps(url, key);
};

describe('connecting an agent', () => {
  it('gives every agent the address and the key, once each', () => {
    assert.equal(new Set(AGENT_SETUPS.map((a) => a.id)).size, AGENT_SETUPS.length);
    for (const a of AGENT_SETUPS) {
      const all = a
        .steps(url, key)
        .map((s) => s.code)
        .join('\n');
      assert.ok(all.includes(url), `${a.name} has the address`);
      assert.equal(all.split(key).length - 1, 1, `${a.name} has the key once`);
      for (const s of a.steps(url, key)) assert.doesNotMatch(s.where, /[→←↔⇄]/);
    }
  });

  it('writes each agent’s own format', () => {
    assert.equal(
      steps('claude-code')[0].code,
      `claude mcp add --transport http pinch ${url} --header "Authorization: Bearer ${key}"`,
    );
    assert.deepEqual(JSON.parse(steps('cursor')[0].code), {
      mcpServers: { pinch: { url, headers: { Authorization: `Bearer ${key}` } } },
    });
    assert.deepEqual(JSON.parse(steps('vscode')[0].code), {
      servers: { pinch: { type: 'http', url, headers: { Authorization: `Bearer ${key}` } } },
    });
    assert.deepEqual(JSON.parse(steps('windsurf')[0].code), {
      mcpServers: { pinch: { serverUrl: url, headers: { Authorization: `Bearer ${key}` } } },
    });
    assert.equal(
      steps('gemini')[0].code,
      `gemini mcp add --transport http --header "Authorization: Bearer ${key}" pinch ${url}`,
    );
  });

  it('keeps Codex’s key out of its config file, in the shell', () => {
    const [config, shell] = steps('codex');
    assert.match(config.code, /^\[mcp_servers\.pinch\]$/m);
    assert.match(config.code, /^bearer_token_env_var = "PINCH_KEY"$/m);
    assert.ok(!config.code.includes(key));
    assert.equal(shell.code, `export PINCH_KEY="${key}"`);
  });
});
