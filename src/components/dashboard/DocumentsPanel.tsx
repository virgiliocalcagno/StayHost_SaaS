"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FileText,
  Search,
  FolderOpen,
  File,
  FileImage,
  FileSpreadsheet,
  Upload,
  Filter,
} from "lucide-react";

type DocCategory = "contratos" | "facturas" | "guias" | "legal" | "otros";

type Document = {
  id: string;
  name: string;
  category: DocCategory;
  size: string;
  updatedAt: string;
  type: "pdf" | "image" | "spreadsheet" | "doc";
};

// Documents: feature en construcción (Supabase Storage pendiente).
// Vacío hasta tener flujo real de upload/listado por tenant.
const SAMPLE_DOCS: Document[] = [];

const categoryLabels: Record<DocCategory, string> = {
  contratos: "Contratos",
  facturas: "Facturas",
  guias: "Guías",
  legal: "Legal",
  otros: "Otros",
};

const categoryColors: Record<DocCategory, string> = {
  contratos: "bg-blue-50 text-blue-700 border-blue-200",
  facturas: "bg-emerald-50 text-emerald-700 border-emerald-200",
  guias: "bg-purple-50 text-purple-700 border-purple-200",
  legal: "bg-amber-50 text-amber-700 border-amber-200",
  otros: "bg-slate-50 text-slate-700 border-slate-200",
};

const typeIcon: Record<string, React.ReactNode> = {
  pdf: <FileText className="h-5 w-5 text-red-500" />,
  image: <FileImage className="h-5 w-5 text-purple-500" />,
  spreadsheet: <FileSpreadsheet className="h-5 w-5 text-emerald-500" />,
  doc: <File className="h-5 w-5 text-blue-500" />,
};

export default function DocumentsPanel() {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState<DocCategory | "all">("all");
  const [docs] = useState<Document[]>(SAMPLE_DOCS);

  const filtered = useMemo(() => {
    return docs.filter((d) => {
      const matchSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCategory = activeCategory === "all" || d.category === activeCategory;
      return matchSearch && matchCategory;
    });
  }, [docs, searchTerm, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of docs) {
      counts[d.category] = (counts[d.category] ?? 0) + 1;
    }
    return counts;
  }, [docs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Documentos</h2>
        <Button className="gradient-gold text-primary-foreground" disabled>
          <Upload className="w-4 h-4 mr-2" />
          Subir Documento
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(["contratos", "facturas", "guias", "legal", "otros"] as DocCategory[]).map((cat) => (
          <Card
            key={cat}
            className={`cursor-pointer transition-all ${activeCategory === cat ? "ring-2 ring-primary" : "hover:shadow-md"}`}
            onClick={() => setActiveCategory(activeCategory === cat ? "all" : cat)}
          >
            <CardContent className="pt-3 pb-2 px-3 text-center">
              <FolderOpen className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="text-xs font-semibold">{categoryLabels[cat]}</p>
              <p className="text-lg font-black">{categoryCounts[cat] ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar documentos..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Document List */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No se encontraron documentos</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((doc) => (
            <Card key={doc.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  <div className="shrink-0">{typeIcon[doc.type]}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {doc.size} · Actualizado {new Date(doc.updatedAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <Badge className={`text-[10px] border shrink-0 ${categoryColors[doc.category]}`}>
                    {categoryLabels[doc.category]}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Info Banner */}
      <Card className="border-dashed border-2">
        <CardContent className="py-4 px-4 text-center">
          <Upload className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm font-semibold text-muted-foreground">Próximamente: Subida de archivos</p>
          <p className="text-xs text-muted-foreground mt-1">
            Podrás subir contratos, facturas y guías directamente a Supabase Storage.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
