import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AccountsPanel() {
    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Cuentas y Listados</h2>
            <Card>
                <CardHeader>
                    <CardTitle>Gestionar Cuentas</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Aquí podrás conectar y gestionar tus cuentas de Airbnb, Booking.com, VRBO y otros canales.</p>
                </CardContent>
            </Card>
        </div>
    );
}
