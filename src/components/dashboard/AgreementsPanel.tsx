"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardCheck,
  FileText,
  Plus,
  CheckCircle2,
  Clock,
  XCircle,
  Download,
  Eye,
  Edit,
  Send,
  Users,
  Calendar,
  AlertCircle,
} from "lucide-react";

// Acuerdos: feature en construcción (Sprint 3.4 — tabla agreements no
// existe todavía). Mostramos arrays vacíos hasta tener BD real.
type Template = { id: number; name: string; description: string; usedBy: number; lastUpdated: string; required: boolean };
type Agreement = { guest: string; property: string; agreement: string; sentDate: string; status: string; signedDate: string | null };
const templates: Template[] = [];
const recentAgreements: Agreement[] = [];

const stats = [
  { label: "Acuerdos firmados", value: "0", icon: CheckCircle2, color: "text-chart-2" },
  { label: "Pendientes", value: "0", icon: Clock, color: "text-primary" },
  { label: "Expirados", value: "0", icon: XCircle, color: "text-chart-4" },
  { label: "Tasa de firma", value: "—", icon: Users, color: "text-chart-3" },
];

export default function AgreementsPanel() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Acuerdos de Alquiler</h2>
          <p className="text-muted-foreground">Gestiona contratos y terminos para tus huespedes</p>
        </div>
        <Button className="gradient-gold text-primary-foreground gap-2">
          <Plus className="h-4 w-4" />
          Nueva plantilla
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-muted">
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Templates */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Plantillas de Acuerdo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {templates.map((template) => (
                <div key={template.id} className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
                  <div className="p-3 rounded-xl bg-primary/10">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{template.name}</h4>
                      {template.required && (
                        <Badge variant="secondary" className="text-xs">Obligatorio</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{template.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Usado en {template.usedBy} propiedades - Actualizado {template.lastUpdated}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon">
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" className="w-full mt-2">
                <Plus className="h-4 w-4 mr-2" />
                Crear nueva plantilla
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configuracion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-chart-2" />
                <span className="text-sm">Envio automatico al confirmar</span>
              </div>
              <Badge className="bg-chart-2">Activo</Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-chart-2" />
                <span className="text-sm">Recordatorio 24h antes</span>
              </div>
              <Badge className="bg-chart-2">Activo</Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm">Bloquear check-in sin firma</span>
              </div>
              <Badge variant="secondary">Inactivo</Badge>
            </div>
            <div className="pt-4 border-t">
              <Button variant="outline" className="w-full">
                Configurar automatizaciones
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Agreements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Acuerdos Recientes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentAgreements.map((agreement, i) => (
              <div key={i} className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-full ${
                    agreement.status === "signed" ? "bg-chart-2/10" :
                    agreement.status === "pending" ? "bg-primary/10" : "bg-chart-4/10"
                  }`}>
                    {agreement.status === "signed" ? (
                      <CheckCircle2 className="h-5 w-5 text-chart-2" />
                    ) : agreement.status === "pending" ? (
                      <Clock className="h-5 w-5 text-primary" />
                    ) : (
                      <XCircle className="h-5 w-5 text-chart-4" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium">{agreement.guest}</p>
                    <p className="text-sm text-muted-foreground">{agreement.property} - {agreement.agreement}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm">Enviado: {agreement.sentDate}</p>
                    {agreement.signedDate && (
                      <p className="text-xs text-chart-2">Firmado: {agreement.signedDate}</p>
                    )}
                  </div>
                  <Badge
                    variant={agreement.status === "signed" ? "default" : "secondary"}
                    className={agreement.status === "signed" ? "bg-chart-2" : agreement.status === "expired" ? "bg-chart-4 text-white" : ""}
                  >
                    {agreement.status === "signed" ? "Firmado" : agreement.status === "pending" ? "Pendiente" : "Expirado"}
                  </Badge>
                  {agreement.status === "pending" && (
                    <Button size="sm" variant="outline" className="gap-1">
                      <Send className="h-3 w-3" />
                      Reenviar
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
