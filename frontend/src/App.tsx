import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, HeartPulse, MapPin, ShieldPlus, User } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/utils'
import { useUserData, type UserData } from '@/lib/user'
import { Onboarding } from '@/components/onboarding'

const OVERRIDE_KEY = 'latidos.override-coords'
const DEFAULT_DEMO_COORDS: Coords = { lat: 36.698555, lng: -4.439062, accuracy: 0 }

function loadOverride(): Coords | null {
  try {
    const raw = sessionStorage.getItem(OVERRIDE_KEY)
    if (raw) {
      const v = JSON.parse(raw)
      if (typeof v?.lat === 'number' && typeof v?.lng === 'number') {
        return { lat: v.lat, lng: v.lng, accuracy: 0 }
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_DEMO_COORDS
}


const EMERGENCY_DISPLAY = '112'

type Defibrillator = {
  id: string
  lat: number
  lng: number
  distance_m: number
  one_way_s: number
  round_trip_s: number
  name: string | null
  address: string | null
  available: boolean | null
  is24h: boolean
  route: { type: string; coordinates: [number, number][] } | null
}

type ApiNearestResult = {
  id: string
  descripcion?: string
  direccion?: string
  disponible_24h: boolean
  lat: number
  lon: number
  distance_m: number
  one_way_s: number
  round_trip_s: number
  horarios?: string
  acceso_pmr?: boolean
  titularidad?: string
  telefono?: string
  route?: { type: string; coordinates: [number, number][] }
}
type ApiNearestResponse = {
  origin: { lat: number; lon: number }
  max_round_trip_s: number
  speed_kmh: number
  max_radius_m: number
  count: number
  results: ApiNearestResult[]
}
type Coords = { lat: number; lng: number; accuracy: number }
type GateState = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'unsupported'

function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}

function fmtMinutesFromSeconds(s: number): string {
  const mins = Math.max(1, Math.round(s / 60))
  return `${mins} min`
}

export function App() {
  const { data: user, save: saveUser } = useUserData()
  const [editingUser, setEditingUser] = useState(false)
  const [gate, setGate] = useState<GateState>('idle')
  const [coords, setCoords] = useState<Coords | null>(null)
  const [override] = useState<Coords | null>(() => loadOverride())
  const [aeds, setAeds] = useState<Defibrillator[] | null>(null)
  const [aedError, setAedError] = useState<string | null>(null)
  const [pressed, setPressed] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)

  const effectiveCoords = useMemo(() => override ?? coords, [override, coords])

  const loadAeds = useCallback(async (lat: number, lng: number) => {
    setAedError(null)
    try {
      const now = new Date()
      const url =
        `/api/nearest?lat=${lat}&lon=${lng}` +
        `&hour=${now.getHours()}&minute=${now.getMinutes()}&limit=8`
      const r = await fetch(url)
      if (!r.ok) throw new Error()
      const data: ApiNearestResponse = await r.json()
      const all: Defibrillator[] = data.results.map((item) => ({
        id: item.id,
        lat: item.lat,
        lng: item.lon,
        distance_m: item.distance_m,
        one_way_s: item.one_way_s,
        round_trip_s: item.round_trip_s,
        name: item.descripcion?.trim() || item.id || null,
        address: item.direccion?.trim() || null,
        available: true,
        is24h: item.disponible_24h,
        route: item.route ?? null,
      }))
      setAeds(all)
    } catch {
      setAedError('No se pudo cargar la información.')
    }
  }, [])

  const watchIdRef = useRef<number | null>(null)
  const firstFixRef = useRef(false)

  const handleFix = useCallback(
    (p: GeolocationPosition) => {
      const acc = p.coords.accuracy ?? 99999
      const c: Coords = {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: acc,
      }
      setGate('granted')
      setCoords((prev) => {
        if (!prev) return c
        // Prefer the more accurate fix; otherwise accept moves
        if (acc + 50 < prev.accuracy) return c
        if (acc > prev.accuracy * 3) return prev // ignore much-worse fix
        const moved =
          Math.abs(prev.lat - c.lat) > 0.00005 ||
          Math.abs(prev.lng - c.lng) > 0.00005
        return moved ? c : prev
      })
      // Only fetch AEDs once, and only when we have a reasonably accurate fix
      if (!firstFixRef.current && acc < 2000) {
        firstFixRef.current = true
        void loadAeds(c.lat, c.lng)
      }
    },
    [loadAeds],
  )

  const handleErr = useCallback((err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) setGate('denied')
    else setGate('unavailable')
  }, [])

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGate('unsupported')
      return
    }
    setGate('requesting')
    firstFixRef.current = false
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current)
    navigator.geolocation.getCurrentPosition(handleFix, handleErr, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    })
    watchIdRef.current = navigator.geolocation.watchPosition(handleFix, handleErr, {
      enableHighAccuracy: true,
      timeout: 30000,
      maximumAge: 5000,
    })
  }, [handleFix, handleErr])

  useEffect(() => {
    if (!user || editingUser) return
    if (override) {
      setGate('granted')
      return
    }
    requestLocation()
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [user, editingUser, requestLocation, override])

  useEffect(() => {
    if (override) {
      firstFixRef.current = true
      void loadAeds(override.lat, override.lng)
    }
  }, [override, loadAeds])

  const handlePress = () => {
    if (pressed) return
    setPressed(true)
    // TODO: trigger background 112 call with TTS AI (server-side)
    // user data is available via `user`; ubicación via `coords`
  }

  if (!user || editingUser) {
    return (
      <Onboarding
        initial={user}
        onCancel={editingUser ? () => setEditingUser(false) : undefined}
        onComplete={(data) => {
          saveUser(data)
          setEditingUser(false)
        }}
      />
    )
  }

  if (gate !== 'granted') {
    return <Gate state={gate} onRetry={requestLocation} />
  }

  if (user.role === 'colaborador') {
    return (
      <CollaboratorView
        user={user}
        coords={effectiveCoords}
        onOpenProfile={() => setEditingUser(true)}
      />
    )
  }

  if (pressed) {
    return (
      <div className="fixed inset-0 flex flex-col bg-background text-foreground antialiased">
        <div className="relative flex-1">
          <MapView coords={effectiveCoords} aeds={aeds} selectedIdx={selectedIdx} fill />
        </div>
        <div className="max-h-[42vh] overflow-y-auto px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <List
            aeds={aeds}
            error={aedError}
            selectedIdx={selectedIdx}
            onSelect={setSelectedIdx}
            onRetry={() =>
              effectiveCoords && loadAeds(effectiveCoords.lat, effectiveCoords.lng)
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground antialiased">
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 pt-6 pb-6 sm:max-w-lg sm:pt-10">
        <header className="grid grid-cols-3 items-center">
          <div />
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Latidos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Hola, {user.name.split(' ')[0]}
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setEditingUser(true)}
              className="grid size-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted"
              aria-label="Mis datos"
            >
              <User className="size-5" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center py-10">
          <HeartButton onPress={handlePress} />
        </div>
      </main>
    </div>
  )
}

/* ============ Collaborator view ============ */

function CollaboratorView({
  user,
  coords,
  onOpenProfile,
}: {
  user: UserData
  coords: Coords | null
  onOpenProfile: () => void
}) {
  const status = availabilityStatus(user)
  return (
    <div className="min-h-[100dvh] bg-background text-foreground antialiased">
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 pt-6 pb-6 sm:max-w-lg sm:pt-10">
        <header className="grid grid-cols-3 items-center">
          <div />
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Latidos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Hola, {user.name.split(' ')[0]}
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onOpenProfile}
              className="grid size-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted"
              aria-label="Mis datos"
            >
              <User className="size-5" />
            </button>
          </div>
        </header>

        <section
          aria-label="Estado"
          className="mt-6 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3"
        >
          <span className="relative grid size-10 place-items-center rounded-full bg-primary text-primary-foreground">
            <ShieldPlus className="size-5" />
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" aria-hidden />
          </span>
          <div className="flex-1 leading-tight">
            <p className="text-sm font-semibold">{status.title}</p>
            <p className="text-xs text-muted-foreground">{status.description}</p>
          </div>
        </section>

        <div className="mt-4">
          <MapView coords={coords} aeds={null} zones={user.zones} />
        </div>

        <section className="mt-4 rounded-2xl border bg-card p-5 text-center">
          <p className="text-sm font-medium">No hay emergencias activas</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {user.availability === 'app'
              ? 'Abre Latidos cuando quieras revisar avisos.'
              : 'Mantén Latidos abierto para recibir avisos en tiempo real.'}
          </p>
        </section>

        <section className="mt-4 rounded-2xl border bg-card p-4 text-xs text-muted-foreground">
          <p>
            <strong className="text-foreground">Formación: </strong>
            {trainingLabel(user)}
          </p>
        </section>
      </main>
    </div>
  )
}

