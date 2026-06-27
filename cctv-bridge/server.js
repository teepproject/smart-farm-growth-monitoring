const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const app = express();
const PORT = 5001;

// CCTV RTSP URL that works in VLC
const CCTV_RTSP_URL = "rtsp://192.168.0.237:554/Streaming/Channels/101";

// Latest ESP32-CAM IP from the Serial Monitor
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

// =====================================================
// AUTO CAPTURE CCTV + ESP32-CAM TO SUPABASE
// Paste this block at the very bottom of server.js
// =====================================================

require("dotenv").config();

const {
  createClient: createSupabaseClientForAutoCapture,
} = require("@supabase/supabase-js");

const AUTO_SUPABASE_URL = process.env.SUPABASE_URL || "";
const AUTO_SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const AUTO_SUPABASE_STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET || "camera-captures";

const AUTO_CAMERA_TABLE = "camera_captures";

const AUTO_CAPTURE_ENABLED =
  String(process.env.AUTO_CAPTURE_ENABLED || "true").toLowerCase() === "true";

const AUTO_CAPTURE_INTERVAL_MINUTES =
  Number(process.env.AUTO_CAPTURE_INTERVAL_MINUTES || 60) || 60;

const AUTO_CAPTURE_INTERVAL_MS = AUTO_CAPTURE_INTERVAL_MINUTES * 60 * 1000;

const autoSupabase =
  AUTO_SUPABASE_URL && AUTO_SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseClientForAutoCapture(
        AUTO_SUPABASE_URL,
        AUTO_SUPABASE_SERVICE_ROLE_KEY
      )
    : null;

let autoCaptureRunning = false;
let lastAutoCaptureAt = null;

function autoCaptureTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function autoCaptureCctvBuffer() {
  return new Promise((resolve, reject) => {
    const chunks = [];

    const ffmpeg = spawn(ffmpegPath, [
      "-rtsp_transport",
      "tcp",
      "-i",
      CCTV_RTSP_URL,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-1",
      "-q:v",
      "8",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ]);

    const timeout = setTimeout(() => {
      ffmpeg.kill();
      reject(new Error("CCTV capture timeout"));
    }, 20000);

    ffmpeg.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on("data", (data) => {
      console.error("[AUTO CCTV FFmpeg]", data.toString());
    });

    ffmpeg.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    ffmpeg.on("close", (code) => {
      clearTimeout(timeout);

      const buffer = Buffer.concat(chunks);

      if (buffer.length === 0) {
        reject(new Error(`CCTV capture returned empty buffer. Code: ${code}`));
        return;
      }

      resolve(buffer);
    });
  });
}

