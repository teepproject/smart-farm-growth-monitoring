const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
    },
  }
);

const SENSOR_TABLE = "sensor_readings";
const COMMAND_TABLE = "device_commands";
const CAMERA_TABLE = "camera_captures";

const DEVICE_ID = "esp8266-zone-1";
const BRIDGE_MODE = process.env.BRIDGE_MODE || "SIMULATION";

const TB_URL = process.env.THINGSBOARD_URL;
const TB_USERNAME = process.env.THINGSBOARD_USERNAME;
const TB_PASSWORD = process.env.THINGSBOARD_PASSWORD;
const TB_DEVICE_ID = process.env.THINGSBOARD_DEVICE_ID;

let tbToken = null;
let tbTokenTime = 0;

console.log("====================================");
console.log("Smart Farm Command Bridge Started");
console.log("Mode:", BRIDGE_MODE);
console.log("====================================");

async function getLatestSensorReading() {
  const { data, error } = await supabase
    .from(SENSOR_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log("Gagal ambil sensor terakhir:", error.message);
    return null;
  }

  return data;
}

async function insertPumpStatus(command, value) {
  const latest = await getLatestSensorReading();

  const nextReading = {
    device_id: DEVICE_ID,
    temperature: latest?.temperature ?? null,
    humidity: latest?.humidity ?? null,

    soil_a0: latest?.soil_a0 ?? null,
    soil_a1: latest?.soil_a1 ?? null,
    soil_a2: latest?.soil_a2 ?? null,
    soil_a3: latest?.soil_a3 ?? null,
    soil_a4: latest?.soil_a4 ?? null,
    soil_a5: latest?.soil_a5 ?? null,

    pump_1: latest?.pump_1 ?? false,
    pump_2: latest?.pump_2 ?? false,
    pump_3: latest?.pump_3 ?? false,
  };

  if (command === "pump_1") nextReading.pump_1 = Boolean(value);
  if (command === "pump_2") nextReading.pump_2 = Boolean(value);
  if (command === "pump_3") nextReading.pump_3 = Boolean(value);

  const { error } = await supabase.from(SENSOR_TABLE).insert(nextReading);

  if (error) {
    throw new Error(error.message);
  }
}

async function loginThingsBoard() {
  const now = Date.now();

  if (tbToken && now - tbTokenTime < 1000 * 60 * 60) {
    return tbToken;
  }

  if (!TB_URL || !TB_USERNAME || !TB_PASSWORD) {
    throw new Error("Konfigurasi ThingsBoard belum lengkap di .env");
  }

  const response = await fetch(`${TB_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: TB_USERNAME,
      password: TB_PASSWORD,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login ThingsBoard gagal: ${response.status} ${text}`);
  }

  const json = await response.json();

  tbToken = json.token;
  tbTokenTime = now;

  return tbToken;
}

async function sendThingsBoardRpc(command, value, payload = {}) {
  if (!TB_DEVICE_ID) {
    throw new Error("THINGSBOARD_DEVICE_ID belum diisi di .env");
  }

  const token = await loginThingsBoard();

  const rpcBody = {
    method: command,
    params: {
      value: Boolean(value),
      ...payload,
    },
  };

  console.log("Kirim RPC ke ThingsBoard:", rpcBody);

  const response = await fetch(`${TB_URL}/api/rpc/oneway/${TB_DEVICE_ID}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(rpcBody),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RPC ThingsBoard gagal: ${response.status} ${text}`);
  }
}

async function insertCameraPending() {
  const { error } = await supabase.from(CAMERA_TABLE).insert({
    camera_id: "zone_1",
    image_url: null,
    storage_path: null,
    status: "pending",
    note: "Bridge menerima request capture. CCTV asli belum disambungkan.",
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function updateCommand(id, status, response) {
  const updateData = {
    status,
    response,
  };

  if (status === "done" || status === "failed") {
    updateData.executed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from(COMMAND_TABLE)
    .update(updateData)
    .eq("id", id);

  if (error) {
    console.log("Gagal update command:", error.message);
  }
}

async function handleDeviceCommand(commandRow) {
  if (BRIDGE_MODE === "THINGSBOARD") {
    await sendThingsBoardRpc(commandRow.command, commandRow.value, {
      source: "supabase-dashboard",
      command_id: commandRow.id,
    });

    const actionLabel =
      commandRow.command === "reset_system"
        ? "RESET ESP + MEGA"
        : commandRow.value
          ? "ON"
          : "OFF";

    await updateCommand(
      commandRow.id,
      "done",
      `THINGSBOARD: RPC ${commandRow.command} = ${actionLabel} berhasil dikirim.`
    );

    return;
  }

  if (["pump_1", "pump_2", "pump_3"].includes(commandRow.command)) {
    await insertPumpStatus(commandRow.command, commandRow.value);

    await updateCommand(
      commandRow.id,
      "done",
      `SIMULATION: ${commandRow.command} = ${
        commandRow.value ? "ON" : "OFF"
      }`
    );

    return;
  }

  if (commandRow.command === "reset_system") {
    await updateCommand(
      commandRow.id,
      "done",
      "SIMULATION: reset_system diterima bridge."
    );

    return;
  }
}

async function processCommand(commandRow) {
  console.log("------------------------------------");
  console.log("Command masuk:", commandRow.command, commandRow.value);

  await updateCommand(
    commandRow.id,
    "processing",
    "Command sedang diproses oleh bridge."
  );

  try {
    if (["pump_1", "pump_2", "pump_3", "reset_system"].includes(commandRow.command)) {
      await handleDeviceCommand(commandRow);
      console.log("Selesai:", commandRow.command);
      return;
    }

    if (commandRow.command === "capture_camera_zone_1") {
      await insertCameraPending();

      await updateCommand(
        commandRow.id,
        "done",
        "SIMULATION: request capture CCTV diterima bridge."
      );

      console.log("Request CCTV diterima.");
      return;
    }

    await updateCommand(
      commandRow.id,
      "failed",
      `Command tidak dikenal: ${commandRow.command}`
    );
  } catch (error) {
    await updateCommand(commandRow.id, "failed", error.message);
    console.log("Error:", error.message);
  }
}

async function checkPendingCommands() {
  const { data, error } = await supabase
    .from(COMMAND_TABLE)
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    console.log("Gagal membaca command:", error.message);
    return;
  }

  for (const commandRow of data || []) {
    await processCommand(commandRow);
  }
}

setInterval(checkPendingCommands, Number(process.env.POLL_INTERVAL_MS || 3000));
checkPendingCommands();