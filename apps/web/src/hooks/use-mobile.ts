import { createSignal, onSettled, type Accessor } from "solid-js"

const MOBILE_BREAKPOINT = 768

/** shadcn's `useIsMobile`, returning an accessor: `const isMobile = useIsMobile(); isMobile()`. */
export function useIsMobile(): Accessor<boolean> {
  const [isMobile, setIsMobile] = createSignal(
    typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  )

  onSettled(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  })

  return isMobile
}
