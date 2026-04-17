import { Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export default function ReviewsPanel() {
    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Reseñas</h2>
            <Card>
                <CardHeader>
                    <CardTitle>Resumen de Reseñas</CardTitle>
                </CardHeader>
                <CardContent className="grid md:grid-cols-3 gap-6">
                    <div className="flex flex-col items-center justify-center space-y-2 p-6 bg-muted/50 rounded-lg">
                        <p className="text-5xl font-bold">4.8</p>
                        <div className="flex text-primary">
                            <Star className="w-6 h-6 fill-current" />
                            <Star className="w-6 h-6 fill-current" />
                            <Star className="w-6 h-6 fill-current" />
                            <Star className="w-6 h-6 fill-current" />
                            <Star className="w-6 h-6 fill-current opacity-50" />
                        </div>
                        <p className="text-muted-foreground">Basado en 250 reseñas</p>
                    </div>
                    <div className="col-span-2 space-y-4">
                        <div className="flex items-center gap-2">
                            <span className="w-12">5 estrellas</span>
                            <Progress value={80} className="flex-1" />
                            <span className="w-12 text-right">200</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-12">4 estrellas</span>
                            <Progress value={15} className="flex-1" />
                            <span className="w-12 text-right">38</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-12">3 estrellas</span>
                            <Progress value={3} className="flex-1" />
                            <span className="w-12 text-right">8</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-12">2 estrellas</span>
                            <Progress value={1} className="flex-1" />
                            <span className="w-12 text-right">2</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-12">1 estrella</span>
                            <Progress value={1} className="flex-1" />
                            <span className="w-12 text-right">2</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Reseñas Recientes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {[1,2,3].map(i => (
                        <div key={i} className="p-4 bg-muted/50 rounded-lg">
                            <div className="flex justify-between mb-2">
                                <p className="font-semibold">Juan Pérez - Villa Mar Azul</p>
                                <div className="flex text-primary">
                                    {[...Array(5)].map((_, j) => <Star key={j} className="w-4 h-4 fill-current" /> )}
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                "¡Estancia increíble! La villa era hermosa y la ubicación perfecta. Definitivamente volveremos. El anfitrión fue muy atento y servicial."
                            </p>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}
