"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight, Phone } from "lucide-react";
import Link from "next/link";

export default function CTASection() {
  return (
    <section className="py-20 lg:py-28 bg-muted/50">
      <div className="container">
        <div className="max-w-4xl mx-auto">
          <div className="relative bg-card rounded-3xl shadow-elevated p-8 md:p-12 lg:p-16 overflow-hidden">
            {/* Background decoration */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-accent/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

            <div className="relative text-center space-y-6">
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground">
                Listo para recuperar tu tiempo?
              </h2>

              <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                Mensajes, tarifas y reservas <span className="font-semibold text-foreground">gestionadas en un solo lugar.</span>
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                <Button
                  size="lg"
                  asChild
                  className="gradient-gold text-primary-foreground hover:opacity-90 transition-all text-base px-8 h-12"
                >
                  <Link href="/dashboard">
                    Comienza tu prueba gratis de 14 dias
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-2 text-base px-8 h-12"
                >
                  <Phone className="mr-2 h-5 w-5" />
                  Agendar una llamada
                </Button>
              </div>

              <p className="text-sm text-muted-foreground">
                Sin tarjeta de credito requerida. Cancela cuando quieras.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