async function autoFetchImageBuffer(url, label) {
  const requestUrl = url.includes("?")
    ? `${url}&t=${Date.now()}`
    : `${url}?t=${Date.now()}`;

  const response = await fetch(requestUrl, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      "User-Agent": "SmartFarmCameraBridge/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`${label} failed. Status: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("image")) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `${label} did not return image. Content-Type: ${contentType}. Body: ${text.slice(
        0,
        200
      )}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadAutoCameraCapture(cameraId, imageBuffer, note) {
  if (!autoSupabase) {
    throw new Error(
      "Supabase belum siap. Periksa SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di file .env."
    );
  }

  const timestamp = autoCaptureTimestamp();
  const filePath = `${cameraId}/${timestamp}.jpg`;

  const { error: uploadError } = await autoSupabase.storage
    .from(AUTO_SUPABASE_STORAGE_BUCKET)
    .upload(filePath, imageBuffer, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Upload ${cameraId} gagal: ${uploadError.message}`);
  }

  const { data: publicUrlData } = autoSupabase.storage
    .from(AUTO_SUPABASE_STORAGE_BUCKET)
    .getPublicUrl(filePath);

  const imageUrl = publicUrlData.publicUrl;

  const { data, error: insertError } = await autoSupabase
    .from(AUTO_CAMERA_TABLE)
    .insert({
      camera_id: cameraId,
      image_url: imageUrl,
      status: "done",
      note,
    })
    .select("*")
    .single();

  if (insertError) {
    throw new Error(`Insert metadata ${cameraId} gagal: ${insertError.message}`);
  }

  return data;
}

async function runAutoCaptureBothCameras(reason = "auto-hourly-capture") {
  if (autoCaptureRunning) {
    console.log("[AUTO CAPTURE] Previous capture still running. Skipped.");

    return {
      success: false,
      skipped: true,
      message: "Previous capture still running.",
    };
  }

  autoCaptureRunning = true;

  const result = {
    success: true,
    reason,
    started_at: new Date().toISOString(),
    cctv: null,
    esp32cam: null,
    errors: [],
  };

  console.log("==========================================");
  console.log("[AUTO CAPTURE] Starting:", reason);
  console.log("==========================================");

  try {
    try {
      console.log("[AUTO CAPTURE] Capturing CCTV Zone 1...");

      const cctvBuffer = await autoCaptureCctvBuffer();

      const cctvRow = await uploadAutoCameraCapture(
        "cctv_zone_1",
        cctvBuffer,
        reason
      );

      result.cctv = cctvRow;
      console.log("[AUTO CAPTURE] CCTV uploaded:", cctvRow.image_url);
    } catch (error) {
      console.error("[AUTO CAPTURE] CCTV error:", error.message);

      result.success = false;
      result.errors.push({
        camera: "cctv_zone_1",
        message: error.message,
      });
    }

    try {
      console.log("[AUTO CAPTURE] Capturing ESP32-CAM...");

      const esp32Buffer = await autoFetchImageBuffer(
        `${ESP32_CAM_BASE_URL}/jpg`,
        "ESP32-CAM auto capture"
      );

      const esp32Row = await uploadAutoCameraCapture(
        "esp32_cam",
        esp32Buffer,
        reason
      );

      result.esp32cam = esp32Row;
      console.log("[AUTO CAPTURE] ESP32-CAM uploaded:", esp32Row.image_url);
    } catch (error) {
      console.error("[AUTO CAPTURE] ESP32-CAM error:", error.message);

      result.success = false;
      result.errors.push({
        camera: "esp32_cam",
        message: error.message,
      });
    }

    result.finished_at = new Date().toISOString();
    lastAutoCaptureAt = result.finished_at;

    console.log("[AUTO CAPTURE] Finished:", result);

    return result;
  } finally {
    autoCaptureRunning = false;
  }
}

app.get("/auto-capture/status", (req, res) => {
  res.json({
    enabled: AUTO_CAPTURE_ENABLED,
    intervalMinutes: AUTO_CAPTURE_INTERVAL_MINUTES,
    intervalMs: AUTO_CAPTURE_INTERVAL_MS,
    running: autoCaptureRunning,
    lastAutoCaptureAt,
    supabaseReady: Boolean(autoSupabase),
    bucket: AUTO_SUPABASE_STORAGE_BUCKET,
    table: AUTO_CAMERA_TABLE,
  });
});

app.get("/auto-capture/run", async (req, res) => {
  try {
    const result = await runAutoCaptureBothCameras("manual-http-auto-capture");
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

if (AUTO_CAPTURE_ENABLED) {
  console.log(
    `[AUTO CAPTURE] Enabled. Interval: ${AUTO_CAPTURE_INTERVAL_MINUTES} minutes.`
  );

  console.log(
    `Auto Capture Status: http://localhost:${PORT}/auto-capture/status`
  );

  console.log(`Auto Capture Run: http://localhost:${PORT}/auto-capture/run`);

  setInterval(() => {
    runAutoCaptureBothCameras("auto-hourly-capture");
  }, AUTO_CAPTURE_INTERVAL_MS);
} else {
  console.log("[AUTO CAPTURE] Disabled.");
}

if (!autoSupabase) {
  console.warn(
    "[AUTO CAPTURE] Supabase belum siap. Periksa file .env di folder cctv-bridge."
  );
}