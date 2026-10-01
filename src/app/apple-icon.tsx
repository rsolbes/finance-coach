import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Home-screen icon for iPhone (iOS needs a PNG).
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0f7b5f" }}>
        <svg viewBox="0 0 64 64" width="180" height="180">
          <path
            d="M16 42l10-10 8 6 14-16"
            fill="none"
            stroke="#fff"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="48" cy="22" r="4" fill="#fff" />
        </svg>
      </div>
    ),
    size,
  );
}
