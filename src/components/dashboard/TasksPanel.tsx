import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function TasksPanel() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Tareas</h2>
                <Button className="gradient-gold text-primary-foreground">
                    <Plus className="w-4 h-4 mr-2" />
                    Nueva Tarea
                </Button>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Próximas Tareas</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Aquí se mostrarán las tareas de limpieza, mantenimiento y otras tareas programadas.</p>
                </CardContent>
            </Card>
        </div>
    );
}
