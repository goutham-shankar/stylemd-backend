"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

export default function StyleguideRunPage() {
  const params = useParams();
  const runId = typeof params?.runId === "string" ? params.runId : "";
  const [isLoading, setIsLoading] = useState(true);

  const handleDownload = async () => {
    if (!runId) return;
    try {
      const response = await fetch(`/api/stylemd/download-styleguide-v2?runId=${encodeURIComponent(runId)}`);
      if (!response.ok) {
        alert("Failed to download styleguide");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `styleguide-${runId}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
      alert("Error downloading styleguide");
    }
  };

  if (!runId) {
    return (
      <main style={{ width: "100vw", height: "100vh", margin: 0, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0f1a", color: "#e8f4ff" }}>
        <div>Loading...</div>
      </main>
    );
  }

  const showcaseSrc = `/styleguide-files/${encodeURIComponent(runId)}/styleguide/showcase.html`;

  return (
    <main style={{ width: "100vw", height: "100vh", margin: 0, padding: 0, display: "flex", flexDirection: "column", background: "#0a0f1a" }}>
      <div
        style={{
          padding: "12px 20px",
          background: "linear-gradient(135deg, rgba(15, 20, 40, 0.95), rgba(10, 25, 50, 0.95))",
          borderBottom: "1px solid rgba(100, 160, 255, 0.25)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <button
          onClick={handleDownload}
          style={{
            padding: "10px 16px",
            background: "linear-gradient(135deg, #00d9ff, #0099cc)",
            color: "#000",
            border: "none",
            borderRadius: "8px",
            font: "700 13px sans-serif",
            cursor: "pointer",
            transition: "all 200ms ease",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = "0 6px 20px rgba(0, 217, 255, 0.4)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          📥 Download HTML
        </button>
        <span style={{ color: "#a8d0ff", fontSize: "12px", marginLeft: "auto" }}>
          Generated with KIMI AI
        </span>
      </div>
      <iframe
        title={`styleguide-${runId}`}
        src={showcaseSrc}
        style={{ flex: 1, border: "none", display: "block" }}
        sandbox="allow-same-origin"
        onLoad={() => setIsLoading(false)}
      />
    </main>
  );
}
