import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function KeysPanel() {
    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Llaves</h2>
            <Card>
                <CardHeader>
                    <CardTitle>Gestión de Llaves</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Aquí podrás gestionar el estado y la asignación de llaves físicas o digitales para tus propiedades.</p>
                </CardContent>
            </Card>
        </div>
    );
}
