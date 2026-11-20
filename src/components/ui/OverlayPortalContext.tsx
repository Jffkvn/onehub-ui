import { createContext, useContext } from 'react'

/**
 * Provides an in-dialog DOM mount node so nested Radix portals (Combobox, Select,
 * MultiCombobox, DropdownMenu, Tooltip) stay inside the active dialog FocusScope /
 * DismissableLayer hierarchy while stacking above sheet overlays (`z-popover`).
 */
export const OverlayPortalContext = createContext<HTMLElement | null>(null)

export function useOverlayPortalContainer(): HTMLElement | undefined {
  return useContext(OverlayPortalContext) ?? undefined
}
