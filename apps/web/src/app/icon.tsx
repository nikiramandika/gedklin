import { ImageResponse } from "next/og";

import { Mark } from "@/lib/brand-icon";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<Mark size={32} maskable={false} />, size);
}
