/**
 * Environment for workflow sessions and commands. Agents run unattended, so
 * anything that looks like a credential is removed. This is a heuristic, not
 * isolation: it keeps secrets out of the process env, nothing more.
 */
const SECRET_NAME =
  /(SECRET|TOKEN|PASSW|CREDENTIAL|PRIVATE|API_?KEY|ACCESS_?KEY|AUTH|COOKIE|SESSION|_DSN$|DATABASE_URL|CONNECTION_STRING|^AWS_|^AZURE_|^GCP_|^GOOGLE_APPLICATION|^GH_|^GITHUB_|^NPM_|^PG(PASSWORD|USER)$|^SSH_AUTH_SOCK$)/i

/** What the claude CLI itself may need to log in (agent sessions only). */
const CLAUDE_AUTH = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'])

export function scrubEnv(env: NodeJS.ProcessEnv, keep: Set<string> = new Set()): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    if (keep.has(k) || !SECRET_NAME.test(k)) out[k] = v
  }
  return out
}

export function agentEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return scrubEnv(env, CLAUDE_AUTH)
}

/** Test and lint commands don't get Claude's credentials either. */
export function commandEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return scrubEnv(env)
}
