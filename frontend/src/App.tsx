import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapPin, Navigation, Phone, RefreshCw, ShieldAlert } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Defibrillator = {
  id: string
  lat: number
  lng: number
  distance_m: number
  name: string | null
  address: string | null
  indoor: boolean
  access: string | null
  opening_hours: string | null
}

type ApiResponse = {
  origin: { lat: number; lng: number }
  radius_m: number
  count: number
  results: Defibrillator[]
}

type GeoStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable'
type FetchStatus = 'idle' | 'loading' | 'ok' | 'error'

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`
}

function walkingMinutes(m: number): number {
  return Math.max(1, Math.round(m / 80))
}

function directionsUrl(
  origin: { lat: number; lng: number } | null,
  dest: { lat: number; lng: number },
): string {
  const d = `${dest.lat},${dest.lng}`
  if (!origin) {
    return `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=walking`
  }
  const o = `${origin.lat},${origin.lng}`
  return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=walking`
}

export function App() {
  const [emergencyTriggered, setEmergencyTriggered] = useState(false)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle')
  const [geoError, setGeoError] = useState<string | null>(null)
  const [aeds, setAeds] = useState<Defibrillator[]>([])
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('idle')
  const [fetchError, setFetchError] = useState<string | null>(null)

  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('unavailable')
      setGeoError('Tu navegador no permite acceder a la ubicación.')
      return
    }
    setGeoStatus('requesting')
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGeoStatus('ready')
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGeoStatus('denied')
          setGeoError('Permiso de ubicación denegado. Actívalo para encontrar el desfibrilador más cercano.')
        } else {
          setGeoStatus('unavailable')
          setGeoError('No se pudo obtener tu ubicación. Inténtalo de nuevo.')
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }, [])

  useEffect(() => {
    requestLocation()
  }, [requestLocation])

  const fetchAeds = useCallback(async (lat: number, lng: number) => {
    setFetchStatus('loading')
    setFetchError(null)
    try {
      const resp = await fetch(
        `/api/defibrillators?lat=${lat}&lng=${lng}&radius=5000&limit=5`,
      )
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data: ApiResponse = await resp.json()
      setAeds(data.results)
      setFetchStatus('ok')
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Error desconocido')
      setFetchStatus('error')
    }
  }, [])

  useEffect(() => {
    if (coords) void fetchAeds(coords.lat, coords.lng)
  }, [coords, fetchAeds])

  const closest = useMemo(() => aeds[0] ?? null, [aeds])

  const handleEmergency = () => {
    setEmergencyTriggered(true)
    window.location.href = 'tel:112'
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-rose-50 via-background to-background text-foreground dark:from-rose-950/30">
      <header className="px-5 pt-6 pb-3 sm:px-8 sm:pt-10">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <HeartGlyph className="size-5" />
            </span>
            <div className="leading-tight">
              <h1 className="text-lg font-semibold tracking-tight">Latidos</h1>
              <p className="text-xs text-muted-foreground">
                Asistencia ante un infarto
              </p>
            </div>
          </div>
          <a
            href="tel:112"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            aria-label="Llamar al 112"
          >
            112
          </a>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 pb-10 sm:px-8">
        <section
          aria-labelledby="sos-title"
          className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8"
        >
          <div className="flex flex-col items-center gap-5 text-center">
            <h2 id="sos-title" className="text-balance text-xl font-semibold sm:text-2xl">
              ¿Estás sufriendo un infarto?
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Pulsa el corazón para llamar al <strong>112</strong> y mostrar el
              desfibrilador más cercano. Mantén la calma y siéntate si es posible.
            </p>

            <HeartButton
              stopped={emergencyTriggered}
              onPress={handleEmergency}
            />

            <p
              aria-live="polite"
              className={cn(
                'min-h-5 text-sm font-medium',
                emergencyTriggered ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {emergencyTriggered
                ? 'Llamando al 112…'
                : 'Pulsa el corazón en caso de emergencia'}
            </p>
          </div>
        </section>

        <section
          aria-labelledby="aed-title"
          className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 id="aed-title" className="text-base font-semibold">
                Desfibrilador más cercano
              </h3>
              <p className="text-xs text-muted-foreground">
                Datos de OpenStreetMap · distancia en línea recta
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (coords ? fetchAeds(coords.lat, coords.lng) : requestLocation())}
              disabled={fetchStatus === 'loading' || geoStatus === 'requesting'}
            >
              <RefreshCw
                className={cn(
                  'size-4',
                  (fetchStatus === 'loading' || geoStatus === 'requesting') &&
                    'animate-spin',
                )}
              />
              Actualizar
            </Button>
          </div>

          {geoStatus === 'requesting' && (
            <StatusBlock icon={<MapPin className="size-4" />}>
              Obteniendo tu ubicación…
            </StatusBlock>
          )}

          {(geoStatus === 'denied' || geoStatus === 'unavailable') && (
            <StatusBlock
              tone="warning"
              icon={<ShieldAlert className="size-4" />}
              action={
                <Button size="sm" variant="outline" onClick={requestLocation}>
                  Reintentar
                </Button>
              }
            >
              {geoError ?? 'No hay ubicación disponible.'}
            </StatusBlock>
          )}

          {geoStatus === 'ready' && fetchStatus === 'loading' && (
            <StatusBlock icon={<RefreshCw className="size-4 animate-spin" />}>
              Buscando desfibriladores cercanos…
            </StatusBlock>
          )}

          {geoStatus === 'ready' && fetchStatus === 'error' && (
            <StatusBlock
              tone="warning"
              icon={<ShieldAlert className="size-4" />}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => coords && fetchAeds(coords.lat, coords.lng)}
                >
                  Reintentar
                </Button>
              }
            >
              No se pudo cargar la información: {fetchError}
            </StatusBlock>
          )}

          {geoStatus === 'ready' && fetchStatus === 'ok' && !closest && (
            <StatusBlock tone="warning" icon={<ShieldAlert className="size-4" />}>
              No hemos encontrado desfibriladores en un radio de 5 km. Sigue las
              indicaciones del 112.
            </StatusBlock>
          )}

          {closest && (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border bg-accent/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {closest.name ?? 'Desfibrilador (DEA)'}
                    </p>
                    {closest.address && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {closest.address}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {formatDistance(closest.distance_m)}
                      </span>
                      <span>·</span>
                      <span>~{walkingMinutes(closest.distance_m)} min a pie</span>
                      {closest.indoor && (
                        <>
                          <span>·</span>
                          <span>En interior</span>
                        </>
                      )}
                      {closest.opening_hours && (
                        <>
                          <span>·</span>
                          <span>{closest.opening_hours}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <a
                    href={directionsUrl(coords, { lat: closest.lat, lng: closest.lng })}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ size: 'lg' }), 'w-full sm:w-auto')}
                  >
                    <Navigation className="size-4" />
                    Cómo llegar
                  </a>
                  <a
                    href="tel:112"
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'lg' }),
                      'w-full sm:w-auto',
                    )}
                  >
                    <Phone className="size-4" />
                    Llamar al 112
                  </a>
                </div>
              </div>

              {aeds.length > 1 && (
                <details className="rounded-xl border bg-card">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium select-none">
                    Otros {aeds.length - 1} cercanos
                  </summary>
                  <ul className="divide-y border-t">
                    {aeds.slice(1).map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm">
                            {a.name ?? 'Desfibrilador (DEA)'}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {a.address ?? 'Sin dirección registrada'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium tabular-nums text-muted-foreground">
                            {formatDistance(a.distance_m)}
                          </span>
                          <a
                            href={directionsUrl(coords, { lat: a.lat, lng: a.lng })}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                          >
                            Ir
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </section>

        <footer className="px-1 pt-2 text-center text-[11px] text-muted-foreground">
          En España, marca <strong>112</strong> en caso de emergencia. Latidos es
          una guía y no sustituye la atención médica profesional.
        </footer>
      </main>
    </div>
  )
}

/* ============ subcomponents ============ */

function HeartButton({
  stopped,
  onPress,
}: {
  stopped: boolean
  onPress: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label="Llamar al 112 por emergencia cardiaca"
      aria-pressed={stopped}
      className={cn(
        'group relative grid size-64 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 sm:size-72',
        stopped && 'latidos-stopped',
      )}
    >
      <span
        aria-hidden
        className="latidos-ring absolute inset-0 rounded-full bg-primary/25"
      />
      <span
        aria-hidden
        className="latidos-ring latidos-ring-delay absolute inset-0 rounded-full bg-primary/15"
      />

      <span
        className={cn(
          'relative grid size-48 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_18px_40px_-12px_rgba(225,29,72,0.55)] transition active:scale-95 sm:size-56',
          stopped && 'bg-muted-foreground/70 shadow-none',
        )}
      >
        <HeartWithECG className="latidos-heart size-32 sm:size-36" stopped={stopped} />
      </span>
    </button>
  )
}

function HeartWithECG({
  className,
  stopped,
}: {
  className?: string
  stopped: boolean
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M50 86 C 18 65, 8 47, 14 32 C 19 19, 36 15, 50 30 C 64 15, 81 19, 86 32 C 92 47, 82 65, 50 86 Z"
        fill="currentColor"
      />
      {!stopped && (
        <path
          className="latidos-ecg-path"
          d="M14 52 L30 52 L36 42 L42 62 L48 36 L54 66 L60 52 L86 52"
          stroke="white"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </svg>
  )
}

function HeartGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12 21s-7-4.534-9.5-9.07C.5 7.5 3.5 3.5 7.5 3.5c2 0 3.5 1 4.5 2.5 1-1.5 2.5-2.5 4.5-2.5 4 0 7 4 5 8.43C19 16.466 12 21 12 21z" />
    </svg>
  )
}

function StatusBlock({
  children,
  icon,
  tone = 'info',
  action,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  tone?: 'info' | 'warning'
  action?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        tone === 'warning'
          ? 'border-primary/30 bg-primary/5 text-foreground'
          : 'bg-muted/40 text-muted-foreground',
      )}
    >
      {icon && <span className="mt-0.5 text-primary">{icon}</span>}
      <div className="flex-1">{children}</div>
      {action}
    </div>
  )
}
