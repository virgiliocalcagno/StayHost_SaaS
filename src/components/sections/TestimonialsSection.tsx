"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Star, Quote } from "lucide-react";

const testimonials = [
  {
    name: "Maria Garcia",
    role: "Superhost Airbnb",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop",
    content: "StayHost ha transformado la manera en que gestiono mis 5 propiedades. Los mensajes automaticos y la sincronizacion de calendarios me han ahorrado horas cada semana. Absolutamente recomendado!",
    rating: 5,
  },
  {
    name: "Carlos Rodriguez",
    role: "Gestor de Propiedades",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop",
    content: "La funcion de precios dinamicos ha incrementado mis ingresos en un 30%. El equipo de soporte es increible y siempre estan disponibles para ayudar. El mejor software que he usado.",
    rating: 5,
  },
  {
    name: "Ana Martinez",
    role: "Propietaria de Villa",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop",
    content: "Como anfitriona nueva, StayHost me ayudo a profesionalizar mi negocio desde el primer dia. La interfaz es intuitiva y las automatizaciones me permiten enfocarme en lo importante: mis huespedes.",
    rating: 5,
  },
];

export default function TestimonialsSection() {
  return (
    <section className="py-20 lg:py-28">
      <div className="container">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Por que los anfitriones aman StayHost
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Confiado por operadores en todo el mundo para el control y la consistencia
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {testimonials.map((testimonial) => (
            <Card key={testimonial.name} className="group hover:shadow-elevated transition-all duration-300">
              <CardContent className="p-6">
                <Quote className="h-8 w-8 text-primary/20 mb-4" />

                <div className="flex gap-1 mb-4">
                  {Array.from({ length: testimonial.rating }).map((_, i) => (
                    <Star key={`star-${i}`} className="h-4 w-4 fill-primary text-primary" />
                  ))}
                </div>

                <p className="text-muted-foreground mb-6 leading-relaxed">
                  {`"${testimonial.content}"`}
                </p>

                <div className="flex items-center gap-3 pt-4 border-t">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={testimonial.avatar} alt={testimonial.name} />
                    <AvatarFallback>{testimonial.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold text-foreground">{testimonial.name}</p>
                    <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Trust Badges */}
        <div className="flex flex-wrap items-center justify-center gap-8 mt-16 pt-16 border-t">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="px-3 py-1 bg-muted rounded-lg text-sm font-medium">Capterra 4.6</div>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="px-3 py-1 bg-muted rounded-lg text-sm font-medium">GetApp Leaders 2025</div>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="px-3 py-1 bg-muted rounded-lg text-sm font-medium">Software Advice 4.6</div>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="px-3 py-1 bg-muted rounded-lg text-sm font-medium">G2 High Performer</div>
          </div>
        </div>
      </div>
    </section>
  );
}
