"use client";

import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, Sparkles } from "lucide-react";

// Bandeja unificada de mensajes con IA — feature en construcción
// (Sprint 3.5 pendiente). El componente anterior renderizaba 3
// conversaciones mock (Maria/Carlos/Ana) que cualquier tenant nuevo
// veía como suyas. Reemplazado por empty state honesto hasta que
// definamos el flujo real.

export default function MessagesPanel() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Mensajes</h2>
        <p className="text-muted-foreground">
          Bandeja unificada de Airbnb, VRBO, Booking y reservas directas con respuestas IA.
        </p>
      </div>

      <Card className="border-dashed">
        <CardContent className="py-16 text-center max-w-2xl mx-auto">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-bold mb-2">Próximamente</h3>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Estamos construyendo la bandeja unificada con IA. Vas a poder responder a huéspedes
            de todos los canales desde un solo lugar, con sugerencias automáticas y plantillas
            personalizadas por propiedad.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium">
            <Sparkles className="h-4 w-4" />
            En desarrollo
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
