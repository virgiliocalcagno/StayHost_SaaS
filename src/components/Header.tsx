"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Menu, Home, Star } from "lucide-react";

type NavItemWithSubmenu = {
  label: string;
  items: { label: string; href: string }[];
};

type NavItemSimple = {
  label: string;
  href: string;
};

type NavItem = NavItemWithSubmenu | NavItemSimple;

const navItems: NavItem[] = [
  {
    label: "Funciones",
    items: [
      { label: "Channel Manager", href: "#features" },
      { label: "Mensajes Automatizados", href: "#features" },
      { label: "Precios Dinamicos", href: "#features" },
      { label: "Gestion de Limpieza", href: "#features" },
    ],
  },
  {
    label: "Soluciones",
    items: [
      { label: "Propietarios", href: "#solutions" },
      { label: "Gestores de Propiedades", href: "#solutions" },
      { label: "Empresas", href: "#solutions" },
    ],
  },
  { label: "Precios", href: "#pricing" },
  { label: "Recursos", href: "#resources" },
];

const hasSubmenu = (item: NavItem): item is NavItemWithSubmenu => "items" in item;

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-gold">
            <Home className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold text-foreground">
            Stay<span className="text-primary">Host</span>
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) =>
            hasSubmenu(item) ? (
              <DropdownMenu key={item.label}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    {item.label}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {item.items.map((subItem) => (
                    <DropdownMenuItem key={subItem.label} asChild>
                      <Link href={subItem.href}>{subItem.label}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                key={item.label}
                variant="ghost"
                asChild
                className="text-muted-foreground hover:text-foreground"
              >
                <Link href={item.href}>{item.label}</Link>
              </Button>
            )
          )}
        </nav>

        {/* CTA Buttons */}
        <div className="hidden md:flex items-center gap-3">
          <Button variant="ghost" asChild>
            <Link href="/acceso">Iniciar Sesion</Link>
          </Button>
          <Button asChild className="gradient-gold text-primary-foreground hover:opacity-90 transition-opacity">
            <Link href="/acceso">
              <Star className="h-4 w-4 mr-2" />
              Prueba Gratis 14 Dias
            </Link>
          </Button>
        </div>

        {/* Mobile Menu */}
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80">
            <div className="flex flex-col gap-4 mt-8">
              {navItems.map((item) =>
                hasSubmenu(item) ? (
                  <div key={item.label} className="space-y-2">
                    <span className="font-medium text-foreground">{item.label}</span>
                    <div className="flex flex-col gap-1 pl-4">
                      {item.items.map((subItem) => (
                        <Link
                          key={subItem.label}
                          href={subItem.href}
                          className="text-muted-foreground hover:text-foreground py-1"
                          onClick={() => setIsOpen(false)}
                        >
                          {subItem.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="font-medium text-foreground"
                    onClick={() => setIsOpen(false)}
                  >
                    {item.label}
                  </Link>
                )
              )}
              <div className="flex flex-col gap-2 pt-4 border-t">
                <Button variant="outline" asChild>
                  <Link href="/acceso">Iniciar Sesion</Link>
                </Button>
                <Button asChild className="gradient-gold text-primary-foreground">
                  <Link href="/acceso">Prueba Gratis</Link>
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
