import type { Metadata } from "next";
import { Suspense } from "react";

import { TrackingView } from "@/components/TrackingView";
import { Loading } from "@/components/ui";

export const metadata: Metadata = { title: "Status Cucian - Gedklin Laundry" };

export default function TrackingPage({ params }: PageProps<"/lacak/[code]">) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <Suspense fallback={<Loading />}>
        {params.then(({ code }) => (
          <TrackingView code={decodeURIComponent(code)} />
        ))}
      </Suspense>
    </main>
  );
}
