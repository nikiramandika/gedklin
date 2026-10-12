import type { Metadata } from "next";
import { Suspense } from "react";

import { TrackingView } from "@/components/TrackingView";

export const metadata: Metadata = { title: "Status Cucian - Gedklin Laundry" };

export default function TrackingPage({ params }: PageProps<"/lacak/[code]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" />}>
      {params.then(({ code }) => (
        <TrackingView code={decodeURIComponent(code)} />
      ))}
    </Suspense>
  );
}
