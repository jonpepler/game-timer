"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
  alt?: string;
}

// Renders a QR encoding `value` as an <img> data URL. Re-encodes when
// the value changes. Tiny payload (typical companion URL is ~80 chars
// → a sub-1KB PNG).
export function QrCode({
  value,
  size = 160,
  className,
  alt = "QR code",
}: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      // Dark-themed: invert colours so the QR sits on the surface and
      // stays high-contrast under the app's dark palette.
      color: { dark: "#ffffff", light: "#00000000" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        aria-busy="true"
      />
    );
  }
  return (
    <img
      src={dataUrl}
      alt={alt}
      width={size}
      height={size}
      className={className}
    />
  );
}
