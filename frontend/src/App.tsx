import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <CardTitle>Drimtim</CardTitle>
          </div>
          <CardDescription>
            React + shadcn + FastAPI + Vite, todo en Docker.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Plantilla base lista para empezar a construir.
          </p>
          <Button className="w-fit">Empezar</Button>
        </CardContent>
      </Card>
    </div>
  )
}
