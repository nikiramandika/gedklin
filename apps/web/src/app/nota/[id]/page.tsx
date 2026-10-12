import { Suspense } from "react";

import { ReceiptView } from "@/components/kasir/ReceiptView";

export default function NotaPage({ params }: PageProps<"/nota/[id]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" />}>
      {params.then(({ id }) => (
        <ReceiptView id={id} />
      ))}
    </Suspense>
  );
}
