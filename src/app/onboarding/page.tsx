"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";
import {
  Calendar,
  MessageSquare,
  Globe,
  Smartphone,
  FileText,
  ShoppingCart,
  Sparkles,
  ClipboardCheck,
  TrendingUp,
  Shield,
  Home,
  ArrowRight,
  Check,
} from "lucide-react";

const features = [
  {
    id: "calendar-sync",
    icon: Calendar,
    title: "Sincronizacion de calendario",
    description: "Conecta todos los canales para evitar reservas dobles",
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    id: "scheduled-messaging",
    icon: MessageSquare,
    title: "Mensajeria programada",
    description: "Ahorra tiempo con reglas de mensajeria y plantillas",
    color: "text-chart-3",
    bgColor: "bg-chart-3/10",
  },
  {
    id: "direct-bookings",
    icon: Globe,
    title: "Reservas directas",
    description: "Configura tu propio sitio web de reservas en minutos",
    color: "text-chart-2",
    bgColor: "bg-chart-2/10",
  },
  {
    id: "smart-devices",
    icon: Smartphone,
    title: "Dispositivos inteligentes",
    description: "Automatiza cerraduras inteligentes y termostatos",
    color: "text-chart-4",
    bgColor: "bg-chart-4/10",
  },
  {
    id: "owner-statements",
    icon: FileText,
    title: "Declaraciones de propietario",
    description: "Genera declaraciones detalladas para propietarios",
    color: "text-accent",
    bgColor: "bg-accent/10",
  },
  {
    id: "upsells",
    icon: ShoppingCart,
    title: "Ventas adicionales",
    description: "Ofrece complementos como check-in anticipado para aumentar ingresos",
    color: "text-chart-5",
    bgColor: "bg-chart-5/10",
  },
  {
    id: "ai-messaging",
    icon: Sparkles,
    title: "Mensajeria IA",
    description: "Maneja preguntas de huespedes automaticamente con respuestas automaticas",
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    id: "rental-agreements",
    icon: ClipboardCheck,
    title: "Acuerdos de alquiler",
    description: "Haz que los huespedes acepten terminos personalizados antes del check-in",
    color: "text-chart-3",
    bgColor: "bg-chart-3/10",
  },
  {
    id: "dynamic-pricing",
    icon: TrendingUp,
    title: "Precios dinamicos",
    description: "Ajusta automaticamente las tarifas para maximizar ganancias y ocupacion",
    color: "text-chart-2",
    bgColor: "bg-chart-2/10",
  },
  {
    id: "security-deposits",
    icon: Shield,
    title: "Depositos de seguridad",
    description: "Protege tu propiedad con depositos automaticos de huespedes",
    color: "text-chart-4",
    bgColor: "bg-chart-4/10",
  },
];

export default function OnboardingPage() {
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([
    "calendar-sync",
    "ai-messaging",
    "dynamic-pricing",
  ]);
  const [step, setStep] = useState(1);

  const toggleFeature = (featureId: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(featureId)
        ? prev.filter((id) => id !== featureId)
        : [...prev, featureId]
    );
  };

  const progress = (selectedFeatures.length / features.length) * 100;
  const router = useRouter();
  const [completing, startCompleting] = useTransition();

  const finishOnboarding = () => {
    startCompleting(async () => {
      try {
        await fetch("/api/onboarding/complete", {
          method: "POST",
          credentials: "same-origin",
        });
      } catch {
        /* si falla el POST, igual entramos al dashboard — el redirect
           guard volvera a /onboarding y reintenta */
      }
      router.replace("/dashboard");
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-gold">
              <Home className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">
              Stay<span className="text-primary">Host</span>
            </span>
          </Link>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">usuario@ejemplo.com</p>
            <p className="text-xs text-primary">Prueba gratuita de 14 dias</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-12 max-w-4xl">
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">
            Que caracteristicas te interesan mas?
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Selecciona todas las que correspondan para que podamos adaptar tu experiencia
            de incorporacion y ayudarte a comenzar.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {features.map((feature) => {
            const isSelected = selectedFeatures.includes(feature.id);
            return (
              <Card
                key={feature.id}
                onClick={() => toggleFeature(feature.id)}
                className={`p-4 cursor-pointer transition-all hover:shadow-soft border-2 ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-transparent hover:border-muted"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2.5 rounded-lg ${feature.bgColor}`}>
                    <feature.icon className={`h-5 w-5 ${feature.color}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">{feature.title}</h3>
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          isSelected
                            ? "bg-primary border-primary"
                            : "border-muted-foreground/30"
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Progress Bar */}
        <div className="mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Modulos seleccionados</span>
            <span className="font-medium">{selectedFeatures.length} de {features.length}</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Continue Button */}
        <Button
          size="lg"
          className="w-full gradient-gold text-primary-foreground hover:opacity-90 h-12 text-base"
          onClick={finishOnboarding}
          disabled={completing}
        >
          {completing ? "Guardando..." : "Continuar"}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>

        {/* Footer Note */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          Utilizamos una conexion segura para la transferencia de datos. La seguridad de tus
          datos es nuestra prioridad. Al continuar, aceptas nuestros{" "}
          <Link href="/terms" target="_blank" className="text-primary hover:underline">
            Terminos y Condiciones
          </Link>{" "}
          y{" "}
          <Link href="/privacy" target="_blank" className="text-primary hover:underline">
            Politica de Privacidad
          </Link>
          .
        </p>
      </main>

      {/* Illustration */}
      <div className="fixed bottom-0 right-0 w-96 h-96 pointer-events-none opacity-50 hidden xl:block">
        <div className="relative w-full h-full">
          <div className="absolute bottom-10 right-10 w-48 h-48 bg-primary/20 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-32 h-32 bg-accent/20 rounded-full blur-2xl" />
        </div>
      </div>
    </div>
  );
}
