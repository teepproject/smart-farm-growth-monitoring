export default async function handler(req, res) {
  try {
    const cameraUrl = process.env.VITE_ESP32_CAM_URL;

    if (!cameraUrl) {
      res.status(500).send("VITE_ESP32_CAM_URL is not configured");
      return;
    }

    async function fetchCameraImage(url) {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "ngrok-skip-browser-warning": "true",
          "User-Agent": "Mozilla/5.0 SmartFarmDashboard",
        },
      });

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("image")) {
        const arrayBuffer = await response.arrayBuffer();
        return {
          ok: true,
          buffer: Buffer.from(arrayBuffer),
          contentType,
        };
      }

      const text = await response.text();

      const redirectMatch = text.match(/url=([^'">]+)/i);

      if (redirectMatch && redirectMatch[1]) {
        let redirectUrl = redirectMatch[1].replaceAll("&amp;", "&");

        if (redirectUrl.startsWith("http://")) {
          redirectUrl = redirectUrl.replace("http://", "https://");
        }

        const redirectedResponse = await fetch(redirectUrl, {
          redirect: "follow",
          headers: {
            "ngrok-skip-browser-warning": "true",
            "User-Agent": "Mozilla/5.0 SmartFarmDashboard",
          },
        });

        const redirectedContentType =
          redirectedResponse.headers.get("content-type") || "";

        if (redirectedContentType.includes("image")) {
          const arrayBuffer = await redirectedResponse.arrayBuffer();
          return {
            ok: true,
            buffer: Buffer.from(arrayBuffer),
            contentType: redirectedContentType,
          };
        }

        const redirectedText = await redirectedResponse.text();

        return {
          ok: false,
          message: `Redirect response is not image. Content-Type: ${redirectedContentType}. Body: ${redirectedText.slice(
            0,
            200
          )}`,
        };
      }

      return {
        ok: false,
        message: `Camera response is not image. Content-Type: ${contentType}. Body: ${text.slice(
          0,
          200
        )}`,
      };
    }

    const result = await fetchCameraImage(cameraUrl);

    if (!result.ok) {
      res.status(502).send(result.message);
      return;
    }

    res.setHeader("Content-Type", result.contentType || "image/jpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.status(200).send(result.buffer);
  } catch (error) {
    res.status(500).send(`ESP32-CAM proxy error: ${error.message}`);
  }
}