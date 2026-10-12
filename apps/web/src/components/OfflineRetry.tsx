"use client";

import { IconRefresh } from "./icons";
import { Button } from "./ui";

export function OfflineRetry() {
  return (
    <Button size="lg" className="mt-5 w-full" onClick={() => window.location.reload()}>
      <IconRefresh size={18} />
      Coba lagi
    </Button>
  );
}
