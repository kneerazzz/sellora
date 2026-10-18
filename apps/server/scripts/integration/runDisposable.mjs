/** Owns one newly created container; never reads DATABASE_URL or dotenv files. */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../..', import.meta.url))
const name = `sellora-check-${randomUUID()}`
let created = false

function run(command, args, env = process.env, capture = false) {
  const result = spawnSync(command, args, {
    cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    timeout: args.includes('scripts/bench/retrieval.ts') ? 600_000 : 180_000,
  })
  if (result.error || result.status !== 0) {
    // Do not echo command arguments or inherited environment values.
    throw new Error(`${command} failed (${result.status ?? result.error?.code})`)
  }
  return result.stdout?.trim()
}

try {
  run('docker', ['run', '-d', '--name', name, '--label', 'sellora.disposable=true',
    '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_USER=sellora_test',
    '-e', 'POSTGRES_PASSWORD=disposable-local-only', '-e', 'POSTGRES_DB=sellora_test_migrations',
    '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg15'], process.env, true)
  created = true
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'sellora_test',
      '-d', 'sellora_test_migrations'], { stdio: 'ignore', timeout: 5000 })
    if (result.status === 0) { ready = true; break }
    await delay(500)
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready')
  const address = run('docker', ['port', name, '5432/tcp'], process.env, true)
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Expected one loopback-only database port')
  const base = `postgresql://sellora_test:disposable-local-only@${address}`
  const env = {
    ...process.env, DOTENV_CONFIG_PATH: '/dev/null', NODE_ENV: 'test',
    DATABASE_URL: `${base}/sellora_test_migrations`,
    SELLORA_DISPOSABLE_DATABASE_URL: `${base}/sellora_test_migrations`,
    JWT_ACCESS_SECRET: 'disposable-access-secret-at-least-32-characters',
    JWT_REFRESH_SECRET: 'disposable-refresh-secret-at-least-32-characters',
    CLIENT_URL: 'http://localhost:3000', AUTH_ATTEMPT_MAX: '60', AUTH_ATTEMPT_WINDOW_SECONDS: '900',
    EMBEDDING_PROVIDER: 'local', AI_PROVIDER: 'groq', OPENAI_API_KEY: '', GROQ_API_KEY: '',
    LOCAL_EMBEDDING_SERVICE_URL: 'http://127.0.0.1:1',
    SLACK_CLIENT_WEBHOOK_URLS: '{}',
  }
  delete env.SLACK_ALERT_WEBHOOK_URL
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env)
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env)
  console.log('PASS clean Prisma deployment and repeat deployment')
  if (process.argv.includes('--operations-only')) {
    run(process.execPath, ['--import', 'tsx', 'scripts/integration/startup.ts'], env)
  } else if (process.argv.includes('--restore-only') || process.argv.includes('--offboarding-only')) {
    run(process.execPath, ['--import', 'tsx', 'scripts/integration/restore.ts',
      ...(process.argv.includes('--offboarding-only') ? ['--offboarding'] : [])],
      { ...env, SELLORA_DISPOSABLE_CONTAINER: name })
  } else if (process.argv.includes('--questionnaire-only')) {
    run(process.execPath, ['--import', 'tsx', 'scripts/integration/questionnaires.ts'], env)
  } else if (process.argv.includes('--performance-only')) {
    run(process.execPath, ['--import', 'tsx', 'scripts/bench/retrieval.ts'], env)
  } else if (process.argv.includes('--gmail-only')) {
    run(process.execPath, ['--import', 'tsx', 'scripts/integration/gmailIntake.ts'], env)
  } else if (process.argv.includes('--browser-only')) {
    run(process.execPath, ['--import', 'tsx', 'scripts/integration/draftsBrowser.ts'], env)
  } else {
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/startup.ts'], env)
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/httpKnowledge.ts'], env)
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/httpSessions.ts'], env)
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/httpAuthorization.ts'], env)
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/httpAccountLifecycle.ts'], env)
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/workloadReservations.ts'], {
    ...env, SELLORA_DISPOSABLE_DATABASE_URL: `${base}/sellora_test_migrations`,
  })
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/usageLedger.ts'], {
    ...env, SELLORA_DISPOSABLE_DATABASE_URL: `${base}/sellora_test_migrations`,
  })
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/workflowLeases.ts'], {
    ...env, SELLORA_DISPOSABLE_DATABASE_URL: `${base}/sellora_test_migrations`,
  })
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/workflowRecovery.ts'], {
    ...env, SELLORA_DISPOSABLE_DATABASE_URL: `${base}/sellora_test_migrations`,
  })
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/gmailIntake.ts'], env)
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/questionnaires.ts'], env)
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/drafts.ts'], {
    ...env, SELLORA_DISPOSABLE_DATABASE_URL: `${base}/sellora_test_migrations`,
  })
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/approvedAnswers.ts'], {
    ...env, SELLORA_DISPOSABLE_DATABASE_URL: `${base}/sellora_test_migrations`,
  })
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/draftsBrowser.ts'], {
    ...env, SELLORA_DISPOSABLE_DATABASE_URL: `${base}/sellora_test_migrations`,
  })
  run('docker', ['exec', name, 'createdb', '-U', 'sellora_test', 'sellora_test_knowledge'])
  run(process.execPath, ['--import', 'tsx', 'scripts/integration/knowledgePath.ts'], {
    ...env, SELLORA_DISPOSABLE_DATABASE_URL: `${base}/sellora_test_knowledge`,
  })
  }
} finally {
  if (created) {
    run('docker', ['rm', '-f', '-v', name], process.env, true)
    console.log('PASS disposable container and temporary database storage removed')
  }
}
