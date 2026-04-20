"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  ListTodo,
  Users,
  Home,
  Calendar,
  Loader2,
} from "lucide-react";

type Task = {
  id: string;
  property_id: string;
  property_name?: string;
  assignee_name?: string;
  assignee_avatar?: string;
  due_date: string;
  due_time?: string;
  status: string;
  priority: string;
  guest_name?: string;
  guest_count?: number;
  is_back_to_back?: boolean;
};

export default function TasksPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "in_progress" | "completed">("all");

  useEffect(() => {
    fetch("/api/cleaning-tasks")
      .then((r) => r.json())
      .then((data) => {
        setTasks(data.tasks ?? data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return tasks;
    return tasks.filter((t) => t.status === filter);
  }, [tasks, filter]);

  const today = new Date().toISOString().slice(0, 10);
  const stats = useMemo(() => {
    const pending = tasks.filter((t) => t.status === "pending").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const todayTasks = tasks.filter((t) => t.due_date === today).length;
    return { pending, inProgress, completed, todayTasks, total: tasks.length };
  }, [tasks, today]);

  const priorityColor: Record<string, string> = {
    high: "text-red-600 bg-red-50 border-red-200",
    medium: "text-amber-600 bg-amber-50 border-amber-200",
    low: "text-emerald-600 bg-emerald-50 border-emerald-200",
    normal: "text-blue-600 bg-blue-50 border-blue-200",
  };

  const statusIcon: Record<string, React.ReactNode> = {
    pending: <Clock className="h-4 w-4 text-amber-500" />,
    in_progress: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
    completed: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  };

  const statusLabel: Record<string, string> = {
    pending: "Pendiente",
    in_progress: "En Progreso",
    completed: "Completada",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Tareas</h2>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Hoy", value: stats.todayTasks, icon: Calendar, color: "text-blue-600" },
          { label: "Pendientes", value: stats.pending, icon: Clock, color: "text-amber-600" },
          { label: "En Progreso", value: stats.inProgress, icon: ListTodo, color: "text-blue-600" },
          { label: "Completadas", value: stats.completed, icon: CheckCircle2, color: "text-emerald-600" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
                  <p className="text-2xl font-black mt-1">{kpi.value}</p>
                </div>
                <kpi.icon className={`h-8 w-8 ${kpi.color} opacity-20`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {(["all", "pending", "in_progress", "completed"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
            className={filter === f ? "gradient-gold text-primary-foreground" : ""}
          >
            {f === "all" ? "Todas" : statusLabel[f]}
            {f !== "all" && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">
                {f === "pending" ? stats.pending : f === "in_progress" ? stats.inProgress : stats.completed}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Task List */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ListTodo className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No hay tareas {filter !== "all" ? `con estado "${statusLabel[filter]}"` : "registradas"}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => (
            <Card key={task.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  {/* Status icon */}
                  <div className="shrink-0">{statusIcon[task.status] ?? statusIcon.pending}</div>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Home className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-semibold truncate">
                        {task.property_name ?? "Propiedad"}
                      </span>
                      {task.is_back_to_back && (
                        <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-600">
                          Back-to-back
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(task.due_date).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
                        {task.due_time && ` · ${task.due_time.slice(0, 5)}`}
                      </span>
                      {task.guest_name && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {task.guest_name}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Assignee */}
                  <div className="shrink-0">
                    {task.assignee_name ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-bold">
                            {task.assignee_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-muted-foreground hidden md:inline">{task.assignee_name}</span>
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Sin asignar</Badge>
                    )}
                  </div>

                  {/* Priority */}
                  <Badge className={`text-[10px] shrink-0 border ${priorityColor[task.priority] ?? priorityColor.normal}`}>
                    {task.priority === "high" ? "Alta" : task.priority === "medium" ? "Media" : "Normal"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
