import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  HeartPulse,
  MapPinned,
  Radio,
  ShieldPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  isValidDni,
  TRAINING_OPTIONS,
  type Availability,
  type TrainingLevel,
  type UserData,
  type UserRole,
  type Zone,
} from '@/lib/user'
import { ZonesEditor } from '@/components/zones-editor'

const EMPTY: UserData = {
  role: 'padecedor',
  name: 'María García López',
  dni: '12345678Z',
  phone: '666 12 34 56',
  conditions: 'Hipertensión arterial, arritmia previa (2022).',
  allergies: 'Penicilina',
  medications: 'Bisoprolol 5 mg / día, Adiro 100 mg / día',
  emergencyContactName: 'Javier García (hijo)',
  emergencyContactPhone: '699 87 65 43',
  trainingLevel: 'sanitario',
  trainingNotes: '',
  availability: '24/7',
  zones: [],
  savedAt: '',
}

type Props = {
  initial?: UserData | null
  onComplete: (data: UserData) => void
  onCancel?: () => void
}

export function Onboarding({ initial, onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0)
  const [data, setData] = useState<UserData>(() => ({ ...EMPTY, ...(initial ?? {}) }))

  const steps = useMemo<
    ('role' | 'personal' | 'medical' | 'contact' | 'training' | 'zones')[]
  >(() => {
    if (data.role === 'colaborador') {
      const base: ('role' | 'personal' | 'training' | 'zones')[] = [
        'role',
        'personal',
        'training',
      ]
      if (data.availability === 'zones') base.push('zones')
      return base
    }
    return ['role', 'personal', 'medical', 'contact']
  }, [data.role, data.availability])

  const current = steps[step]
  const isLast = step === steps.length - 1

  const canAdvance = useMemo(() => {
    if (current === 'role') return !!data.role
    if (current === 'personal')
      return (
        data.name.trim().length > 1 &&
        isValidDni(data.dni) &&
        /[0-9]{6,}/.test(data.phone.replace(/\s/g, ''))
      )
    if (current === 'contact')
      return (
        data.emergencyContactName.trim().length > 1 &&
        /[0-9]{6,}/.test(data.emergencyContactPhone.replace(/\s/g, ''))
      )
    if (current === 'training') return data.trainingLevel !== ''
    if (current === 'zones') return data.zones.length > 0
    return true
  }, [current, data])

  const set = <K extends keyof UserData>(key: K, value: UserData[K]) =>
    setData((d) => ({ ...d, [key]: value }))

  const next = () => {
    if (!isLast) setStep(step + 1)
    else onComplete(data)
  }

  const prev = () => {
    if (step > 0) setStep(step - 1)
    else onCancel?.()
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground antialiased">
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 pt-8 pb-6 sm:max-w-lg sm:pt-12">
        <header className="flex items-center justify-between">
          <button
            type="button"
            onClick={prev}
            className="grid size-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted disabled:opacity-30"
            disabled={step === 0 && !onCancel}
            aria-label="Atrás"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground">
              <HeartPulse className="size-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">Latidos</span>
          </div>
          <div className="size-9" aria-hidden />
        </header>

        <div className="mt-6 flex items-center gap-2">
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i <= step ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>

        <div className="mt-8 flex-1">
          {current === 'role' && <StepRole data={data} set={set} />}
          {current === 'personal' && <StepPersonal data={data} set={set} />}
          {current === 'medical' && <StepMedical data={data} set={set} />}
          {current === 'contact' && <StepContact data={data} set={set} />}
          {current === 'training' && <StepTraining data={data} set={set} />}
          {current === 'zones' && (
            <StepZones zones={data.zones} setZones={(z) => set('zones', z)} />
          )}
        </div>

        <div className="sticky bottom-0 mt-6 -mx-5 bg-gradient-to-t from-background via-background to-background/0 px-5 pt-4 pb-2">
          <button
            type="button"
            onClick={next}
            disabled={!canAdvance}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-12px_var(--primary)] transition active:scale-[0.99] disabled:opacity-50"
          >
            {isLast ? 'Guardar y continuar' : 'Continuar'}
            <ChevronRight className="size-4" />
          </button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Tus datos se guardan solo en este dispositivo.
          </p>
        </div>
      </main>
    </div>
  )
}

