const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const app = express();
const PORT = 5001;

// CCTV RTSP URL yang sudah berhasil di VLC
const CCTV_RTSP_URL = "rtsp://192.168.0.237:554/Streaming/Channels/101";

app.use(cors());

app.get("/", (req, res) => {
  res.send(`
    <h2>CCTV Bridge is running</h2>
    <p>Snapshot: <a href="/cctv.jpg">/cctv.jpg</a></p>
    <p>Realtime MJPEG: <a href="/cctv.mjpeg">/cctv.mjpeg</a></p>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    camera: "CCTV Zone 1",
    rtsp: CCTV_RTSP_URL,
  });
});

// Ambil 1 gambar JPG dari CCTV
app.get("/cctv.jpg", (req, res) => {
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store");

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
    "Cache-Control": "no-cache",
    "Connection": "close",
    "Pragma": "no-cache",
  });

  const ffmpeg = spawn(ffmpegPath, [
    "-rtsp_transport", "tcp",
    "-i", CCTV_RTSP_URL,
    "-an",
    "-r", "8",
    "-q:v", "5",
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

app.listen(PORT, () => {
  console.log(`CCTV bridge running on http://localhost:${PORT}`);
  console.log(`Snapshot: http://localhost:${PORT}/cctv.jpg`);
  console.log(`MJPEG: http://localhost:${PORT}/cctv.mjpeg`);
});