function availabilityStatus(user: UserData): { title: string; description: string } {
  if (user.availability === '24/7')
    return {
      title: 'En guardia 24/7',
      description: 'Te avisaremos de cualquier emergencia cercana.',
    }
  if (user.availability === 'zones') {
    const n = user.zones.length
    return {
      title: n === 1 ? 'En guardia en 1 zona' : `En guardia en ${n} zonas`,
      description: 'Recibirás avisos cuando estés dentro de una zona.',
    }
  }
  return {
    title: 'Solo en la app',
    description: 'Verás emergencias mientras Latidos esté abierto.',
  }
}

function trainingLabel(user: UserData): string {
  switch (user.trainingLevel) {
    case 'sanitario':
      return 'Personal sanitario'
    case 'dea':
      return 'Uso de DEA'
    case 'rcp':
      return 'RCP / Soporte vital básico'
    case 'socorrista':
      return 'Socorrismo'
    case 'otro':
      return user.trainingNotes || 'Otra formación'
    default:
      return 'Sin especificar'
  }
}

/* ============ Gate (location permission wall) ============ */

function Gate({ state, onRetry }: { state: GateState; onRetry: () => void }) {
  const requesting = state === 'requesting'
  const idle = state === 'idle'
  const denied = state === 'denied'
  const unavailable = state === 'unavailable'
  const unsupported = state === 'unsupported'

  const title = idle || requesting ? 'Necesitamos tu ubicación' : '¿Activaste la ubicación?'

  const body = (() => {
    if (idle || requesting)
      return 'Para mostrarte el desfibrilador más cercano en caso de emergencia, Latidos necesita acceder a tu ubicación.'
    if (denied)
      return 'Has bloqueado el acceso a la ubicación. Ábrela en los ajustes del navegador para este sitio y vuelve a intentarlo.'
    if (unavailable)
      return 'Tu dispositivo no pudo determinar tu ubicación. Activa el GPS y vuelve a intentarlo.'
    if (unsupported)
      return 'Tu navegador no permite acceder a la ubicación. Abre Latidos en un navegador compatible.'
    return ''
  })()

  return (
    <div className="min-h-[100dvh] bg-background text-foreground antialiased">
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-6 px-6 pb-10 text-center">
        <span
          className={cn(
            'grid size-16 place-items-center rounded-full',
            denied || unavailable || unsupported
              ? 'bg-primary/10 text-primary'
              : 'bg-primary text-primary-foreground',
          )}
        >
          {denied || unavailable || unsupported ? (
            <AlertTriangle className="size-7" />
          ) : (
            <MapPin className={cn('size-7', requesting && 'animate-pulse')} />
          )}
        </span>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-balance text-sm text-muted-foreground">{body}</p>
        </div>

        {!unsupported && (
          <button
            type="button"
            onClick={onRetry}
            disabled={requesting}
            className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground shadow-[0_10px_30px_-12px_var(--primary)] transition active:scale-95 disabled:opacity-60"
          >
            {requesting ? 'Esperando permiso…' : 'Activar ubicación'}
          </button>
        )}

        <p className="px-4 text-[11px] text-muted-foreground">
          Tu ubicación nunca sale de tu dispositivo. Solo se usa para buscar
          desfibriladores cercanos.
        </p>
      </main>
    </div>
  )
}

