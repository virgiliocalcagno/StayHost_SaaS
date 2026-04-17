"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Play, ArrowRight, Calendar, MessageSquare, TrendingUp } from "lucide-react";
import Link from "next/link";

export default function HeroSection() {
  return (
    <section className="relative gradient-hero overflow-hidden">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-float-delayed" />
      </div>

      <div className="container relative py-20 lg:py-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left Content */}
          <div className="space-y-8 animate-slide-up">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="px-3 py-1 text-sm font-medium">
                <Star className="h-3 w-3 mr-1 fill-primary text-primary" />
                4.8/5 en App Store
              </Badge>
            </div>

            <div className="space-y-4">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-foreground leading-tight">
                Software de{" "}
                <span className="text-primary">Alquileres Vacacionales</span>
              </h1>
              <p className="text-xl md:text-2xl text-muted-foreground font-light">
                para anfitriones de Airbnb en movimiento
              </p>
            </div>

            <p className="text-lg text-muted-foreground max-w-lg">
              Gestiona toda la experiencia del huesped con mensajes IA, precios dinamicos
              y sitio web de reservas directas. Todo lo que necesitas, en un solo lugar.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                size="lg"
                asChild
                className="gradient-gold text-primary-foreground hover:opacity-90 transition-all text-base px-8 h-12"
              >
                <Link href="/dashboard">
                  Prueba Gratis 14 Dias
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-2 text-base px-8 h-12 group"
              >
                <Play className="mr-2 h-5 w-5 group-hover:scale-110 transition-transform" />
                Ver Demo
              </Button>
            </div>
          </div>

          {/* Right Content - Dashboard Preview */}
          <div className="relative animate-fade-in">
            <div className="relative">
              {/* Main Dashboard Card */}
              <div className="relative bg-card rounded-2xl shadow-elevated p-6 border">
                {/* Chat Preview */}
                <div className="bg-muted rounded-xl p-4 mb-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                      <span className="text-xs font-bold text-primary-foreground">IA</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-muted-foreground mb-1">StayHost - Agente IA</p>
                      <div className="bg-card rounded-lg p-3 text-sm">
                        Hola Alex! Soy tu anfitrion, Lucas. Estoy muy emocionado de darte
                        la bienvenida a ti y a tu amigo a nuestra escapada en la cabana
                        este fin de semana!
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 ml-11">
                    <div className="flex-1">
                      <div className="bg-primary/10 rounded-lg p-3 text-sm">
                        Gracias Lucas! Podrias recomendarme algun cafe o lugar cerca
                        donde podamos relajarnos o tomar fotos bonitas?
                      </div>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
                      <span className="text-xs font-bold text-white">A</span>
                    </div>
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <Calendar className="h-5 w-5 mx-auto mb-1 text-primary" />
                    <p className="text-lg font-bold">12</p>
                    <p className="text-xs text-muted-foreground">Reservas</p>
                  </div>
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <MessageSquare className="h-5 w-5 mx-auto mb-1 text-chart-2" />
                    <p className="text-lg font-bold">98%</p>
                    <p className="text-xs text-muted-foreground">Respuestas</p>
                  </div>
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <TrendingUp className="h-5 w-5 mx-auto mb-1 text-chart-4" />
                    <p className="text-lg font-bold">+25%</p>
                    <p className="text-xs text-muted-foreground">Ingresos</p>
                  </div>
                </div>
              </div>

              {/* Floating Card - Price */}
              <div className="absolute -right-4 top-1/2 transform translate-x-1/2 -translate-y-1/2 bg-card rounded-xl shadow-elevated p-4 border animate-float hidden lg:block">
                <p className="text-xs text-muted-foreground mb-1">Precio esta noche</p>
                <p className="text-2xl font-bold text-foreground">$170</p>
                <p className="text-xs text-chart-2">+15% vs ayer</p>
              </div>

              {/* Floating Card - Task */}
              <div className="absolute -left-4 bottom-10 transform -translate-x-1/2 bg-card rounded-xl shadow-elevated p-4 border animate-float-delayed hidden lg:block">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-chart-2/20 flex items-center justify-center">
                    <span className="text-chart-2 text-lg">✓</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Limpieza completada</p>
                    <p className="text-xs text-muted-foreground">Villa Mar - Hoy 14:00</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
