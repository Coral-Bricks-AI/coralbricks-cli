import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentFromAiAgent, detectAgent } from '../agent.js'

const noDevin = () => false
const detect = (env: NodeJS.ProcessEnv) => detectAgent(env, noDevin)

test('AI_AGENT comes first and loses its version', () => {
  assert.equal(detect({ AI_AGENT: 'claude-code_2-1-323_agent', CLAUDECODE: '1' }), 'claude-code', 'what Claude Code sets today')
  assert.equal(detect({ AI_AGENT: 'devin@1' }), 'devin')
  assert.equal(detect({ AI_AGENT: 'github-copilot-cli' }), 'github-copilot')
  assert.equal(detect({ AI_AGENT: 'v0', CLAUDECODE: '1' }), 'v0', 'beats every other marker')
  assert.equal(agentFromAiAgent('  '), undefined)
})

test('each agent by its own marker (as @vercel/detect-agent checks them)', () => {
  assert.equal(detect({ CLAUDECODE: '1' }), 'claude-code')
  assert.equal(detect({ CLAUDE_CODE: '1' }), 'claude-code')
  assert.equal(detect({ CLAUDECODE: '1', CLAUDE_CODE_IS_COWORK: '1' }), 'claude-cowork')
  assert.equal(detect({ CODEX_THREAD_ID: '0199-abc' }), 'codex')
  assert.equal(detect({ CODEX_SANDBOX: 'seatbelt' }), 'codex')
  assert.equal(detect({ CODEX_CI: '1' }), 'codex')
  assert.equal(detect({ GEMINI_CLI: '1' }), 'gemini-cli')
  assert.equal(detect({ CURSOR_AGENT: '1' }), 'cursor')
  assert.equal(detect({ CURSOR_EXTENSION_HOST_ROLE: 'agent-exec' }), 'cursor')
  assert.equal(detect({ OPENCODE: '1' }), 'opencode')
  assert.equal(detect({ ANTIGRAVITY_AGENT: '1' }), 'antigravity')
  assert.equal(detect({ AUGMENT_AGENT: '1' }), 'augment')
  assert.equal(detect({ REPL_ID: 'abc' }), 'replit')
  assert.equal(detect({ COPILOT_MODEL: 'gpt-5' }), 'github-copilot')
  assert.equal(detectAgent({}, () => true), 'devin', 'Devin marks its machines with a file')
})

test('a person at their own terminal is "none", Cursor and Copilot users included', () => {
  assert.equal(detect({}), 'none')
  assert.equal(detect({ CURSOR_TRACE_ID: 'abc', TERM_PROGRAM: 'vscode' }), 'none', "Cursor's terminal, typed by a person")
  assert.equal(detect({ COPILOT_GITHUB_TOKEN: 'ghp_x' }), 'none', 'a token someone exported')
  assert.equal(detect({ OPENCODE: '0' }), 'none')
})

test('only a short name ever leaves: never an id or an odd value', () => {
  assert.equal(detect({ AI_AGENT: 'Some Agent!' }), 'none', 'not a name, and nothing else set')
  assert.equal(detect({ AI_AGENT: '1234567890abcdef', CLAUDECODE: '1' }), 'claude-code', 'a long number falls through')
  assert.equal(detect({ CODEX_THREAD_ID: 'secret-thread-id' }), 'codex', 'the value itself is never used')
})
