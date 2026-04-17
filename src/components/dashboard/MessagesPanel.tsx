"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Sparkles, Search, MoreVertical } from "lucide-react";
import { useState } from "react";

const conversations = [
  {
    id: 1,
    guest: "Maria Lopez",
    property: "Villa Mar Azul",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=50&h=50&fit=crop",
    lastMessage: "Perfecto, gracias por la informacion!",
    time: "Hace 5 min",
    unread: 2,
    platform: "Airbnb",
  },
  {
    id: 2,
    guest: "Carlos Mendez",
    property: "Apartamento Centro",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=50&h=50&fit=crop",
    lastMessage: "A que hora es el check-in?",
    time: "Hace 1 hora",
    unread: 1,
    platform: "Booking",
  },
  {
    id: 3,
    guest: "Ana Rodriguez",
    property: "Casa de Playa",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=50&h=50&fit=crop",
    lastMessage: "Pueden agregar una cuna?",
    time: "Hace 3 horas",
    unread: 0,
    platform: "VRBO",
  },
];

const messages = [
  { id: 1, sender: "guest", text: "Hola! Acabo de hacer una reserva para la proxima semana.", time: "10:30 AM" },
  { id: 2, sender: "host", text: "Hola Maria! Bienvenida, estamos muy emocionados de recibirte en Villa Mar Azul.", time: "10:32 AM" },
  { id: 3, sender: "guest", text: "Gracias! Tengo una pregunta - hay estacionamiento disponible?", time: "10:35 AM" },
  { id: 4, sender: "host", text: "Si, tenemos estacionamiento privado gratuito para 2 vehiculos dentro de la propiedad.", time: "10:36 AM", ai: true },
  { id: 5, sender: "guest", text: "Perfecto, gracias por la informacion!", time: "10:40 AM" },
];

export default function MessagesPanel() {
  const [selectedConversation, setSelectedConversation] = useState(conversations[0]);
  const [newMessage, setNewMessage] = useState("");

  return (
    <div className="h-[calc(100vh-8rem)]">
      <div className="grid md:grid-cols-[350px_1fr] gap-6 h-full">
        {/* Conversations List */}
        <Card className="flex flex-col">
          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar conversaciones..." className="pl-9" />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedConversation.id === conv.id ? "bg-primary/10" : "hover:bg-muted"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <Avatar>
                        <AvatarImage src={conv.avatar} />
                        <AvatarFallback>{conv.guest.charAt(0)}</AvatarFallback>
                      </Avatar>
                      {conv.unread > 0 && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                          <span className="text-xs text-primary-foreground font-medium">{conv.unread}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium truncate">{conv.guest}</p>
                        <span className="text-xs text-muted-foreground shrink-0">{conv.time}</span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{conv.property}</p>
                      <p className="text-sm truncate mt-1">{conv.lastMessage}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 ml-12">
                    <Badge variant="secondary" className="text-xs">{conv.platform}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>

        {/* Chat Area */}
        <Card className="flex flex-col">
          {/* Chat Header */}
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarImage src={selectedConversation.avatar} />
                <AvatarFallback>{selectedConversation.guest.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{selectedConversation.guest}</p>
                <p className="text-sm text-muted-foreground">{selectedConversation.property}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon">
              <MoreVertical className="h-5 w-5" />
            </Button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === "host" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`max-w-[70%] ${msg.sender === "host" ? "order-2" : ""}`}>
                    <div
                      className={`p-3 rounded-2xl ${
                        msg.sender === "host"
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-muted rounded-bl-md"
                      }`}
                    >
                      {msg.ai && (
                        <div className="flex items-center gap-1 text-xs opacity-80 mb-1">
                          <Sparkles className="h-3 w-3" />
                          Respuesta IA
                        </div>
                      )}
                      <p className="text-sm">{msg.text}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 px-1">{msg.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="p-4 border-t">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="shrink-0">
                <Sparkles className="h-4 w-4 text-primary" />
              </Button>
              <Input
                placeholder="Escribe un mensaje..."
                value={newMessage}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewMessage(e.target.value)}
                className="flex-1"
              />
              <Button className="gradient-gold text-primary-foreground shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Presiona el boton de IA para generar una respuesta automatica
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
