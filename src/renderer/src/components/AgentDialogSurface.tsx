import { Children, cloneElement, createContext, isValidElement, useContext, type ComponentProps, type HTMLAttributes, type ReactElement } from 'react'
import { NativeDialog } from './NativeDialog'

export const EmbeddedAgentSettings = createContext(false)

/** Reuse existing configuration forms without opening nested native windows. */
export function AgentDialogSurface(props: ComponentProps<typeof NativeDialog>) {
  const embedded = useContext(EmbeddedAgentSettings)
  return embedded ? <div className="agent-settings-embedded">{Children.map(props.children, child => isValidElement(child)
    ? cloneElement(child as ReactElement<HTMLAttributes<HTMLElement>>, { role: undefined, 'aria-modal': undefined }) : child)}</div> : <NativeDialog {...props} />
}
