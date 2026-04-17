"use client";

import { useState, useMemo } from "react";
// Recuperación de emergencia - StayHost
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Building2,
  Calendar,
  DollarSign,
  TrendingUp,
  MessageSquare,
  Star,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

const stats = [
  {
    title: "Ingresos del Mes",
    value: "$12,450",
    change: "+23%",
    trend: "up",
    icon: DollarSign,
    color: "text-chart-2",
    bgColor: "bg-chart-2/10",
  },
  {
    title: "Reservas Activas",
    value: "8",
    change: "+2",
    trend: "up",
    icon: Calendar,
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    title: "Tasa de Ocupacion",
    value: "78%",
    change: "+5%",
    trend: "up",
    icon: TrendingUp,
    color: "text-chart-4",
    bgColor: "bg-chart-4/10",
  },
  {
    title: "Mensajes Sin Leer",
    value: "12",
    change: "-3",
    trend: "down",
    icon: MessageSquare,
    color: "text-chart-3",
    bgColor: "bg-chart-3/10",
  },
];

const recentBookings = [
  {
    guest: "Maria Lopez",
    property: "Villa Mar Azul",
    dates: "Mar 28 - Abr 2",
    amount: "$1,250",
    status: "confirmed",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=50&h=50&fit=crop",
  },
  {
    guest: "Carlos Mendez",
    property: "Apartamento Centro",
    dates: "Mar 30 - Abr 1",
    amount: "$380",
    status: "pending",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=50&h=50&fit=crop",
  },
  {
    guest: "Ana Rodriguez",
    property: "Casa de Playa",
    dates: "Abr 5 - Abr 10",
    amount: "$2,100",
    status: "confirmed",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=50&h=50&fit=crop",
  },
];

const properties = [
  { name: "Villa Mar Azul", occupancy: 85, rating: 4.9 },
  { name: "Apartamento Centro", occupancy: 72, rating: 4.7 },
  { name: "Casa de Playa", occupancy: 68, rating: 4.8 },
  { name: "Loft Moderno", occupancy: 90, rating: 4.6 },
];

export default function OverviewPanel() {
  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="hover:shadow-soft transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-xl ${stat.bgColor}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div className={`flex items-center gap-1 text-sm ${
                  stat.trend === "up" ? "text-chart-2" : "text-chart-4"
                }`}>
                  {stat.trend === "up" ? (
                    <ArrowUpRight className="h-4 w-4" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4" />
                  )}
                  {stat.change}
                </div>
              </div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Bookings */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Reservas Recientes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentBookings.map((booking) => (
              <div
                key={booking.guest}
                className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
              >
                <Avatar>
                  <AvatarImage src={booking.avatar} />
                  <AvatarFallback>{booking.guest.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{booking.guest}</p>
                  <p className="text-sm text-muted-foreground truncate">{booking.property}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{booking.amount}</p>
                  <p className="text-xs text-muted-foreground">{booking.dates}</p>
                </div>
                <Badge
                  variant={booking.status === "confirmed" ? "default" : "secondary"}
                  className={booking.status === "confirmed" ? "bg-chart-2 text-white" : ""}
                >
                  {booking.status === "confirmed" ? "Confirmada" : "Pendiente"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Property Performance */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Rendimiento de Propiedades</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {properties.map((property) => (
              <div key={property.name} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{property.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 fill-primary text-primary" />
                    <span className="text-sm font-medium">{property.rating}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Progress value={property.occupancy} className="flex-1 h-2" />
                  <span className="text-sm text-muted-foreground w-12">{property.occupancy}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Revenue Chart Placeholder */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Ingresos Mensuales</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-end justify-between gap-2 px-4">
            {[65, 45, 80, 55, 75, 90, 70, 85, 60, 95, 80, 100].map((height, i) => (
              <div key={`revenue-${i}`} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className={`w-full rounded-t-lg transition-all ${
                    i === 11 ? "gradient-gold" : "bg-primary/20"
                  }`}
                  style={{ height: `${height}%` }}
                />
                <span className="text-xs text-muted-foreground">
                  {["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i]}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
