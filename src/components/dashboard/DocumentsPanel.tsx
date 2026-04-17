import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DocumentsPanel() {
    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Documentos</h2>
            <Card>
                <CardHeader>
                    <CardTitle>Gestor de Documentos</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Aquí podrás almacenar y gestionar documentos importantes como facturas, contratos y guías para huéspedes.</p>
                </CardContent>
            </Card>
        </div>
    );
}
