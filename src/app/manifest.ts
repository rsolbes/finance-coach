import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finance Coach",
    short_name: "Coach",
    description: "Your personal finance coach",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f5",
    theme_color: "#0f7b5f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      {
        name: "Registrar pago",
        short_name: "Pago",
        description: "Subir comprobante o registrar pago de tarjeta o crédito",
        url: "/spending#payments",
        icons: [{ src: "/icon.svg", sizes: "any" }],
      },
      {
        name: "Gasto rápido",
        short_name: "Gasto",
        description: "Registrar un gasto diario",
        url: "/spending",
        icons: [{ src: "/icon.svg", sizes: "any" }],
      },
      {
        name: "Coach",
        short_name: "Coach",
        description: "Consultar con el coach financiero",
        url: "/coach",
        icons: [{ src: "/icon.svg", sizes: "any" }],
      },
    ],
  };
}
