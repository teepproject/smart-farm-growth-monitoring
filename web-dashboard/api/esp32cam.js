export default async function handler(req, res) {
  try {
    const cameraUrl = process.env.VITE_ESP32_CAM_URL;

    if (!cameraUrl) {
      res.status(500).send("VITE_ESP32_CAM_URL is not configured");
      return;
    }

    const response = await fetch(cameraUrl, {
      headers: {
        "ngrok-skip-browser-warning": "true",
      },
    });

    if (!response.ok) {
      res.status(response.status).send(`Camera fetch failed: ${response.statusText}`);
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.status(200).send(buffer);
  } catch (error) {
    res.status(500).send(`ESP32-CAM proxy error: ${error.message}`);
  }
}