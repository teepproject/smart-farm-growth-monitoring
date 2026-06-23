export default async function handler(req, res) {
  const CCTV_URL =
    process.env.CCTV_ZONE_1_URL ||
    "https://string-efficiently-shaft-xbox.trycloudflare.com/cctv.jpg";

  try {
    const response = await fetch(CCTV_URL, {
      headers: {
        "ngrok-skip-browser-warning": "true",
      },
    });

    if (!response.ok) {
      return res.status(response.status).send("Failed to fetch CCTV image");
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.status(200).send(buffer);
  } catch (error) {
    console.error("CCTV proxy error:", error);
    res.status(500).send("CCTV proxy error");
  }
}