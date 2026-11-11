"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function StateToast({
  message,
  kind = "error",
  id,
}: {
  message: string;
  kind?: "error" | "success" | "info";
  id: string;
}) {
  useEffect(() => {
    if (message) toast[kind](message, { id });
    else toast.dismiss(id);
  }, [id, kind, message]);

  return null;
}
