const fs = require('fs');

const content = fs.readFileSync('src/app/staff/page.tsx', 'utf8');
const lines = content.split('\n');
const top = lines.slice(0, 531);
const bottom = lines.slice(1061);

const replacement = `  // ─── SCREEN: TASK DETAIL (pending/assigned/accepted/issue) ───────────────
  if (["pending", "assigned", "accepted", "issue"].includes(currentActiveTask.status)) {
    return (
      <StaffTaskDetail
        task={currentActiveTask as any}
        bedConfiguration={currentProperty?.bedConfiguration}
        onClose={() => setScreen("home")}
        onAccept={handleAcceptTask}
        onDecline={(taskId, reason) => {
          handleDeclineTask(taskId, reason);
          setScreen("home");
        }}
        onStartCleaning={handleStartCleaning}
      />
    );
  }

  // ─── SCREEN: WIZARD (in_progress — steps 1, 2, 3) ────────────────────────
  return (
    <StaffWizard
      task={currentActiveTask as any}
      activeCriteria={activeCriteria}
      onClose={() => setScreen("home")}
      onToggleChecklist={toggleChecklistItem}
      onSubmit={(taskId, photos, notes) => {
        setTasks(prev =>
          prev.map(t =>
            t.id === taskId
              ? { 
                  ...t, 
                  status: "completed", 
                  isWaitingValidation: true, 
                  closurePhotos: photos,
                  incidentReport: notes 
                }
              : t
          )
        );
        setScreen("home");
        setActiveTaskId(null);
        setWizardStep(1);
        setTempPhotos([]);
      }}
    />
  );`;

fs.writeFileSync('src/app/staff/page.tsx', top.join('\n') + '\n' + replacement + '\n' + bottom.join('\n'));
console.log('Reemplazo quirúrgico completado exitosamente.');
