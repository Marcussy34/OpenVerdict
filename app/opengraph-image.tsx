import { ImageResponse } from "next/og";

// Image metadata for Open Graph cards.
export const alt = "OpenVerdict, decentralized intelligence verification engine";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

// Generated Open Graph card image.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#04122b",
          padding: "80px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 28,
              height: 28,
              backgroundColor: "#0e76ff",
              marginBottom: 24,
            }}
          />
          <div
            style={{
              display: "flex",
              fontSize: 96,
              fontWeight: 700,
              color: "#ffffff",
              lineHeight: 1.1,
              marginBottom: 16,
            }}
          >
            OpenVerdict
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 40,
              color: "#cfe0ff",
              lineHeight: 1.2,
            }}
          >
            Decentralized intelligence verification engine
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "#8fb4ff",
          }}
        >
          GonkaRouter AI juries · settled on Sui · evidence on Walrus
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
