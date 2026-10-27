/*
 * Connecting an agent to Pinch (D89, D92): what to paste where, for each agent the person may
 * build with. Pinch is one MCP server over Streamable HTTP with a bearer key, so every agent
 * gets the same address and header, in its own format: a command, or an entry in its MCP
 * settings. The formats follow each agent's own documentation, checked 2026-10-20. The key
 * goes in the person's own settings, never a project's, so it isn't shared or committed.
 */

export type SetupStep = { where: string; code: string };
export type AgentSetup = {
  id: string;
  name: string;
  steps: (url: string, key: string) => SetupStep[];
};

const json = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * The server's name in the agent's settings: `pinch`, or `pinch-local` for a Pinch running on
 * this machine (D138), so the two can sit side by side in one agent.
 */
export const serverName = (url: string) => {
  const host = URL.canParse(url) ? new URL(url).hostname : '';
  return /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(host) ? 'pinch-local' : 'pinch';
};

export const AGENT_SETUPS: AgentSetup[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    steps: (url, key) => [
      {
        where: 'Run this in your terminal.',
        code: `claude mcp add --transport http ${serverName(url)} ${url} --header "Authorization: Bearer ${key}"`,
      },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    steps: (url, key) => [
      {
        where: 'Add this to ~/.cursor/mcp.json, inside mcpServers if the file has it already.',
        code: json({
          mcpServers: { [serverName(url)]: { url, headers: { Authorization: `Bearer ${key}` } } },
        }),
      },
    ],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    steps: (url, key) => [
      {
        where:
          'Run “MCP: Open User Configuration” and add this, inside servers if it is there already.',
        code: json({
          servers: {
            [serverName(url)]: { type: 'http', url, headers: { Authorization: `Bearer ${key}` } },
          },
        }),
      },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    steps: (url, key) => [
      {
        where: 'Add this to ~/.codex/config.toml.',
        code: `[mcp_servers.${serverName(url)}]\nurl = "${url}"\nbearer_token_env_var = "PINCH_KEY"`,
      },
      {
        where: 'Then keep your key in your shell, in ~/.zshrc or ~/.bashrc.',
        code: `export PINCH_KEY="${key}"`,
      },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    steps: (url, key) => [
      {
        where: 'Run this in your terminal.',
        code: `gemini mcp add --transport http --header "Authorization: Bearer ${key}" ${serverName(url)} ${url}`,
      },
    ],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    steps: (url, key) => [
      {
        where: 'Add this to Windsurf’s mcp_config.json, inside mcpServers if it is there already.',
        code: json({
          mcpServers: {
            [serverName(url)]: { serverUrl: url, headers: { Authorization: `Bearer ${key}` } },
          },
        }),
      },
    ],
  },
  {
    id: 'other',
    name: 'Other',
    steps: (url, key) => [
      { where: 'Any agent that speaks MCP over Streamable HTTP: the address.', code: url },
      { where: 'And this header on every request.', code: `Authorization: Bearer ${key}` },
    ],
  },
];
