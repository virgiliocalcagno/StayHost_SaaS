"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Globe,
  ExternalLink,
  Copy,
  Palette,
  Layout,
  CreditCard,
  Users,
  TrendingUp,
  Eye,
  Settings,
  CheckCircle2,
} from "lucide-react";
import { useState, useEffect } from "react";

const stats = [
  { label: "Visitas este mes", value: "2,847", change: "+12%", icon: Eye },
  { label: "Reservas directas", value: "23", change: "+8%", icon: Users },
  { label: "Tasa de conversion", value: "4.2%", change: "+0.5%", icon: TrendingUp },
  { label: "Ingresos directos", value: "$8,450", change: "+18%", icon: CreditCard },
];

const websiteSettings = [
  { name: "URL del Hub", status: "active", value: "/hub/mi-propiedad" },
  { name: "SSL/HTTPS", status: "active", value: "Activo" },
  { name: "SEO optimizado", status: "active", value: "Configurado" },
  { name: "Google Analytics", status: "pending", value: "Pendiente" },
];

interface StoredProperty { id: string; name: string; }

const FALLBACK_PAGES = [
  { id: "villa-mar-azul", name: "Villa Mar Azul" },
  { id: "apartamento-centro", name: "Apartamento Centro" },
  { id: "casa-playa", name: "Casa de Playa" },
];

export default function DirectBookingsPanel() {
  const [origin, setOrigin] = useState("");
  const [properties, setProperties] = useState<StoredProperty[]>(FALLBACK_PAGES);

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      const raw = localStorage.getItem("stayhost_properties");
      if (raw) {
        const parsed: StoredProperty[] = JSON.parse(raw);
        if (parsed.length > 0) setProperties(parsed);
      }
    } catch {}
  }, []);

  const hostId = "mi-propiedad";
  const hubUrl = `${origin}/hub/${hostId}`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(hubUrl);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Reservas Directas</h2>
          <p className="text-muted-foreground">Gestiona tu sitio web de reservas y aumenta tus ingresos</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2">
            <Eye className="h-4 w-4" />
            Vista previa
          </Button>
          <Button className="gradient-gold text-primary-foreground gap-2">
            <Settings className="h-4 w-4" />
            Personalizar
          </Button>
        </div>
      </div>

      {/* Website URL */}
      <Card className="bg-gradient-to-r from-primary/5 to-chart-2/5 border-primary/20">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <Globe className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">Tu sitio web de reservas</h3>
              <p className="text-sm text-muted-foreground">Comparte este enlace con tus huespedes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input value={hubUrl} readOnly className="flex-1 bg-background" />
            <Button variant="outline" size="icon" onClick={copyToClipboard}>
              <Copy className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" asChild>
              <a href={hubUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <stat.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <Badge variant="secondary" className="text-chart-2 text-xs">{stat.change}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Booking Pages */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Paginas de Reserva</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {properties.map((prop) => {
                const propUrl = `${origin}/hub/${hostId}/${prop.id}`;
                return (
                  <div key={prop.id} className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
                    <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                      <Layout className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">{prop.name}</h4>
                      <p className="text-sm text-muted-foreground truncate">/hub/{hostId}/{prop.id}</p>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <a href={propUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-1" />Ver
                      </a>
                    </Button>
                  </div>
                );
              })}
              <Button variant="outline" className="w-full mt-4">
                + Agregar nueva pagina
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Website Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configuracion del Sitio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {websiteSettings.map((setting) => (
              <div key={setting.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className={`h-5 w-5 ${setting.status === "active" ? "text-chart-2" : "text-muted-foreground"}`} />
                  <div>
                    <p className="text-sm font-medium">{setting.name}</p>
                    <p className="text-xs text-muted-foreground">{setting.value}</p>
                  </div>
                </div>
                <Badge variant={setting.status === "active" ? "default" : "secondary"} className={setting.status === "active" ? "bg-chart-2" : ""}>
                  {setting.status === "active" ? "Activo" : "Pendiente"}
                </Badge>
              </div>
            ))}

            <div className="pt-4 border-t space-y-3">
              <Button variant="outline" className="w-full gap-2">
                <Palette className="h-4 w-4" />
                Personalizar diseno
              </Button>
              <Button variant="outline" className="w-full gap-2">
                <CreditCard className="h-4 w-4" />
                Configurar pagos
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
