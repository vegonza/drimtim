import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/utils'
import type { Zone } from '@/lib/user'

const DEFAULT_CENTER: [number, number] = [40.4168, -3.7038]
const DEFAULT_RADIUS = 500

function newZoneId() {
  return `z_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export function ZonesEditor({
  zones,
  onChange,
}: {
  zones: Zone[]
  onChange: (next: Zone[]) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const zonesRef = useRef<Zone[]>(zones)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    zonesRef.current = zones
  }, [zones])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView(DEFAULT_CENTER, 13)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map)
    L.control.attribution({ prefix: false }).addAttribution('© OSM · Carto').addTo(map)
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)

    map.on('click', (e: L.LeafletMouseEvent) => {
      const z: Zone = {
        id: newZoneId(),
        name: `Zona ${zonesRef.current.length + 1}`,
        lat: e.latlng.lat,
        lng: e.latlng.lng,
        radius_m: DEFAULT_RADIUS,
      }
      onChangeRef.current([...zonesRef.current, z])
    })

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          map.setView([p.coords.latitude, p.coords.longitude], 15)
        },
        () => {},
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
      )
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()

    zones.forEach((z, i) => {
      L.circle([z.lat, z.lng], {
        radius: z.radius_m,
        color: 'var(--primary)',
        weight: 1.5,
        opacity: 0.8,
        fillColor: 'var(--primary)',
        fillOpacity: 0.12,
      }).addTo(layer)

      const icon = L.divIcon({
        className: 'latidos-zone',
        html: `<span class="latidos-zone-pin">${i + 1}</span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      })
      L.marker([z.lat, z.lng], { icon, title: z.name }).addTo(layer)
    })
  }, [zones])

  const updateZone = (id: string, patch: Partial<Zone>) => {
    onChange(zones.map((z) => (z.id === id ? { ...z, ...patch } : z)))
  }

  const removeZone = (id: string) => {
    onChange(zones.filter((z) => z.id !== id))
  }

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="h-64 w-full overflow-hidden rounded-2xl border bg-muted sm:h-72"
        aria-label="Mapa para definir zonas"
      />

      {zones.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-4 text-center text-xs text-muted-foreground">
          Toca el mapa para añadir tu primera zona.
        </p>
      ) : (
        <ul className="space-y-2">
          {zones.map((z, i) => (
            <li
              key={z.id}
              className="rounded-xl border bg-card p-3"
            >
              <div className="flex items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <input
                  className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
                  value={z.name}
                  onChange={(e) => updateZone(z.id, { name: e.target.value })}
                  placeholder="Nombre"
                />
                <button
                  type="button"
                  onClick={() => removeZone(z.id)}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-primary"
                  aria-label="Eliminar zona"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground">Radio</span>
                <input
                  type="range"
                  min={100}
                  max={5000}
                  step={50}
                  value={z.radius_m}
                  onChange={(e) => updateZone(z.id, { radius_m: Number(e.target.value) })}
                  className={cn('flex-1 accent-[var(--primary)]')}
                  aria-label="Radio en metros"
                />
                <span className="w-14 text-right text-[11px] tabular-nums text-foreground">
                  {z.radius_m < 1000 ? `${z.radius_m} m` : `${(z.radius_m / 1000).toFixed(1)} km`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
