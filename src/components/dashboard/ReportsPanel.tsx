import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReportsPanel() {
    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Reportes</h2>
            <Card>
                <CardHeader>
                    <CardTitle>Reportes Financieros y de Rendimiento</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Aquí podrás generar y visualizar reportes detallados sobre tus ingresos, ocupación, y rendimiento general.</p>
                </CardContent>
            </Card>
        </div>
    );
}