/* ============ Heart button ============ */

function HeartButton({ onPress }: { onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label="Activar emergencia"
      className="group relative grid size-60 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 sm:size-72"
    >
      <span className="latidos-ring absolute inset-0 rounded-full bg-primary/20" />
      <span className="latidos-ring latidos-ring-2 absolute inset-0 rounded-full bg-primary/10" />

      <span className="relative grid size-44 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_24px_60px_-20px_var(--primary)] transition active:scale-95 sm:size-52">
        <HeartPulse
          className="latidos-beat size-20 sm:size-24"
          strokeWidth={2.25}
          aria-hidden
        />
      </span>
    </button>
  )
}

/* ============ Map ============ */

function MapView({
  coords,
  aeds,
  zones,
  selectedIdx = 0,
  fill = false,
}: {
  coords: Coords | null
  aeds: Defibrillator[] | null
  zones?: { id: string; name: string; lat: number; lng: number; radius_m: number }[]
  selectedIdx?: number
  fill?: boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  const initialCenterRef = useRef<Coords | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const start = initialCenterRef.current
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView(start ? [start.lat, start.lng] : [40.4168, -3.7038], start ? 15 : 5)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map)
    L.control.attribution({ prefix: false }).addAttribution('© OSM · Carto').addTo(map)
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
  }, [])

  if (coords && !initialCenterRef.current) {
    initialCenterRef.current = coords
  }

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()

    if (!coords) return

    const acc = coords.accuracy ?? 99999
    const lowQuality = acc > 1000

    const youIcon = L.divIcon({
      className: 'latidos-you',
      html: `<span class="latidos-you-dot${lowQuality ? ' latidos-you-dot--low' : ''}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    })
    L.marker([coords.lat, coords.lng], { icon: youIcon, title: 'Tú' }).addTo(layer)
    if (acc > 30) {
      L.circle([coords.lat, coords.lng], {
        radius: Math.min(acc, 5000),
        color: '#3b82f6',
        weight: 1,
        opacity: 0.5,
        fillColor: '#3b82f6',
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(layer)
    }

    const points: L.LatLngExpression[] = [[coords.lat, coords.lng]]

    if (zones && zones.length > 0) {
      zones.forEach((z, i) => {
        L.circle([z.lat, z.lng], {
          radius: z.radius_m,
          color: 'var(--primary)',
          weight: 1.5,
          opacity: 0.7,
          fillColor: 'var(--primary)',
          fillOpacity: 0.1,
        }).addTo(layer)
        const icon = L.divIcon({
          className: 'latidos-zone',
          html: `<span class="latidos-zone-pin">${i + 1}</span>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        })
        L.marker([z.lat, z.lng], { icon, title: z.name }).addTo(layer)
        points.push([z.lat, z.lng])
      })
    }

    if (aeds && aeds.length > 0) {
      aeds.forEach((a, i) => {
        const icon = L.divIcon({
          className: 'latidos-aed',
          html: `<span class="latidos-aed-pin${i === selectedIdx ? ' is-primary' : ''}">${i + 1}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        })
        L.marker([a.lat, a.lng], { icon }).addTo(layer)
        points.push([a.lat, a.lng])
      })

      const selected = aeds[selectedIdx] ?? aeds[0]
      L.polyline(
        [[coords.lat, coords.lng], [selected.lat, selected.lng]],
        { color: 'var(--primary)', weight: 2, opacity: 0.4, dashArray: '6 8' },
      ).addTo(layer)
      if (selected.route?.coordinates) {
        const latlngs = selected.route.coordinates.map(
          ([lng, lat]) => [lat, lng] as L.LatLngExpression,
        )
        L.polyline(latlngs, { color: 'var(--primary)', weight: 5, opacity: 0.85 }).addTo(layer)
      }

      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 17 })
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 })
    } else {
      map.setView([coords.lat, coords.lng], 14)
    }
  }, [coords, aeds, zones, selectedIdx])

  useEffect(() => {
    const map = mapRef.current
    const el = containerRef.current
    if (!map || !el) return
    map.invalidateSize()
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [fill])

  return (
    <div
      ref={containerRef}
      className={cn(
        'w-full overflow-hidden bg-muted',
        fill
          ? 'absolute inset-0 h-full'
          : 'h-64 rounded-2xl border sm:h-72',
      )}
      aria-label="Mapa de desfibriladores cercanos"
    />
  )
}

/* ============ List ============ */

function List({
  aeds,
  error,
  selectedIdx = 0,
  onSelect,
  onRetry,
}: {
  aeds: Defibrillator[] | null
  error: string | null
  selectedIdx?: number
  onSelect?: (idx: number) => void
  onRetry: () => void
}) {
  if (error) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm">
        <p className="text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Reintentar
        </button>
      </div>
    )
  }

  if (!aeds) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    )
  }

  if (aeds.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        No hay desfibriladores registrados en 5 km.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
      {aeds.slice(0, 5).map((a, i) => (
        <li
          key={a.id}
          onClick={() => onSelect?.(i)}
          className={cn(
            'flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors',
            i === selectedIdx ? 'bg-primary/5' : 'hover:bg-muted/50',
          )}
        >
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold',
              i === selectedIdx
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground',
            )}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-medium">
                {a.name ?? 'Desfibrilador (DEA)'}
              </p>
              {a.is24h && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  24h
                </span>
              )}
              {a.available === false && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Cerrado
                </span>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {a.address ?? 'Sin dirección registrada'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium tabular-nums">{fmtDistance(a.distance_m)}</p>
            <p className="text-[11px] text-muted-foreground">
              {fmtMinutesFromSeconds(a.one_way_s)} a pie
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
