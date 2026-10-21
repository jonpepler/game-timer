"use client";

import QRCode from "qrcode";
import { useMemo } from "react";

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
  alt?: string;
}

/**
 * A QR code encoding `value`, drawn as an SVG in the current text colour
 * on a transparent ground, so it follows the theme. One path holds every
 * dark module, with a one-module quiet zone around them.
 */
export function QrCode({
  value,
  size = 160,
  className,
  alt = "QR code",
}: QrCodeProps) {
  const { path, extent } = useMemo(() => {
    const { modules } = QRCode.create(value);
    const n = modules.size;
    let d = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (modules.get(y, x)) d += `M${x + 1} ${y + 1}h1v1h-1z`;
      }
    }
    return { path: d, extent: n + 2 };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={alt}
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
