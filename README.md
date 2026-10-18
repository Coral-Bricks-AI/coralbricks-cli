# coralbricks

Open your coding agent on [CoralBricks](https://www.coralbricks.ai): fast open models (GLM 5.3,
DeepSeek V4.1 Flash) with a 1M-token context, in the agent you already use. Your own agent
config is never edited.

```bash
npm install -g coralbricks
coralbricks login        # signs this terminal in through your browser
coralbricks claude       # Claude Code on CoralBricks
```

Requires Node.js 20 or later on macOS, Linux or Windows.

## Agents

| Command | Agent | Install the agent |
| --- | --- | --- |
| `coralbricks claude` | Claude Code | `npm install -g @anthropic-ai/claude-code` |
| `coralbricks codex` | Codex CLI | `npm install -g @openai/codex` |
| `coralbricks opencode` (`oc`) | OpenCode | `npm install -g opencode-ai` |
| `coralbricks pi` | Pi | `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` |

`coralbricks launch <agent>` is the same thing spelled out. Run `coralbricks` alone to pick one.

```bash
coralbricks codex -m deepseek-v4.1-flash-fast   # choose the model
coralbricks claude -- -p "explain this repo"    # agent arguments go after --
coralbricks again                               # reopen the last agent and model
coralbricks claude --dry-run                    # what would run, key masked
```

## Signing in

```bash
coralbricks login               # browser approval (the default)
coralbricks login --no-browser  # remote box: open the printed address anywhere, paste the code back
coralbricks login --manual      # paste an existing key from https://www.coralbricks.ai/api-keys
coralbricks logout              # forget the stored key
```

`coralbricks login` opens the console with a one-off public key. You check that the code on the
page matches the one in your terminal and press **Connect terminal**; the console creates a key
named `CLI (Terminal)` (or `$CORALBRICKS_DEVICE_NAME`) and seals it to this terminal (P-256 ECDH,
HKDF-SHA256, AES-256-GCM), handing it back through a listener on `127.0.0.1` or as a code to
paste. The key never crosses the network in the clear, and you can revoke it on the API Keys page.

The key is stored at `~/.config/coralbricks/credentials.json` (mode 0600).
`CORALBRICKS_API_KEY` in the environment, or `--api-key`, wins over it.

## Everything else

| Command | |
| --- | --- |
| `coralbricks models` | Models your key can call: context window, price, recent speed |
| `coralbricks status` | Key in use and whether it works; which agents are installed |
| `coralbricks env` | `eval "$(coralbricks env)"` for any other harness or SDK |

## What a launch changes

Nothing outside the launch. Per agent:

- **Claude Code**: `ANTHROPIC_BASE_URL`, the key, the model and every tier alias (opus, sonnet,
  fable, haiku) in the environment and a session-only `--settings` file, so a `env` block in your
  own settings can't send the session elsewhere. `ANTHROPIC_API_KEY` is unset for the agent.
- **Codex CLI**: `-c` overrides for a `coralbricks` provider (Responses API) and the hosted model
  catalog. Your Codex home, sessions and `codex resume` stay as they are.
- **OpenCode**: a config layer in `OPENCODE_CONFIG_CONTENT`. OpenCode 2 runs it on a private
  server (`--standalone`) so your background service never picks it up.
- **Pi**: a temporary agent directory with your own `models.json` plus a CoralBricks provider.
  Sessions are kept under `~/.cache/coralbricks/pi-sessions`.

Session files live under `~/.cache/coralbricks/sessions` and are removed when the agent exits.

## Environment

| Variable | |
| --- | --- |
| `CORALBRICKS_API_KEY` | Key to use instead of the stored login |
| `CORALBRICKS_DEVICE_NAME` | Name for the key `coralbricks login` creates |
| `CORALBRICKS_INFERENCE_URL` | Inference endpoint (default `https://inference.coralbricks.ai`) |
| `CORALBRICKS_CONSOLE_URL` | Console for `login` (default `https://www.coralbricks.ai`) |
| `NO_COLOR` | Plain output |

Docs: https://www.coralbricks.ai/docs/cli

## Development

```bash
npm install
npm test          # builds, then runs the tests in dist/
node dist/cli.js --help
```

MIT licensed.
