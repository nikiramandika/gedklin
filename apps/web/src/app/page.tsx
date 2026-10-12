import type { Metadata } from "next";

import { StaffLoginLink, TrackingLanding } from "@/components/TrackingLanding";

export const metadata: Metadata = { manifest: "/lacak.webmanifest" };

export default function Home() {
  return <TrackingLanding footer={<StaffLoginLink />} />;
}
