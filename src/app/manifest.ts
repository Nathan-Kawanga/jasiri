import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jasiri",
    short_name: "Jasiri",
    description: "Barber codes, client book and booking link.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#09090c",
    theme_color: "#09090c",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
