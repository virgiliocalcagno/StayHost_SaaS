"use client";

import { useState } from "react";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle,
  CardFooter
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  CreditCard, 
  Settings as SettingsIcon, 
  User, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Building,
  DollarSign
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface StripeAccount {
  id: string;
  name: string;
  email: string;
  status: "active" | "pending" | "error";
  createdAt: string;
}

export default function SettingsPanel() {
  const [stripeAccounts, setStripeAccounts] = useState<StripeAccount[]>([
    {
      id: "acct_1TLrTKFusZxqRmjV",
      name: "StayHost Principal",
      email: "pagos@stayhost.com",
      status: "active",
      createdAt: "2024-03-20"
    }
  ]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Configuración</h2>
        <p className="text-muted-foreground">Gestiona tus preferencias, perfil e integraciones de pago.</p>
      </div>

      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="payments" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Pagos y Cobros
          </TabsTrigger>
          <TabsTrigger value="profile" className="gap-2">
            <User className="h-4 w-4" />
            Perfil
          </TabsTrigger>
          <TabsTrigger value="general" className="gap-2">
            <SettingsIcon className="h-4 w-4" />
            General
          </TabsTrigger>
        </TabsList>

        {/* PESTAÑA DE PAGOS */}
        <TabsContent value="payments" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Sección Lateral: Informativa */}
            <div className="md:col-span-1 space-y-4">
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2 text-primary">
                    <ShieldCheck className="h-4 w-4" />
                    Infraestructura Segura
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-2">
                  <p>StayHost utiliza <strong>Stripe Connect</strong> para procesar pagos de forma segura.</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Cumplimiento con PCI-DSS</li>
                    <li>Soporte para múltiples divisas (USD, DOP, etc.)</li>
                    <li>Liquidaciones automáticas a tu banco</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Otros Métodos
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between p-2 rounded-lg border bg-card">
                    <span className="text-xs font-medium">PayPal</span>
                    <Button variant="outline" size="sm" className="h-7 text-[10px]">Configurar</Button>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg border bg-card opacity-60">
                    <span className="text-xs font-medium">BHD León (Manual)</span>
                    <Badge variant="secondary" className="text-[10px]">Pronto</Badge>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sección Principal: Gestión de Stripe */}
            <div className="md:col-span-2 space-y-4">
              <Card className="border-none shadow-md overflow-hidden outline outline-1 outline-primary/10">
                <div className="h-2 bg-gradient-to-r from-blue-600 to-indigo-600" />
                <CardHeader className="flex flex-row items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <div className="bg-[#635BFF] p-1.5 rounded text-white italic font-extrabold text-xs">stripe</div>
                      Cuentas de Stripe
                    </CardTitle>
                    <CardDescription>
                      Vincula una o más cuentas para recibir pagos de tus propiedades.
                    </CardDescription>
                  </div>
                  <Button className="gap-2 bg-[#635BFF] hover:bg-[#4b44cc] text-white">
                    <Plus className="h-4 w-4" />
                    Nueva Cuenta
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {stripeAccounts.map((account) => (
                    <div key={account.id} className="flex items-center justify-between p-4 rounded-xl border bg-card/50 hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="bg-primary/10 p-2 rounded-full">
                          <Building className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{account.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{account.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 gap-1.5">
                          <CheckCircle2 className="h-3 w-3" />
                          Conectada
                        </Badge>
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
                <CardFooter className="bg-muted/30 border-t p-4 flex justify-between">
                   <p className="text-xs text-muted-foreground">
                    Gestionado vía <span className="font-semibold text-primary">StayHost Payments</span>
                   </p>
                   <Button variant="link" className="text-xs h-auto p-0">Ver tutorial de integración</Button>
                </CardFooter>
              </Card>

              {/* Ajustes de Moneda y Checkout */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Preferencias de Cobro</CardTitle>
                  <CardDescription>Configura cómo tus huéspedes verán los cargos.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Moneda Principal</Label>
                      <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                        <option>USD - Dólares Americanos</option>
                        <option>DOP - Pesos Dominicanos</option>
                        <option>EUR - Euros</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Política de Comisiones</Label>
                      <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                        <option>Absorber comisión (3.4% + 0.30)</option>
                        <option>Pasar comisión al huésped</option>
                        <option>Dividir comisión al 50%</option>
                      </select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* PESTAÑA PERFIL (Provisional) */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Mi Perfil</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nombre Completo</Label>
                  <Input defaultValue="Virgilio" />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input defaultValue="virgilio@stayhost.com" disabled />
                </div>
              </div>
              <Button>Guardar Cambios</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
