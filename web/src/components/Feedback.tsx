import { useState } from "react";
import { Alert, Snackbar } from "@mui/material";

export type Feedback = {
  show: (message: string, severity?: "success" | "error" | "info") => void;
  node: React.ReactNode;
};

export function useFeedback(): Feedback {
  const [snack, setSnack] = useState<{ message: string; severity: "success" | "error" | "info" } | null>(null);

  const node = (
    <Snackbar
      open={!!snack}
      autoHideDuration={4500}
      onClose={() => setSnack(null)}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      sx={{ mb: 9 }}
    >
      {snack ? (
        <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} sx={{ width: "100%" }}>
          {snack.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );

  return {
    show: (message, severity = "success") => setSnack({ message, severity }),
    node,
  };
}
