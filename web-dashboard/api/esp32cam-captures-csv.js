import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TABLE_NAME = "esp32_cam_captures";

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export default async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).send(
        "Supabase server config belum lengkap. Periksa VITE_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY."
      );
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { start, end } = req.query;

    let query = supabase
      .from(TABLE_NAME)
      .select("*")
      .order("captured_at", { ascending: true })
      .limit(10000);

    if (start) {
      query = query.gte("captured_at", String(start));
    }

    if (end) {
      query = query.lte("captured_at", String(end));
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).send(`Gagal mengambil data ESP32-CAM: ${error.message}`);
      return;
    }

    const rows = data || [];

    const columns = [
      "id",
      "captured_at",
      "source",
      "storage_path",
      "image_url",
      "file_size",
      "status",
      "note",
      "created_at",
    ];

    const csvRows = [
      columns.join(","),
      ...rows.map((row) =>
        columns.map((column) => csvEscape(row[column])).join(",")
      ),
    ];

    const csvContent = csvRows.join("\n");

    const fileName = `esp32-cam-captures-${new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replaceAll(".", "-")}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.status(200).send(csvContent);
  } catch (error) {
    res.status(500).send(`ESP32-CAM CSV error: ${error.message}`);
  }
}