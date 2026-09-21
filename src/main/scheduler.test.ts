import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextRoutineOccurrence, RoutineScheduler } from './scheduler'
import { DouchatStore } from './store'

const directories: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('nextRoutineOccurrence', () => {
  it('keeps an exact one-time reminder timestamp', () => {
    expect(nextRoutineOccurrence({ kind: 'once', runAt: 42_000 }, 1_000)).toBe(42_000)
  })

  it('advances interval schedules from the supplied timestamp', () => {
    expect(nextRoutineOccurrence({ kind: 'interval', intervalMinutes: 30 }, 1_000)).toBe(1_801_000)
  })

  it('finds the next selected local weekday and time', () => {
    const mondayMorning = new Date(2026, 7, 17, 8, 0, 0, 0).getTime()
    const result = nextRoutineOccurrence(
      { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
      mondayMorning
    )
    expect(new Date(result)).toEqual(new Date(2026, 7, 17, 9, 0, 0, 0))
  })

  it('rolls a weekly schedule into the following week once the time has passed', () => {
    const mondayAfternoon = new Date(2026, 7, 17, 15, 0, 0, 0).getTime()
    const result = nextRoutineOccurrence(
      { kind: 'weekly', days: [1], time: '09:00' },
      mondayAfternoon
    )
    expect(new Date(result)).toEqual(new Date(2026, 7, 24, 9, 0, 0, 0))
  })

  it('disables a one-time routine before running it', async () => {
    vi.useFakeTimers()
    const now = new Date(2026, 8, 21, 18, 0, 0).getTime()
    vi.setSystemTime(now)
    const directory = mkdtempSync(join(tmpdir(), 'douchat-once-routine-'))
    directories.push(directory)
    const store = new DouchatStore(join(directory, 'state.json'), { seedDemo: true })
    const runRoutine = vi.fn(async () => undefined)
    const scheduler = new RoutineScheduler(
      store,
      { runRoutine } as never,
      () => undefined
    )
    const agent = store.agents[0]
    const conversation = store.conversations.find((item) => item.agentIds.includes(agent.id))!
    const routine = scheduler.createRoutine({
      name: 'Drink water',
      prompt: 'Remind the human to drink water.',
      agentId: agent.id,
      conversationId: conversation.id,
      schedule: { kind: 'once', runAt: now + 5 * 60_000 },
      timezone: 'Asia/Shanghai'
    })
    vi.setSystemTime(now + 5 * 60_000)

    await (scheduler as unknown as { runDueRoutines: () => Promise<void> }).runDueRoutines()

    expect(store.routines[0]).toMatchObject({ id: routine.id, enabled: false, lastRunAt: now + 5 * 60_000 })
    expect(runRoutine).toHaveBeenCalledOnce()
    scheduler.dispose()
  })

  it('retries a failed one-time routine once, then leaves it stopped', async () => {
    vi.useFakeTimers()
    const now = new Date(2026, 8, 21, 19, 0, 0).getTime()
    vi.setSystemTime(now)
    const directory = mkdtempSync(join(tmpdir(), 'douchat-once-retry-'))
    directories.push(directory)
    const store = new DouchatStore(join(directory, 'state.json'), { seedDemo: true })
    const runRoutine = vi.fn(async () => { throw new Error('empty response') })
    const scheduler = new RoutineScheduler(store, { runRoutine } as never, () => undefined)
    const agent = store.agents[0]
    const conversation = store.conversations.find((item) => item.agentIds.includes(agent.id))!
    const routine = scheduler.createRoutine({
      name: 'Tell a joke',
      prompt: 'Tell the human a joke.',
      agentId: agent.id,
      conversationId: conversation.id,
      schedule: { kind: 'once', runAt: now + 60_000 },
      timezone: 'Asia/Shanghai'
    })
    vi.setSystemTime(now + 60_000)

    await (scheduler as unknown as { runDueRoutines: () => Promise<void> }).runDueRoutines()

    expect(store.routines[0]).toMatchObject({ id: routine.id, enabled: true, nextRunAt: now + 2 * 60_000 })
    vi.setSystemTime(now + 2 * 60_000)
    await (scheduler as unknown as { runDueRoutines: () => Promise<void> }).runDueRoutines()

    expect(store.routines[0]).toMatchObject({ id: routine.id, enabled: false })
    expect(runRoutine).toHaveBeenCalledTimes(2)
    scheduler.dispose()
  })

  it('pauses a due cloud routine before it starts when Douchat credits are empty', async () => {
    vi.useFakeTimers()
    const now = new Date(2026, 8, 21, 19, 30, 0).getTime()
    vi.setSystemTime(now)
    const directory = mkdtempSync(join(tmpdir(), 'douchat-credit-routine-'))
    directories.push(directory)
    const store = new DouchatStore(join(directory, 'state.json'), { seedDemo: true })
    const runRoutine = vi.fn(async () => undefined)
    const onChange = vi.fn()
    const getDouchatCredits = vi.fn(async () => 0)
    const scheduler = new RoutineScheduler(store, { runRoutine } as never, onChange, getDouchatCredits)
    const agent = store.agents[0]
    const conversation = store.conversations.find((item) => item.agentIds.includes(agent.id))!
    const routine = scheduler.createRoutine({
      name: 'Frequent greeting',
      prompt: 'Say hello.',
      agentId: agent.id,
      conversationId: conversation.id,
      schedule: { kind: 'interval', intervalMinutes: 3 },
      timezone: 'Asia/Shanghai'
    })
    vi.setSystemTime(now + 3 * 60_000)

    await (scheduler as unknown as { runDueRoutines: () => Promise<void> }).runDueRoutines()

    expect(getDouchatCredits).toHaveBeenCalledOnce()
    expect(runRoutine).not.toHaveBeenCalled()
    expect(store.routines[0]).toMatchObject({ id: routine.id, enabled: false })
    expect(store.routines[0].lastRunAt).toBeUndefined()
    expect(store.messages.at(-1)).toMatchObject({
      conversationId: conversation.id,
      kind: 'system',
      text: 'Douchat credit balance is insufficient'
    })
    expect(onChange).toHaveBeenCalled()
    scheduler.dispose()
  })

  it('still runs due local-agent routines when Douchat credits are empty', async () => {
    vi.useFakeTimers()
    const now = new Date(2026, 8, 21, 19, 45, 0).getTime()
    vi.setSystemTime(now)
    const directory = mkdtempSync(join(tmpdir(), 'douchat-local-routine-'))
    directories.push(directory)
    const store = new DouchatStore(join(directory, 'state.json'), { seedDemo: true })
    const agent = store.agents[0]
    store.updateAgent(agent.id, { localAgentId: 'codex', provider: 'local', model: 'codex' })
    const runRoutine = vi.fn(async () => undefined)
    const getDouchatCredits = vi.fn(async () => 0)
    const scheduler = new RoutineScheduler(store, { runRoutine } as never, () => undefined, getDouchatCredits)
    const conversation = store.conversations.find((item) => item.agentIds.includes(agent.id))!
    scheduler.createRoutine({
      name: 'Local greeting',
      prompt: 'Say hello locally.',
      agentId: agent.id,
      conversationId: conversation.id,
      schedule: { kind: 'interval', intervalMinutes: 3 },
      timezone: 'Asia/Shanghai'
    })
    vi.setSystemTime(now + 3 * 60_000)

    await (scheduler as unknown as { runDueRoutines: () => Promise<void> }).runDueRoutines()

    expect(getDouchatCredits).not.toHaveBeenCalled()
    expect(runRoutine).toHaveBeenCalledOnce()
    expect(store.routines[0]).toMatchObject({ enabled: true, lastRunAt: now + 3 * 60_000 })
    scheduler.dispose()
  })

  it('pauses a recurring routine after the gateway reports insufficient credits', async () => {
    vi.useFakeTimers()
    const now = new Date(2026, 8, 21, 20, 0, 0).getTime()
    vi.setSystemTime(now)
    const directory = mkdtempSync(join(tmpdir(), 'douchat-credit-failure-routine-'))
    directories.push(directory)
    const store = new DouchatStore(join(directory, 'state.json'), { seedDemo: true })
    const runRoutine = vi.fn(async () => { throw new Error('Douchat credit balance is insufficient') })
    const scheduler = new RoutineScheduler(store, { runRoutine } as never, () => undefined, async () => 1)
    const agent = store.agents[0]
    const conversation = store.conversations.find((item) => item.agentIds.includes(agent.id))!
    scheduler.createRoutine({
      name: 'Frequent greeting',
      prompt: 'Say hello.',
      agentId: agent.id,
      conversationId: conversation.id,
      schedule: { kind: 'interval', intervalMinutes: 3 },
      timezone: 'Asia/Shanghai'
    })
    vi.setSystemTime(now + 3 * 60_000)

    await (scheduler as unknown as { runDueRoutines: () => Promise<void> }).runDueRoutines()

    expect(runRoutine).toHaveBeenCalledOnce()
    expect(store.routines[0]).toMatchObject({ enabled: false, lastRunAt: now + 3 * 60_000 })
    scheduler.dispose()
  })

  it('never runs another account\'s due routines after an account switch', async () => {
    vi.useFakeTimers()
    const now = new Date(2026, 8, 21, 20, 0, 0).getTime()
    vi.setSystemTime(now)
    const directory = mkdtempSync(join(tmpdir(), 'douchat-account-routine-'))
    directories.push(directory)
    const store = new DouchatStore(join(directory, 'state.db'))
    const binding = { provider: 'gateway', model: 'default' }
    const first = store.ensureDefaultCloudContact('user-1', binding)
    const runRoutine = vi.fn(async () => undefined)
    const scheduler = new RoutineScheduler(store, { runRoutine } as never, () => undefined)
    scheduler.createRoutine({
      name: 'Private reminder',
      prompt: 'Only run for user one.',
      agentId: first.agent!.id,
      conversationId: first.conversation!.id,
      schedule: { kind: 'once', runAt: now + 60_000 },
      timezone: 'Asia/Shanghai'
    })
    store.ensureDefaultCloudContact('user-2', binding)
    scheduler.accountChanged()
    vi.setSystemTime(now + 60_000)

    await (scheduler as unknown as { runDueRoutines: () => Promise<void> }).runDueRoutines()

    expect(runRoutine).not.toHaveBeenCalled()
    expect(store.routines[0]).toMatchObject({ enabled: true })
    store.setCurrentAccountId('user-1')
    scheduler.accountChanged()
    await (scheduler as unknown as { runDueRoutines: () => Promise<void> }).runDueRoutines()
    expect(runRoutine).toHaveBeenCalledOnce()
    scheduler.dispose()
  })
})
