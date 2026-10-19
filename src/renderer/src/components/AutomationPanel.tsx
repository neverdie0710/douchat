import { CalendarClock, Pause, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ReactElement } from 'react'
import type { AgentConfig, Conversation, Routine, RoutineSchedule, TaskRun } from '../../../shared/types'
import { t } from '../preferences'
import { AgentAvatar, ConversationAvatar, EmptyAvatar, agentDisplayName, conversationDisplayName } from './common'

/** Scheduled tasks created from conversations: list, run now, pause and delete. */
function routineScheduleLabel(schedule: RoutineSchedule): string {
  if (schedule.kind === 'once') {
    return t('Once')
  }
  if (schedule.kind === 'interval') {
    const minutes = Math.max(1, Math.round(schedule.intervalMinutes))
    if (minutes % 1440 === 0) return t('Every {count} days').replace('{count}', String(minutes / 1440))
    if (minutes % 60 === 0) return t('Every {count} hours').replace('{count}', String(minutes / 60))
    return t('Every {count} minutes').replace('{count}', String(minutes))
  }
  const labels = [t('Sun'), t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat')]
  const days = [...new Set(schedule.days)].sort().map((day) => labels[day]).join(' · ')
  return `${days} · ${schedule.time}`
}

export function AutomationPanel({ routines, runs, agents, conversations, userName, userAvatar, onDelete, onSetEnabled, onRunNow }: {
  routines: Routine[]
  runs: TaskRun[]
  agents: AgentConfig[]
  conversations: Conversation[]
  userName: string
  userAvatar: string
  onDelete?: (id: string) => Promise<void>
  onSetEnabled?: (id: string, enabled: boolean) => Promise<void>
  onRunNow?: (id: string) => Promise<void>
}): ReactElement {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const perform = async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusy(key)
    setError('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy('') }
  }
  const remove = async (routine: Routine): Promise<void> => {
    if (!onDelete || !window.confirm(t('Delete this automation?'))) return
    await perform(`delete:${routine.id}`, () => onDelete(routine.id))
  }
  const date = (value: number): string => new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))

  return <>
    <header className="settings-heading"><div><h1>{t('Automation')}</h1><p>{t('Scheduled tasks created from your conversations.')}</p></div></header>
    {error && <p className="settings-error" role="alert">{t(error)}</p>}
    {!routines.length ? <section className="automation-empty">
      <CalendarClock size={28} aria-hidden="true" />
      <strong>{t('No scheduled tasks yet')}</strong>
      <p>{t('Ask any contact to remind you later or run something on a schedule.')}</p>
    </section> : <section className="automation-list" aria-label={t('Automation')}>
      {routines.map((routine) => {
        const agent = agents.find((item) => item.id === routine.agentId)
        const conversation = conversations.find((item) => item.id === routine.conversationId)
        const contactName = conversation
          ? conversationDisplayName(conversation, agents)
          : agent
            ? agentDisplayName(agent)
            : t('Unknown conversation')
        const lastRun = runs
          .filter((run) => run.routineId === routine.id)
          .sort((left, right) => right.createdAt - left.createdAt)[0]
        const onceFinished = routine.schedule.kind === 'once' && routine.schedule.runAt <= Date.now()
        const status = lastRun?.status === 'running'
          ? t('Running')
          : routine.enabled && lastRun?.status === 'failed'
            ? t('Retrying')
            : routine.enabled
              ? t('Active')
              : lastRun?.status === 'failed'
                ? t('Failed')
                : onceFinished && lastRun?.status === 'succeeded'
                  ? t('Completed')
                  : onceFinished
                    ? t('Expired')
                    : t('Paused')
        return <article className="automation-row" key={routine.id}>
          <div className="automation-row-copy">
            <div className="automation-row-title"><strong>{routine.name}</strong><span data-enabled={routine.enabled}>{status}</span></div>
            <p>{routine.prompt}</p>
            <div className="automation-row-meta">
              <span className="automation-row-contact">
                {conversation
                  ? <ConversationAvatar conversation={conversation} agents={agents} userName={userName} userAvatar={userAvatar} size={22} />
                  : agent
                    ? <AgentAvatar agent={agent} size={22} />
                    : <EmptyAvatar size={22} />}
                <span className="automation-row-contact-name">{contactName}</span>
              </span>
              <span>{routineScheduleLabel(routine.schedule)}</span>
              {routine.enabled
                ? <span>{t('Next run: {time}').replace('{time}', date(routine.nextRunAt))}</span>
                : routine.lastRunAt
                  ? <span>{t('Last run: {time}').replace('{time}', date(routine.lastRunAt))}</span>
                  : null}
            </div>
          </div>
          <div className="automation-row-actions">
            <button type="button" className="icon-button" disabled={!onRunNow || Boolean(busy)} aria-label={t('Run now')} title={t('Run now')} onClick={() => onRunNow && void perform(`run:${routine.id}`, () => onRunNow(routine.id))}><Play size={16} /></button>
            <button
              type="button"
              className="icon-button"
              disabled={!onSetEnabled || Boolean(busy) || (!routine.enabled && onceFinished)}
              aria-label={routine.enabled ? t('Pause') : t('Resume')}
              title={routine.enabled ? t('Pause') : t('Resume')}
              onClick={() => onSetEnabled && void perform(`enabled:${routine.id}`, () => onSetEnabled(routine.id, !routine.enabled))}
            >{routine.enabled ? <Pause size={16} /> : <Play size={16} />}</button>
            <button type="button" className="icon-button automation-delete" disabled={!onDelete || Boolean(busy)} aria-label={t('Delete')} title={t('Delete')} onClick={() => void remove(routine)}><Trash2 size={16} /></button>
          </div>
        </article>
      })}
    </section>}
    <p className="automation-footnote">{t('If Douchat is not running when a task is due, it runs once after the next launch.')}</p>
  </>
}
