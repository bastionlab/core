/**
 * What kind of device this is (phone / tablet / desktop), so a person can keep a different Home layout and design
 * on each. Decided by the screen and the main pointer, not the window width: a narrow desktop window stays desktop.
 */
export type DeviceKind = 'phone' | 'tablet' | 'desktop'
export const DEVICE_KINDS: DeviceKind[] = ['phone', 'tablet', 'desktop']

export function deviceKind(): DeviceKind {
  if (typeof window === 'undefined') return 'desktop'
  if (!matchMedia('(pointer: coarse)').matches) return 'desktop'
  return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet'
}
