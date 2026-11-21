import { describe, expect, it } from 'vitest'
import { agentEnv, commandEnv } from './env'

const env = {
  PATH: '/usr/bin',
  HOME: '/Users/me',
  LANG: 'en_US.UTF-8',
  ANTHROPIC_API_KEY: 'sk-ant',
  AWS_SECRET_ACCESS_KEY: 'x',
  GITHUB_TOKEN: 'x',
  DB_PASSWORD: 'x',
  DATABASE_URL: 'postgres://u:p@h/db',
  STRIPE_API_KEY: 'x',
  NODE_ENV: 'development',
}

describe('workflow env', () => {
  it('removes credentials but keeps ordinary variables', () => {
    expect(commandEnv(env)).toEqual({ PATH: '/usr/bin', HOME: '/Users/me', LANG: 'en_US.UTF-8', NODE_ENV: 'development' })
  })

  it('keeps only what the claude CLI needs to log in for agent sessions', () => {
    const out = agentEnv(env)
    expect(out.ANTHROPIC_API_KEY).toBe('sk-ant')
    expect(out.GITHUB_TOKEN).toBeUndefined()
    expect(out.STRIPE_API_KEY).toBeUndefined()
  })
})
