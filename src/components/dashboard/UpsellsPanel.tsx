"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  ShoppingCart,
  Plus,
  Clock,
  Car,
  UtensilsCrossed,
  Sparkles,
  Baby,
  DollarSign,
  TrendingUp,
  Package,
  Edit,
  Trash2,
  Copy,
  ExternalLink,
  MapPin,
  Store,
  Palmtree
} from "lucide-react";

// Mock Data Types
type CategoryInfo = "service" | "experience" | "transport" | "food" | "other";

interface UpsellProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  category: CategoryInfo;
  isGlobal: boolean;
  linkedProperties?: string[];
  active: boolean;
  sales: number;
  revenue: number;
  iconName: string;
}

const defaultUpsells: UpsellProduct[] = [
  {
    id: "1",
    name: "Check-in anticipado",
    description: "Llegada a partir de las 10:00 AM",
    price: 35,
    category: "service",
    isGlobal: false,
    linkedProperties: ["prop-1", "prop-2"],
    iconName: "Clock",
    sales: 45,
    revenue: 1575,
    active: true,
  },
  {
    id: "2",
    name: "Check-out tardio",
    description: "Salida hasta las 4:00 PM",
    price: 40,
    category: "service",
    isGlobal: false,
    iconName: "Clock",
    sales: 38,
    revenue: 1520,
    active: true,
  },
  {
    id: "3",
    name: "Traslado aeropuerto VIP",
    description: "Servicio de transporte privado en SUV",
    price: 85,
    category: "transport",
    isGlobal: true,
    iconName: "Car",
    sales: 22,
    revenue: 1870,
    active: true,
  },
  {
    id: "4",
    name: "Desayuno Local Flotante",
    description: "Bandeja flotante para la piscina (Para 2)",
    price: 65,
    category: "food",
    isGlobal: false,
    linkedProperties: ["prop-1"],
    iconName: "UtensilsCrossed",
    sales: 31,
    revenue: 2015,
    active: true,
  },
  {
    id: "5",
    name: "Tour Ruinas Mayas y Cenote",
    description: "Experiencia de medio día con guía local",
    price: 120,
    category: "experience",
    isGlobal: true,
    iconName: "Palmtree",
    sales: 18,
    revenue: 2160,
    active: true,
  },
];

const mockProperties = [
  { id: "prop-1", name: "Villa Mar y Sol" },
  { id: "prop-2", name: "Loft Centro Historico" },
  { id: "prop-3", name: "Casa de la Playa" },
];

const stats = [
  { label: "Ingresos Tienda/Extras", value: "$9,140", change: "+42%", icon: DollarSign },
  { label: "Ventas este mes", value: "154", change: "+12%", icon: ShoppingCart },
  { label: "Tasa de conversion", value: "28%", change: "+3%", icon: TrendingUp },
  { label: "Productos activos", value: "5", change: "0", icon: Package },
];

const iconsMap: Record<string, React.ElementType> = {
  Clock: Clock,
  Car: Car,
  UtensilsCrossed: UtensilsCrossed,
  Sparkles: Sparkles,
  Baby: Baby,
  Palmtree: Palmtree,
  Store: Store,
};

