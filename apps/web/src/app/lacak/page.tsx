import type { Metadata } from "next";

import { TrackingLanding } from "@/components/TrackingLanding";

export const metadata: Metadata = { title: "Lacak Cucian - Gedklin Laundry" };

export default function LacakPage() {
  return <TrackingLanding />;
}
