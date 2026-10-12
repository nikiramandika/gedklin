/** Tanda Gedklin yang sama dengan BrandMark, digambar ulang untuk satori. */
export function Mark({ size, maskable }: { size: number; maskable: boolean }) {
  // Maskable: latar penuh tanpa sudut, isi di zona aman 80%.
  const scale = maskable ? 0.72 : 1;
  const inner = size * scale;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#2450e6",
        borderRadius: maskable ? 0 : size * 0.22,
      }}
    >
      <svg width={inner} height={inner} viewBox="0 0 32 32">
        <circle cx="16" cy="17" r="9" fill="#ffffff" />
        <circle cx="16" cy="17" r="6.25" fill="#dce6fe" />
        <path
          d="M10.6 18.2c1.8-1.7 3.6-1.7 5.4 0s3.6 1.7 5.4 0"
          stroke="#2450e6"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="9" cy="6.5" r="1.25" fill="#ffffff" />
        <circle cx="12.75" cy="6.5" r="1.25" fill="#ffffff" fillOpacity="0.6" />
      </svg>
    </div>
  );
}
