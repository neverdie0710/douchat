import { describe, expect, it } from 'vitest'
import { nextRoutineOccurrence } from './scheduler'

describe('nextRoutineOccurrence', () => {
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
})
