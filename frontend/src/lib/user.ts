import { useCallback, useEffect, useState } from 'react'

export type UserRole = 'padecedor' | 'colaborador'

export type TrainingLevel =
  | 'dea'
  | 'rcp'
  | 'sanitario'
  | 'socorrista'
  | 'otro'

export type Availability = '24/7' | 'zones' | 'app'

export type Zone = {
  id: string
  name: string
  lat: number
  lng: number
  radius_m: number
}

export type UserData = {
  role: UserRole
  name: string
  dni: string
  phone: string
  conditions: string
  allergies: string
  medications: string
  emergencyContactName: string
  emergencyContactPhone: string
  trainingLevel: TrainingLevel | ''
  trainingNotes: string
  availability: Availability
  zones: Zone[]
  savedAt: string
}

const STORAGE_KEY = 'latidos.user.v4'

const DNI_RE = /^[0-9]{8}[A-Z]$/
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'

export function isValidDni(value: string): boolean {
  const v = value.trim().toUpperCase().replace(/[\s-]/g, '')
  if (!DNI_RE.test(v)) return false
  const num = parseInt(v.slice(0, 8), 10)
  const letter = v[8]
  return DNI_LETTERS[num % 23] === letter
}

export function loadUserData(): UserData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as UserData
    if (!parsed || typeof parsed !== 'object' || !parsed.name || !parsed.role) return null
    return parsed
  } catch {
    return null
  }
}

export function saveUserData(data: UserData) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function clearUserData() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
}

export function useUserData() {
  const [data, setData] = useState<UserData | null>(() => loadUserData())

  const save = useCallback((next: UserData) => {
    const withTs: UserData = { ...next, savedAt: new Date().toISOString() }
    saveUserData(withTs)
    setData(withTs)
  }, [])

  const clear = useCallback(() => {
    clearUserData()
    setData(null)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setData(loadUserData())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { data, save, clear }
}

export const TRAINING_OPTIONS: { value: TrainingLevel; label: string; hint: string }[] = [
  { value: 'sanitario', label: 'Personal sanitario', hint: 'Médico/a, enfermero/a, TES, TES-DEA.' },
  { value: 'dea', label: 'Uso de DEA', hint: 'Curso oficial de desfibrilador.' },
  { value: 'rcp', label: 'RCP / Soporte vital básico', hint: 'Reanimación cardiopulmonar.' },
  { value: 'socorrista', label: 'Socorrismo', hint: 'Salvamento acuático u otros.' },
  { value: 'otro', label: 'Otro', hint: 'Explícalo en el campo siguiente.' },
]
