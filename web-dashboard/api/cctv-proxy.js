export default async function handler(req, res) {
  const CCTV_URL =
    process.env.CCTV_ZONE_1_URL ||
    "https://credible-ceremony-species.ngrok-free.dev/cctv.jpg";

  try {
    const response = await fetch(CCTV_URL, {
      headers: {
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "Mozilla/5.0",
      },
    });

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return res
        .status(response.status)
        .send(
          `Failed to fetch CCTV image. Status: ${response.status}. Content-Type: ${contentType}. Body: ${text.slice(
            0,
            300
          )}`
        );
    }

    if (!contentType.includes("image")) {
      const text = await response.text().catch(() => "");
      return res
        .status(502)
        .send(
          `CCTV URL did not return an image. Content-Type: ${contentType}. Body: ${text.slice(
            0,
            300
          )}`
        );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.status(200).send(buffer);
  } catch (error) {
    console.error("CCTV proxy error:", error);
    res.status(500).send(`CCTV proxy error: ${error.message}`);
  }
}