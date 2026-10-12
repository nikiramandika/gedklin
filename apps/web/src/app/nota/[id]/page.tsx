import { Suspense } from "react";

import { ReceiptView } from "@/components/kasir/ReceiptView";
import { Loading } from "@/components/ui";

export default function NotaPage({ params }: PageProps<"/nota/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      {params.then(({ id }) => (
        <ReceiptView id={id} />
      ))}
    </Suspense>
  );
}
