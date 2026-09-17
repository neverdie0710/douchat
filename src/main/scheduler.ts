import type { CreateRoutineInput, Routine, RoutineSchedule } from '../shared/types'
import type { DouchatRuntime } from './runtime'
import { DouchatStore } from './store'

const MAX_TIMER_DELAY = 60_000

export function nextRoutineOccurrence(schedule: RoutineSchedule, after: number): number {
  if (schedule.kind === 'interval') {
    const minutes = Math.max(1, Math.round(schedule.intervalMinutes))
    return after + minutes * 60_000
  }

  const days = new Set(schedule.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))
  const [rawHour, rawMinute] = schedule.time.split(':').map(Number)
  const hour = Number.isFinite(rawHour) ? Math.min(23, Math.max(0, rawHour)) : 9
  const minute = Number.isFinite(rawMinute) ? Math.min(59, Math.max(0, rawMinute)) : 0

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(after)
    candidate.setSeconds(0, 0)
    candidate.setDate(candidate.getDate() + offset)
    candidate.setHours(hour, minute, 0, 0)
    if (days.has(candidate.getDay()) && candidate.getTime() > after) return candidate.getTime()
  }

  return after + 24 * 60 * 60_000
}

export class RoutineScheduler {
  private timer?: NodeJS.Timeout
  private disposed = false

  constructor(
    private readonly store: DouchatStore,
    private readonly runtime: DouchatRuntime,
    private readonly onChange: () => void
  ) {}

  start(): void {
    this.scheduleNextTick()
  }

  createRoutine(input: CreateRoutineInput): Routine {
    const routine = this.store.createRoutine(input, nextRoutineOccurrence(input.schedule, Date.now()))
    this.onChange()
    this.scheduleNextTick()
    return routine
  }

  deleteRoutine(routineId: string): void {
    this.store.deleteRoutine(routineId)
    this.onChange()
    this.scheduleNextTick()
  }

  setEnabled(routineId: string, enabled: boolean): void {
    const routine = this.store.routines.find((item) => item.id === routineId)
    if (!routine) throw new Error('Routine not found')
    const nextRunAt = enabled ? nextRoutineOccurrence(routine.schedule, Date.now()) : routine.nextRunAt
    this.store.setRoutineEnabled(routineId, enabled, nextRunAt)
    this.onChange()
    this.scheduleNextTick()
  }

  async runNow(routineId: string): Promise<void> {
    const routine = this.store.routines.find((item) => item.id === routineId)
    if (!routine) throw new Error('Routine not found')
    await this.runtime.runRoutine(routine, 'manual')
  }

  checkNow(): void {
    void this.runDueRoutines()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
  }

  private scheduleNextTick(): void {
    if (this.disposed) return
    if (this.timer) clearTimeout(this.timer)
    const earliest = this.store.routines
      .filter((routine) => routine.enabled)
      .reduce((next, routine) => Math.min(next, routine.nextRunAt), Number.POSITIVE_INFINITY)
    const delay = Number.isFinite(earliest)
      ? Math.min(MAX_TIMER_DELAY, Math.max(250, earliest - Date.now()))
      : MAX_TIMER_DELAY
    this.timer = setTimeout(() => void this.runDueRoutines(), delay)
  }

  private async runDueRoutines(): Promise<void> {
    if (this.disposed) return
    const now = Date.now()
    const due = this.store.routines.filter((routine) => routine.enabled && routine.nextRunAt <= now)

    for (const routine of due) {
      const triggeredAt = Date.now()
      this.store.markRoutineTriggered(
        routine.id,
        triggeredAt,
        nextRoutineOccurrence(routine.schedule, triggeredAt)
      )
    }
    if (due.length) this.onChange()
    this.scheduleNextTick()

    await Promise.allSettled(due.map((routine) => this.runtime.runRoutine(routine, 'schedule')))
  }
}
