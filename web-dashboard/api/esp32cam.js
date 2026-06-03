export default async function handler(req, res) {
  try {
    const cameraUrl = process.env.VITE_ESP32_CAM_URL;

    if (!cameraUrl) {
      res.status(500).send("VITE_ESP32_CAM_URL is not configured");
      return;
    }

    const response = await fetch(cameraUrl, {
      redirect: "follow",
      headers: {
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "Mozilla/5.0 SmartFarmDashboard",
      },
    });

    const contentType = response.headers.get("content-type") || "";

    if (response.ok && contentType.includes("image")) {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.status(200).send(buffer);
      return;
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

      if (redirectedResponse.ok && redirectedContentType.includes("image")) {
        const arrayBuffer = await redirectedResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader("Content-Type", redirectedContentType);
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.status(200).send(buffer);
        return;
      }

      const redirectedText = await redirectedResponse.text();

      res
        .status(502)
        .send(
          `Redirect response is not image. Status: ${redirectedResponse.status}. Content-Type: ${redirectedContentType}. Body: ${redirectedText.slice(
            0,
            300
          )}`
        );
      return;
    }

    res
      .status(502)
      .send(
        `Camera response is not image. Status: ${response.status}. Content-Type: ${contentType}. Body: ${text.slice(
          0,
          300
        )}`
      );
  } catch (error) {
    res.status(500).send(`ESP32-CAM proxy error: ${error.message}`);
  }
}