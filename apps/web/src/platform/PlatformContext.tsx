import { createContext, useContext, type ReactNode } from 'react'
import type { PlatformAdapter } from './PlatformAdapter'

/**
 * Injecting the adapter rather than importing a singleton is what makes the Tauri port (§4.5) and
 * the tests a one-line change: swap the value, not the call sites.
 */
const PlatformContext = createContext<PlatformAdapter | null>(null)

export function PlatformProvider({
	platform,
	children,
}: {
	platform: PlatformAdapter
	children: ReactNode
}) {
	return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
}

export function usePlatform(): PlatformAdapter {
	const platform = useContext(PlatformContext)
	if (!platform) throw new Error('usePlatform must be used inside a <PlatformProvider>')
	return platform
}
