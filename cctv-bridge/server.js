const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const app = express();
const PORT = 5001;

// CCTV RTSP URL yang sudah berhasil di VLC
const CCTV_RTSP_URL = "rtsp://192.168.0.237:554/Streaming/Channels/101";

// ESP32-CAM IP dari Serial Monitor terbaru
const ESP32_CAM_BASE_URL = "http://192.168.0.148";

app.use(cors());

app.get("/", (req, res) => {
  res.send(`
    <h2>Smart Farm Camera Bridge is running</h2>

    <h3>CCTV Zone 1</h3>
    <p>Snapshot: <a href="/cctv.jpg">/cctv.jpg</a></p>
    <p>Realtime MJPEG: <a href="/cctv.mjpeg">/cctv.mjpeg</a></p>

    <h3>ESP32-CAM</h3>
    <p>Live JPG: <a href="/esp32cam.jpg">/esp32cam.jpg</a></p>
    <p>Latest Photo: <a href="/esp32cam/latest.jpg">/esp32cam/latest.jpg</a></p>
    <p>Flash ON: <a href="/esp32cam/flash/on">/esp32cam/flash/on</a></p>
    <p>Flash OFF: <a href="/esp32cam/flash/off">/esp32cam/flash/off</a></p>
    <p>Work ON: <a href="/esp32cam/work/on">/esp32cam/work/on</a></p>
    <p>Work OFF: <a href="/esp32cam/work/off">/esp32cam/work/off</a></p>
    <p>Status: <a href="/esp32cam/status">/esp32cam/status</a></p>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    bridge: "Smart Farm Camera Bridge",
    cctv: {
      name: "CCTV Zone 1",
      rtsp: CCTV_RTSP_URL,
      snapshot: `http://localhost:${PORT}/cctv.jpg`,
      mjpeg: `http://localhost:${PORT}/cctv.mjpeg`,
    },
    esp32cam: {
      baseUrl: ESP32_CAM_BASE_URL,
      liveJpg: `http://localhost:${PORT}/esp32cam.jpg`,
      latestPhoto: `http://localhost:${PORT}/esp32cam/latest.jpg`,
      status: `http://localhost:${PORT}/esp32cam/status`,
    },
  });
});

// =========================
// CCTV ZONE 1
// =========================

// Ambil 1 gambar JPG dari CCTV
app.get("/cctv.jpg", (req, res) => {
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const ffmpeg = spawn(ffmpegPath, [
    "-rtsp_transport", "tcp",
    "-i", CCTV_RTSP_URL,
    "-frames:v", "1",
    "-vf", "scale=640:-1",
    "-q:v", "8",
    "-f", "image2pipe",
    "-vcodec", "mjpeg",
    "pipe:1",
  ]);

  ffmpeg.stdout.pipe(res);

  ffmpeg.stderr.on("data", (data) => {
    console.error(data.toString());
  });

  ffmpeg.on("error", (err) => {
    console.error("FFmpeg error:", err);
    if (!res.headersSent) {
      res.status(500).send("Failed to capture CCTV image");
    }
  });
});

// Stream realtime MJPEG untuk browser
app.get("/cctv.mjpeg", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Connection: "close",
    Pragma: "no-cache",
    Expires: "0",
  });

  const ffmpeg = spawn(ffmpegPath, [
    "-rtsp_transport", "tcp",
    "-i", CCTV_RTSP_URL,
    "-an",
    "-r", "8",
    "-vf", "scale=640:-1",
    "-q:v", "8",
    "-f", "mpjpeg",
    "-boundary_tag", "frame",
    "pipe:1",
  ]);

  ffmpeg.stdout.pipe(res);

  ffmpeg.stderr.on("data", (data) => {
    console.error(data.toString());
  });

  req.on("close", () => {
    ffmpeg.kill();
  });
});

// =========================
// ESP32-CAM
// =========================

async function proxyImage(url, res, label) {
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
    });

    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch ${label}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.status(200).send(buffer);
  } catch (error) {
    console.error(`${label} error:`, error);
    res.status(500).send(`${label} error: ${error.message}`);
  }
}

// Live image dari ESP32-CAM
app.get("/esp32cam.jpg", async (req, res) => {
  await proxyImage(`${ESP32_CAM_BASE_URL}/jpg`, res, "ESP32-CAM live image");
});

// Latest photo dari ESP32-CAM
app.get("/esp32cam/latest.jpg", async (req, res) => {
  await proxyImage(
    `${ESP32_CAM_BASE_URL}/latest.jpg`,
    res,
    "ESP32-CAM latest image"
  );
});

// Flash ON/OFF
app.get("/esp32cam/flash/:state", async (req, res) => {
  const state = String(req.params.state || "").toLowerCase();

  if (!["on", "off"].includes(state)) {
    return res.status(400).json({
      success: false,
      message: "Invalid flash state. Use on or off.",
    });
  }

  try {
    const response = await fetch(`${ESP32_CAM_BASE_URL}/flash/${state}`);
    const text = await response.text();

    res.json({
      success: response.ok,
      state,
      response: text,
    });
  } catch (error) {
    console.error("ESP32-CAM flash error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Work mode ON/OFF
app.get("/esp32cam/work/:state", async (req, res) => {
  const state = String(req.params.state || "").toLowerCase();

  if (!["on", "off"].includes(state)) {
    return res.status(400).json({
      success: false,
      message: "Invalid work state. Use on or off.",
    });
  }

  try {
    const response = await fetch(`${ESP32_CAM_BASE_URL}/work/${state}`);
    const text = await response.text();

    res.json({
      success: response.ok,
      state,
      response: text,
    });
  } catch (error) {
    console.error("ESP32-CAM work mode error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Status ESP32-CAM
app.get("/esp32cam/status", async (req, res) => {
  try {
    const response = await fetch(`${ESP32_CAM_BASE_URL}/status`);
    const text = await response.text();

    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "text/plain"
    );
    res.status(response.status).send(text);
  } catch (error) {
    console.error("ESP32-CAM status error:", error);
    res.status(500).send(`ESP32-CAM status error: ${error.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Smart Farm Camera Bridge running on http://localhost:${PORT}`);
  console.log(`CCTV Snapshot: http://localhost:${PORT}/cctv.jpg`);
  console.log(`CCTV MJPEG: http://localhost:${PORT}/cctv.mjpeg`);
  console.log(`ESP32-CAM Live JPG: http://localhost:${PORT}/esp32cam.jpg`);
  console.log(`ESP32-CAM Latest: http://localhost:${PORT}/esp32cam/latest.jpg`);
  console.log(`ESP32-CAM Status: http://localhost:${PORT}/esp32cam/status`);
});