/* ============ utilities ============ */

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6 space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

const inputClass =
  'w-full rounded-xl border border-input bg-card px-4 py-3 text-sm outline-none ring-0 transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/15'

type SetFn = <K extends keyof UserData>(key: K, value: UserData[K]) => void

/* ============ steps ============ */

function StepRole({ data, set }: { data: UserData; set: SetFn }) {
  return (
    <div className="space-y-5">
      <StepHeader
        title="¿Cómo vas a usar Latidos?"
        subtitle="Puedes cambiarlo más tarde desde tus ajustes."
      />
      <div className="space-y-3">
        <RoleCard
          active={data.role === 'padecedor'}
          onClick={() => set('role', 'padecedor')}
          icon={<Heart className="size-5" />}
          title="Padecedor"
          description="Tengo riesgo cardiaco o quiero tener Latidos por si sufro una emergencia."
        />
        <RoleCard
          active={data.role === 'colaborador'}
          onClick={() => set('role', 'colaborador')}
          icon={<ShieldPlus className="size-5" />}
          title="Colaborador"
          description="Tengo formación sanitaria o en RCP/DEA. Quiero recibir avisos para ayudar en emergencias cercanas."
        />
      </div>
    </div>
  )
}

function RoleCard({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-start gap-3 rounded-2xl border bg-card p-4 text-left transition',
        active
          ? 'border-primary ring-4 ring-primary/15'
          : 'border-border hover:border-primary/40',
      )}
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full',
          active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {icon}
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  )
}

