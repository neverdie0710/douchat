import { t } from '../preferences'
import { DecisionSettings } from './DecisionSettings'

export function SchedulingSettings() {
  return <>
    <header className="settings-heading"><div><h1>{t('Scheduling')}</h1></div></header>
    <DecisionSettings />
  </>
}
