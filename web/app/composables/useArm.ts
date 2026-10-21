// tap-twice delete, like the Notes delete button: the first tap arms (button turns red, "Sure?"),
// a second tap within 4 s goes through. `if (!arm(key)) return` — key tells rows apart.
export function useArm(ms = 4000) {
  const armed = ref('')
  let t: any
  const arm = (key: string) => {
    clearTimeout(t)
    if (armed.value === key) { armed.value = ''; return true }
    armed.value = key
    t = setTimeout(() => (armed.value = ''), ms)
    return false
  }
  return { armed, arm }
}