function StepPersonal({ data, set }: { data: UserData; set: SetFn }) {
  const dniDirty = data.dni.trim().length > 0
  const dniOk = isValidDni(data.dni)
  return (
    <div className="space-y-5">
      <StepHeader
        title="Tus datos"
        subtitle={
          data.role === 'colaborador'
            ? 'Necesario para identificarte cuando llegues a una emergencia.'
            : 'Esta información se comparte con el 112 si llamas en una emergencia.'
        }
      />
      <Field label="Nombre completo">
        <input
          className={inputClass}
          placeholder="Ej. María García López"
          autoComplete="name"
          value={data.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </Field>
      <Field
        label="DNI"
        hint={
          dniDirty && !dniOk
            ? 'Formato no válido (8 cifras y letra).'
            : 'Lo usamos para identificarte ante los sanitarios.'
        }
      >
        <input
          className={cn(
            inputClass,
            'uppercase',
            dniDirty && !dniOk && 'border-primary/60 focus:border-primary',
          )}
          inputMode="text"
          autoCapitalize="characters"
          maxLength={9}
          placeholder="12345678Z"
          value={data.dni}
          onChange={(e) => set('dni', e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
        />
      </Field>
      <Field label="Teléfono" hint="Por si necesitan devolverte la llamada.">
        <input
          className={inputClass}
          inputMode="tel"
          placeholder="600 000 000"
          autoComplete="tel"
          value={data.phone}
          onChange={(e) => set('phone', e.target.value)}
        />
      </Field>
    </div>
  )
}

function StepMedical({ data, set }: { data: UserData; set: SetFn }) {
  return (
    <div className="space-y-5">
      <StepHeader
        title="Historial médico"
        subtitle="Datos críticos que el personal sanitario necesita conocer al llegar."
      />
      <Field
        label="Patologías relevantes"
        hint="Ej. cardiopatía, diabetes, asma, epilepsia, hipertensión."
      >
        <textarea
          className={cn(inputClass, 'min-h-[88px] resize-y')}
          placeholder="Escribe tus patologías separadas por comas."
          value={data.conditions}
          onChange={(e) => set('conditions', e.target.value)}
        />
      </Field>
      <Field label="Alergias" hint="Especialmente a medicamentos (penicilina, AINEs, látex…).">
        <textarea
          className={cn(inputClass, 'min-h-[72px] resize-y')}
          placeholder="Indica tus alergias."
          value={data.allergies}
          onChange={(e) => set('allergies', e.target.value)}
        />
      </Field>
      <Field
        label="Medicación actual"
        hint="Es importante saber si tomas anticoagulantes (Sintrom, Eliquis…)."
      >
        <textarea
          className={cn(inputClass, 'min-h-[72px] resize-y')}
          placeholder="Lista los medicamentos que tomas."
          value={data.medications}
          onChange={(e) => set('medications', e.target.value)}
        />
      </Field>
    </div>
  )
}

function StepContact({ data, set }: { data: UserData; set: SetFn }) {
  return (
    <div className="space-y-5">
      <StepHeader
        title="Contacto de emergencia"
        subtitle="A quién avisar si no puedes responder."
      />
      <Field label="Nombre del contacto">
        <input
          className={inputClass}
          placeholder="Ej. Juan García"
          value={data.emergencyContactName}
          onChange={(e) => set('emergencyContactName', e.target.value)}
        />
      </Field>
      <Field label="Teléfono del contacto">
        <input
          className={inputClass}
          inputMode="tel"
          placeholder="600 000 000"
          value={data.emergencyContactPhone}
          onChange={(e) => set('emergencyContactPhone', e.target.value)}
        />
      </Field>
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-foreground">
        <p>
          Al guardar, Latidos podrá compartir esta información con el 112 cuando
          actives una emergencia, junto con tu ubicación en tiempo real.
        </p>
      </div>
    </div>
  )
}

function StepTraining({ data, set }: { data: UserData; set: SetFn }) {
  return (
    <div className="space-y-6">
      <StepHeader
        title="Tu formación"
        subtitle="Solo recibirás avisos si hay una emergencia cerca y puedes ayudar."
      />
      <Field label="Tipo de formación">
        <div className="space-y-2">
          {TRAINING_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => set('trainingLevel', opt.value)}
              className={cn(
                'block w-full rounded-xl border bg-card p-3 text-left transition',
                data.trainingLevel === opt.value
                  ? 'border-primary ring-4 ring-primary/15'
                  : 'border-border hover:border-primary/40',
              )}
              aria-pressed={data.trainingLevel === opt.value}
            >
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-[11px] text-muted-foreground">{opt.hint}</p>
            </button>
          ))}
        </div>
      </Field>

      {data.trainingLevel === 'otro' && (
        <Field label="Detalles">
          <textarea
            className={cn(inputClass, 'min-h-[72px] resize-y')}
            placeholder="Describe tu formación."
            value={data.trainingNotes}
            onChange={(e) => set('trainingNotes', e.target.value)}
          />
        </Field>
      )}

      <Field label="¿Cuándo quieres recibir avisos?">
        <div className="space-y-2">
          <AvailabilityOption
            active={data.availability === '24/7'}
            onClick={() => set('availability', '24/7')}
            icon={<Radio className="size-4" />}
            title="Siempre (24/7)"
            description="Latidos comparte tu ubicación en segundo plano para avisarte de cualquier emergencia cercana."
          />
          <AvailabilityOption
            active={data.availability === 'zones'}
            onClick={() => set('availability', 'zones')}
            icon={<MapPinned className="size-4" />}
            title="Solo en mis zonas"
            description="Define zonas (casa, trabajo…). Solo recibirás avisos cuando estés dentro de una de ellas."
            recommended
          />
          <AvailabilityOption
            active={data.availability === 'app'}
            onClick={() => set('availability', 'app')}
            icon={<Clock className="size-4" />}
            title="Solo cuando abro la app"
            description="No se comparte tu ubicación en segundo plano. Solo verás emergencias al abrir Latidos."
          />
        </div>
      </Field>
    </div>
  )
}

function AvailabilityOption({
  active,
  onClick,
  icon,
  title,
  description,
  recommended,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  description: string
  recommended?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left transition',
        active
          ? 'border-primary ring-4 ring-primary/15'
          : 'border-border hover:border-primary/40',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
          active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {icon}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{title}</p>
          {recommended && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              Recomendado
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
      </div>
    </button>
  )
}

function StepZones({
  zones,
  setZones,
}: {
  zones: Zone[]
  setZones: (z: Zone[]) => void
}) {
  return (
    <div className="space-y-5">
      <StepHeader
        title="Tus zonas"
        subtitle="Toca el mapa para añadir una zona. Solo recibirás avisos cuando estés dentro."
      />
      <ZonesEditor zones={zones} onChange={setZones} />
    </div>
  )
}
