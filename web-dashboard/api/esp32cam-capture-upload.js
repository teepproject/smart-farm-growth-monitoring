import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ESP32_CAM_URL = process.env.VITE_ESP32_CAM_URL;

const BUCKET_NAME = "esp32-cam-captures";
const TABLE_NAME = "esp32_cam_captures";

function buildCameraUrl(pathname) {
  const url = new URL(ESP32_CAM_URL);
  url.pathname = pathname;
  url.search = "";
  return url.toString();
}

async function fetchCamera(url) {
  return fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "ngrok-skip-browser-warning": "true",
      "User-Agent": "Mozilla/5.0 SmartFarmDashboard",
      "Cache-Control": "no-cache",
    },
  });
}

export default async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({
        success: false,
        message:
          "The Supabase server configuration is incomplete. Check VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      });
      return;
    }

    if (!ESP32_CAM_URL) {
      res.status(500).json({
        success: false,
        message: "VITE_ESP32_CAM_URL belum dikonfigurasi.",
      });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Minta ESP32-CAM capture foto baru.
    // Kalau endpoint /capture gagal, nanti tetap fallback ke /jpg.
    try {
      const captureUrl = buildCameraUrl("/capture");
      await fetchCamera(captureUrl);
    } catch (captureError) {
      console.log("Capture endpoint failed, fallback to live JPG.");
    }

    // 2. Ambil latest.jpg. Kalau gagal, fallback ke /jpg.
    let imageResponse = await fetchCamera(buildCameraUrl("/latest.jpg"));
    let contentType = imageResponse.headers.get("content-type") || "";

    if (!imageResponse.ok || !contentType.includes("image")) {
      imageResponse = await fetchCamera(buildCameraUrl("/jpg"));
      contentType = imageResponse.headers.get("content-type") || "";
    }

    if (!imageResponse.ok || !contentType.includes("image")) {
      const text = await imageResponse.text().catch(() => "");
      res.status(502).json({
        success: false,
        message: "ESP32-CAM tidak mengirim image/jpeg.",
        status: imageResponse.status,
        contentType,
        body: text.slice(0, 300),
      });
      return;
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const capturedAt = new Date();
    const safeTimestamp = capturedAt.toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const storagePath = `hourly/${safeTimestamp}.jpg`;

    // 3. Upload ke Supabase Storage.
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, buffer, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      res.status(500).json({
        success: false,
        message: `Gagal upload ke Supabase Storage: ${uploadError.message}`,
      });
      return;
    }

    // 4. Ambil public URL.
    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);

    const imageUrl = publicUrlData.publicUrl;

    // 5. Simpan metadata ke tabel.
    const { data: insertedRow, error: insertError } = await supabase
      .from(TABLE_NAME)
      .insert({
        captured_at: capturedAt.toISOString(),
        source: "esp32-cam",
        storage_path: storagePath,
        image_url: imageUrl,
        file_size: buffer.length,
        status: "done",
        note: "Captured from ESP32-CAM and uploaded by Vercel API",
      })
      .select("*")
      .single();

    if (insertError) {
      res.status(500).json({
        success: false,
        message: `Gagal insert metadata: ${insertError.message}`,
        image_url: imageUrl,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "ESP32-CAM capture berhasil disimpan ke Supabase.",
      capture: insertedRow,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `ESP32-CAM capture upload error: ${error.message}`,
    });
  }
}