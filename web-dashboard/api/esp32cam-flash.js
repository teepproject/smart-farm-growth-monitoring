export default async function handler(req, res) {
  try {
    const cameraUrl = process.env.VITE_ESP32_CAM_URL;
    const state = String(req.query.state || "").toLowerCase();

    if (!cameraUrl) {
      res.status(500).json({
        success: false,
        message: "VITE_ESP32_CAM_URL is not configured",
      });
      return;
    }

    if (state !== "on" && state !== "off") {
      res.status(400).json({
        success: false,
        message: "Invalid flash state. Use state=on or state=off",
      });
      return;
    }

    const url = new URL(cameraUrl);

    // Dari:
    // https://xxxx.ngrok-free.dev/jpg
    // Menjadi:
    // https://xxxx.ngrok-free.dev/flash/on
    // atau:
    // https://xxxx.ngrok-free.dev/flash/off
    url.pathname = `/flash/${state}`;
    url.search = "";

    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "Mozilla/5.0 SmartFarmDashboard",
      },
    });

    const text = await response.text();

    if (!response.ok) {
      res.status(502).json({
        success: false,
        message: `ESP32-CAM flash request failed. Status: ${response.status}`,
        response: text,
      });
      return;
    }

    res.status(200).json({
      success: true,
      state,
      message: `ESP32-CAM flash ${state.toUpperCase()} sent successfully`,
      response: text,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `ESP32-CAM flash proxy error: ${error.message}`,
    });
  }
}