export default function UpsellsPanel() {
  const [upsells, setUpsells] = useState<UpsellProduct[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("stayhost_upsells");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [currentEditing, setCurrentEditing] = useState<UpsellProduct | null>(null);

  // Persist upsells to localStorage so the public Hub can read them
  useEffect(() => {
    localStorage.setItem("stayhost_upsells", JSON.stringify(upsells));
  }, [upsells]);

  // Form State
  const [formData, setFormData] = useState<Partial<UpsellProduct>>({
    name: "", description: "", price: 0, category: "service", isGlobal: true, iconName: "Sparkles", active: true
  });

  const getIconComponent = (name: string) => {
    const Icon = iconsMap[name] || Sparkles;
    return <Icon className="h-6 w-6 text-primary" />;
  };

  const handleEdit = (product: UpsellProduct) => {
    setCurrentEditing(product);
    setFormData({ ...product });
    setIsSheetOpen(true);
  };

  const handleDelete = (id: string) => {
    setUpsells(upsells.filter(u => u.id !== id));
  };

  const handleSaveProduct = () => {
    if (currentEditing) {
      setUpsells(upsells.map(u => u.id === currentEditing.id ? { ...u, ...formData } as UpsellProduct : u));
    } else {
      const newProduct: UpsellProduct = {
        ...(formData as UpsellProduct),
        id: Math.random().toString(),
        sales: 0,
        revenue: 0,
      };
      setUpsells([...upsells, newProduct]);
    }
    setIsSheetOpen(false);
  };

  const handleAddNew = () => {
    setCurrentEditing(null);
    setFormData({
      name: "", description: "", price: 0, category: "service", isGlobal: true, iconName: "Sparkles", active: true
    });
    setIsSheetOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Marketplace y Ventas Extras</h2>
          <p className="text-muted-foreground">Configura tu Host Hub para vender tours, transporte y servicios extra a tus huéspedes.</p>
        </div>
      </div>

      <Tabs defaultValue="inventory" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-[400px]">
          <TabsTrigger value="inventory">Inventario de Servicios</TabsTrigger>
          <TabsTrigger value="hub-config">Configuración Host Hub</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-6 mt-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

          <div className="flex justify-between items-center flex-wrap gap-4">
            <h3 className="text-lg font-semibold">Tus Productos y Experiencias</h3>
            <Button onClick={handleAddNew} className="gradient-gold text-primary-foreground gap-2">
              <Plus className="h-4 w-4" />
              Nuevo producto
            </Button>
          </div>

          {/* Products Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upsells.map((upsell) => (
              <Card key={upsell.id} className={`relative transition-all hover:shadow-md ${!upsell.active && "opacity-60"}`}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-3 rounded-xl bg-primary/10">
                      {getIconComponent(upsell.iconName)}
                    </div>
                    <Badge variant={upsell.active ? "default" : "secondary"} className={upsell.active ? "bg-chart-2" : ""}>
                      {upsell.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>

                  <h3 className="font-semibold text-lg line-clamp-1" title={upsell.name}>{upsell.name}</h3>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2 min-h-[40px]">{upsell.description}</p>

                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-2xl font-bold">${upsell.price}</span>
                      <span className="text-muted-foreground text-sm"> / unidad</span>
                    </div>
                  </div>

                  <div className="flex gap-2 mb-4">
                    {upsell.isGlobal ? (
                      <Badge variant="outline" className="text-xs bg-muted/50 border-primary/20 text-primary">
                        <Store className="h-3 w-3 mr-1" /> Venta Global
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs bg-muted/50">
                        <MapPin className="h-3 w-3 mr-1" /> Vinculado a Reserva
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs uppercase">{upsell.category}</Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                    <div>
                      <p className="text-sm text-muted-foreground">Ventas</p>
                      <p className="font-semibold">{upsell.sales}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Generado</p>
                      <p className="font-semibold text-chart-2">${upsell.revenue}</p>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4 pt-4 border-t">
                    <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => handleEdit(upsell)}>
                      <Edit className="h-4 w-4 text-muted-foreground" />
                      Editar
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive hover:text-white" onClick={() => handleDelete(upsell.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Add New Visual Card */}
            <Card onClick={handleAddNew} className="border-dashed cursor-pointer hover:border-primary hover:bg-primary/5 transition-all">
              <CardContent className="p-6 flex flex-col items-center justify-center h-full min-h-[350px]">
                <div className="p-4 rounded-full bg-primary/10 mb-4 transition-transform hover:scale-110">
                  <Plus className="h-8 w-8 text-primary" />
                </div>
                <p className="font-medium text-foreground">Agregar nueva experiencia</p>
                <p className="text-sm text-muted-foreground text-center mt-2 px-4">
                  Crea tours, traslados o servicios para venderlos en tu Hub.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="hub-config" className="mt-6">
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle>Configuración de tu Host Hub</CardTitle>
              <CardDescription>
                Personaliza la página pública donde tus huéspedes podrán comprar tus experiencias y servicios independientemente de Airbnb.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              
              <div className="p-4 border rounded-xl bg-muted/30 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex-1 overflow-hidden">
                  <Label>Enlace Público (URL Compartible)</Label>
                  <p className="text-sm font-mono text-primary flex items-center bg-background border rounded-md p-2 mt-2 w-full truncate">
                    https://stayhost.com/hub/luna-rentals
                  </p>
                </div>
                <div className="flex gap-2 md:mt-6 shrink-0">
                  <Button variant="outline"><Copy className="h-4 w-4 mr-2" /> Copiar</Button>
                  <Button><ExternalLink className="h-4 w-4 mr-2" /> Visitar</Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Nombre del Hub / Marca</Label>
                  <Input defaultValue="Luna Vacations Rentals" />
                </div>
                <div className="space-y-2">
                  <Label>Mensaje de Bienvenida al Huésped</Label>
                  <textarea 
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" 
                    defaultValue="Mejora tu estadía con nuestras actividades locales recomendadas y curadas por nosotros."
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="bg-muted/30 py-4 border-t">
              <Button className="ml-auto gradient-gold">Guardar Configuración</Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Editor Modal / Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle>{currentEditing ? "Editar Producto" : "Nuevo Producto"}</SheetTitle>
            <SheetDescription>
              Configura los detalles de esta experiencia o servicio adicional.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre del Producto</Label>
              <Input 
                id="name" 
                value={formData.name} 
                onChange={(e) => setFormData({...formData, name: e.target.value})} 
                placeholder="Ej: Desayuno Buffet" 
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="desc">Descripción Breve</Label>
              <textarea 
                id="desc"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" 
                rows={3}
                value={formData.description} 
                onChange={(e) => setFormData({...formData, description: e.target.value})} 
                placeholder="Detalla qué incluye este servicio..." 
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">Precio (USD)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    type="number"
                    id="price" 
                    className="pl-8"
                    value={formData.price} 
                    onChange={(e) => setFormData({...formData, price: Number(e.target.value)})} 
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Categoría</Label>
                <Select value={formData.category} onValueChange={(val: CategoryInfo) => setFormData({...formData, category: val})}>
                  <SelectTrigger>
                    <SelectValue placeholder="Categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">🔧 Servicio (Ej. Limpieza)</SelectItem>
                    <SelectItem value="experience">🌴 Experiencia (Ej. Tour)</SelectItem>
                    <SelectItem value="food">🍽️ Gastronomía</SelectItem>
                    <SelectItem value="transport">🚗 Transporte</SelectItem>
                    <SelectItem value="other">📦 Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Icono / Visual</Label>
              <Select value={formData.iconName} onValueChange={(val) => setFormData({...formData, iconName: val})}>
                <SelectTrigger>
                  <SelectValue placeholder="Icono Principal" />
                </SelectTrigger>
                <SelectContent className="grid grid-cols-2">
                  {Object.keys(iconsMap).map((iconKey) => (
                    <SelectItem key={iconKey} value={iconKey}>{iconKey}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4 p-4 border rounded-xl bg-muted/20">
              <h4 className="font-medium text-sm text-foreground">Disponibilidad de Venta</h4>
              <div className="flex flex-col space-y-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-2 rounded-md">
                  <input 
                    type="radio" 
                    name="isGlobal" 
                    checked={formData.isGlobal === true} 
                    onChange={() => setFormData({...formData, isGlobal: true})}
                    className="h-4 w-4 text-primary"
                  />
                  <span>
                    <strong className="block font-medium">✨ Venta Global (Host Hub)</strong>
                    <span className="text-muted-foreground text-xs block">Se vende de forma suelta en tu perfil, sin depender de que hayan reservado.</span>
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-2 rounded-md">
                  <input 
                    type="radio" 
                    name="isGlobal" 
                    checked={formData.isGlobal === false} 
                    onChange={() => setFormData({...formData, isGlobal: false})}
                    className="h-4 w-4 text-primary"
                  />
                  <span>
                    <strong className="block font-medium">🏠 Vinculado a Propiedad Especial</strong>
                    <span className="text-muted-foreground text-xs block">Solo se ofrece al pagar reservas de ciertas propiedades (Ej: Early Checkin).</span>
                  </span>
                </label>
              </div>

              {!formData.isGlobal && (
                <div className="mt-4 space-y-2 pt-4 border-t border-border">
                  <Label>Aplica a estas propiedades:</Label>
                  <div className="space-y-2 max-h-[150px] overflow-y-auto">
                    {mockProperties.map(prop => (
                      <label key={prop.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="rounded border-gray-300" defaultChecked />
                        {prop.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 pt-2">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-sm">
                  <input 
                    type="checkbox" 
                    checked={formData.active} 
                    onChange={(e) => setFormData({...formData, active: e.target.checked})}
                    className="h-4 w-4 rounded text-primary"
                  />
                  Activar Producto al Guardar
                </label>
            </div>
          </div>

          <SheetFooter className="mt-8 gap-2 sm:gap-0">
            <SheetClose asChild>
              <Button variant="outline">Cancelar</Button>
            </SheetClose>
            <Button onClick={handleSaveProduct} className="gradient-gold">Guardar Cambios</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

    </div>
  );
}
