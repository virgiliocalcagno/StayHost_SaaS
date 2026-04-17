"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Zap, Crown, Rocket } from "lucide-react";
import Link from "next/link";

const plans = [
  {
    name: "Flex",
    description: "Plan flexible que escala con tus reservas",
    price: "1%",
    priceLabel: "por reserva",
    icon: Zap,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    features: [
      "Channel Manager basico",
      "Calendario unificado",
      "Mensajes automatizados",
      "Soporte por email",
      "1 propiedad incluida",
    ],
    cta: "Comenzar Gratis",
    popular: false,
  },
  {
    name: "Pro",
    description: "Solucion completa para crecimiento eficiente",
    price: "$20",
    priceLabel: "por propiedad/mes",
    icon: Crown,
    color: "text-primary",
    bgColor: "bg-primary/10",
    features: [
      "Todo en Flex",
      "Precios dinamicos",
      "Sitio web de reservas directas",
      "Gestion de equipo",
      "Reportes avanzados",
      "Integraciones premium",
      "Soporte prioritario",
    ],
    cta: "Prueba 14 Dias Gratis",
    popular: true,
  },
  {
    name: "Pro+",
    description: "Paquete de rendimiento definitivo",
    price: "$35",
    priceLabel: "por propiedad/mes",
    icon: Rocket,
    color: "text-accent",
    bgColor: "bg-accent/10",
    features: [
      "Todo en Pro",
      "Agente IA dedicado",
      "API personalizada",
      "Onboarding dedicado",
      "Gerente de cuenta",
      "SLA garantizado",
      "Funciones beta exclusivas",
    ],
    cta: "Contactar Ventas",
    popular: false,
  },
];

export default function PricingSection() {
  return (
    <section id="pricing" className="py-20 lg:py-28 bg-muted/50">
      <div className="container">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Precios simples, sin sorpresas
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Elige el plan que se adapte a tu negocio. Todos incluyen prueba gratuita de 14 dias.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={`relative overflow-hidden transition-all duration-300 hover:shadow-elevated ${
                plan.popular ? "border-primary border-2 scale-105" : "border"
              }`}
            >
              {plan.popular && (
                <div className="absolute top-0 right-0">
                  <Badge className="rounded-none rounded-bl-lg gradient-gold text-primary-foreground">
                    Mas Popular
                  </Badge>
                </div>
              )}

              <CardHeader className="pb-4">
                <div className={`w-12 h-12 rounded-xl ${plan.bgColor} flex items-center justify-center mb-4`}>
                  <plan.icon className={`h-6 w-6 ${plan.color}`} />
                </div>
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>

              <CardContent className="space-y-6">
                <div>
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground ml-2">{plan.priceLabel}</span>
                </div>

                <ul className="space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <div className={`w-5 h-5 rounded-full ${plan.popular ? "bg-primary" : "bg-muted"} flex items-center justify-center shrink-0 mt-0.5`}>
                        <Check className={`h-3 w-3 ${plan.popular ? "text-primary-foreground" : "text-muted-foreground"}`} />
                      </div>
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className={`w-full ${plan.popular ? "gradient-gold text-primary-foreground hover:opacity-90" : ""}`}
                  variant={plan.popular ? "default" : "outline"}
                  asChild
                >
                  <Link href="/dashboard">{plan.cta}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
