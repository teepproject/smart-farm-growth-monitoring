require("dotenv").config();

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TB_URL = process.env.THINGSBOARD_URL;
const TB_USERNAME = process.env.THINGSBOARD_USERNAME;
const TB_PASSWORD = process.env.THINGSBOARD_PASSWORD;
const DEVICE_ID = process.env.THINGSBOARD_DEVICE_ID;

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 10000);

const SUPABASE_TABLE = "sensor_readings";
const SUPABASE_DEVICE_ID = "esp8266-zone-1";

const REQUIRED_ENV = [
  ["SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY],
  ["THINGSBOARD_URL", TB_URL],
  ["THINGSBOARD_USERNAME", TB_USERNAME],
  ["THINGSBOARD_PASSWORD", TB_PASSWORD],
  ["THINGSBOARD_DEVICE_ID", DEVICE_ID],
];

const missingEnv = REQUIRED_ENV.filter(([, value]) => !value).map(([key]) => key);

if (missingEnv.length > 0) {
  console.error("[FATAL] Environment variable belum lengkap:");
  missingEnv.forEach((key) => console.error(`- ${key}`));
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
});

const tbApi = axios.create({
  baseURL: TB_URL,
  timeout: 15000,
});

const KEYS = [
  "temperature",
  "humidity",

  // Format dashboard
  "soil_a0",
  "soil_a1",
  "soil_a2",
  "soil_a3",
  "soil_a4",
  "soil_a5",

  "pump_1",
  "pump_2",
  "pump_3",

  // Format zone dari ThingsBoard
  "soil_z1_s1",
  "soil_z1_s2",
  "soil_z2_s1",
  "soil_z2_s2",
  "soil_z3_s1",
  "soil_z3_s2",

  "soil_z1_avg",
  "soil_z2_avg",
  "soil_z3_avg",

  "raw_a0",
  "raw_a1",
  "raw_a2",
  "raw_a3",
  "raw_a4",
  "raw_a5",

  "pump_z1",
  "pump_z2",
  "pump_z3",

  "pump_z1_status",
  "pump_z2_status",
  "pump_z3_status",

  "rtc_hour",
  "rtc_minute",
  "rtc_second",
  "experiment_day",
];

let jwtToken = null;
let lastSavedTelemetryTimestamp = "";

// ================================
// HELPER: READ THINGSBOARD DATA
// ================================

function latestValue(tbData, key) {
  if (!tbData[key] || !tbData[key][0]) return null;
  return tbData[key][0].value;
}

function latestValueAny(tbData, keys) {
  for (const key of keys) {
    const value = latestValue(tbData, key);

    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return null;
}

function latestTs(tbData, key) {
  if (!tbData[key] || !tbData[key][0]) return null;

  const ts = Number(tbData[key][0].ts);

  if (!Number.isFinite(ts)) {
    return null;
  }

  return ts;
}

function latestMaxTs(tbData, keys) {
  const timestamps = keys
    .map((key) => latestTs(tbData, key))
    .filter((ts) => Number.isFinite(ts));

  if (timestamps.length === 0) {
    return null;
  }

  return Math.max(...timestamps);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function toBoolean(value) {
  if (value === null || value === undefined || value === "") return false;

  if (typeof value === "boolean") return value;

  const text = String(value).trim().toLowerCase();

  if (text === "true") return true;
  if (text === "on") return true;
  if (text === "1") return true;

  return false;
}

function statusToBoolean(value) {
  if (value === null || value === undefined || value === "") return false;

  const text = String(value).trim().toLowerCase();

  if (text === "on") return true;
  if (text === "true") return true;
  if (text === "1") return true;

  return false;
}

function summarizeRow(row) {
  return {
    created_at: row.created_at,
    temperature: row.temperature,
    humidity: row.humidity,
    soil_a0: row.soil_a0,
    soil_a1: row.soil_a1,
    soil_a2: row.soil_a2,
    soil_a3: row.soil_a3,
    soil_a4: row.soil_a4,
    soil_a5: row.soil_a5,
    pump_1: row.pump_1,
    pump_2: row.pump_2,
    pump_3: row.pump_3,
  };
}

// ================================
// THINGSBOARD LOGIN
// ================================

async function loginThingsBoard() {
  const response = await tbApi.post("/api/auth/login", {
    username: TB_USERNAME,
    password: TB_PASSWORD,
  });

  jwtToken = response.data.token;
  console.log("[OK] Logged in to ThingsBoard");
}

// ================================
// GET LATEST TELEMETRY
// ================================

async function getLatestTelemetry() {
  if (!jwtToken) {
    await loginThingsBoard();
  }

  try {
    const response = await tbApi.get(
      `/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/timeseries`,
      {
        params: {
          keys: KEYS.join(","),
        },
        headers: {
          "X-Authorization": `Bearer ${jwtToken}`,
        },
      }
    );

    return response.data || {};
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.log("[INFO] ThingsBoard token expired. Login again...");
      jwtToken = null;
      return getLatestTelemetry();
    }

    throw error;
  }
}

// ================================
// SAVE TO SUPABASE
// ================================

async function saveToSupabase(tbData) {
  const receivedKeys = Object.keys(tbData);

  if (receivedKeys.length === 0) {
    console.log("[SKIP] ThingsBoard telemetry kosong");
    return;
  }

  const telemetryTimestamp = latestMaxTs(tbData, KEYS);

  if (!telemetryTimestamp) {
    console.log("[SKIP] No valid telemetry timestamp from ThingsBoard");
    return;
  }

  const telemetrySignature = String(telemetryTimestamp);

  if (telemetrySignature === lastSavedTelemetryTimestamp) {
    console.log("[SKIP] Telemetry timestamp unchanged");
    return;
  }

  const createdAt = new Date(telemetryTimestamp).toISOString();

  const soilA0 = toNumber(latestValueAny(tbData, ["soil_a0", "soil_z1_s1"]));
  const soilA1 = toNumber(latestValueAny(tbData, ["soil_a1", "soil_z1_s2"]));
  const soilA2 = toNumber(latestValueAny(tbData, ["soil_a2", "soil_z2_s1"]));
  const soilA3 = toNumber(latestValueAny(tbData, ["soil_a3", "soil_z2_s2"]));
  const soilA4 = toNumber(latestValueAny(tbData, ["soil_a4", "soil_z3_s1"]));
  const soilA5 = toNumber(latestValueAny(tbData, ["soil_a5", "soil_z3_s2"]));

  const pumpZ1Status = latestValue(tbData, "pump_z1_status");
  const pumpZ2Status = latestValue(tbData, "pump_z2_status");
  const pumpZ3Status = latestValue(tbData, "pump_z3_status");

  const pump1 =
    latestValue(tbData, "pump_1") !== null
      ? toBoolean(latestValue(tbData, "pump_1"))
      : latestValue(tbData, "pump_z1") !== null
      ? toBoolean(latestValue(tbData, "pump_z1"))
      : statusToBoolean(pumpZ1Status);

  const pump2 =
    latestValue(tbData, "pump_2") !== null
      ? toBoolean(latestValue(tbData, "pump_2"))
      : latestValue(tbData, "pump_z2") !== null
      ? toBoolean(latestValue(tbData, "pump_z2"))
      : statusToBoolean(pumpZ2Status);

  const pump3 =
    latestValue(tbData, "pump_3") !== null
      ? toBoolean(latestValue(tbData, "pump_3"))
      : latestValue(tbData, "pump_z3") !== null
      ? toBoolean(latestValue(tbData, "pump_z3"))
      : statusToBoolean(pumpZ3Status);

  const row = {
    created_at: createdAt,
    device_id: SUPABASE_DEVICE_ID,

    temperature: toNumber(latestValue(tbData, "temperature")),
    humidity: toNumber(latestValue(tbData, "humidity")),

    // Kolom yang dibaca dashboard
    soil_a0: soilA0,
    soil_a1: soilA1,
    soil_a2: soilA2,
    soil_a3: soilA3,
    soil_a4: soilA4,
    soil_a5: soilA5,

    pump_1: pump1,
    pump_2: pump2,
    pump_3: pump3,

    // Kolom detail ThingsBoard
    soil_z1_s1: toNumber(latestValue(tbData, "soil_z1_s1")),
    soil_z1_s2: toNumber(latestValue(tbData, "soil_z1_s2")),
    soil_z2_s1: toNumber(latestValue(tbData, "soil_z2_s1")),
    soil_z2_s2: toNumber(latestValue(tbData, "soil_z2_s2")),
    soil_z3_s1: toNumber(latestValue(tbData, "soil_z3_s1")),
    soil_z3_s2: toNumber(latestValue(tbData, "soil_z3_s2")),

    soil_z1_avg: toNumber(latestValue(tbData, "soil_z1_avg")),
    soil_z2_avg: toNumber(latestValue(tbData, "soil_z2_avg")),
    soil_z3_avg: toNumber(latestValue(tbData, "soil_z3_avg")),

    raw_a0: toNumber(latestValue(tbData, "raw_a0")),
    raw_a1: toNumber(latestValue(tbData, "raw_a1")),
    raw_a2: toNumber(latestValue(tbData, "raw_a2")),
    raw_a3: toNumber(latestValue(tbData, "raw_a3")),
    raw_a4: toNumber(latestValue(tbData, "raw_a4")),
    raw_a5: toNumber(latestValue(tbData, "raw_a5")),

    pump_z1_status: pumpZ1Status,
    pump_z2_status: pumpZ2Status,
    pump_z3_status: pumpZ3Status,

    rtc_hour: toNumber(latestValue(tbData, "rtc_hour")),
    rtc_minute: toNumber(latestValue(tbData, "rtc_minute")),
    rtc_second: toNumber(latestValue(tbData, "rtc_second")),
    experiment_day: toNumber(latestValue(tbData, "experiment_day")),
  };

  const { error } = await supabase.from(SUPABASE_TABLE).insert(row);

  if (error) {
    throw error;
  }

  lastSavedTelemetryTimestamp = telemetrySignature;

  console.log("[OK] Saved to Supabase:");
  console.log(summarizeRow(row));
}

// ================================
// MAIN LOOP
// ================================

async function runOnce() {
  try {
    const tbData = await getLatestTelemetry();

    console.log("[INFO] ThingsBoard keys received:", Object.keys(tbData));

    await saveToSupabase(tbData);
  } catch (error) {
    if (error.response) {
      console.error("[ERROR]", error.response.status, error.response.data);
    } else {
      console.error("[ERROR]", error.message || error);
    }
  }
}

console.log("[START] ThingsBoard to Supabase bridge running...");
console.log("[INFO] ThingsBoard URL:", TB_URL);
console.log("[INFO] ThingsBoard device:", DEVICE_ID);
console.log("[INFO] Poll interval:", POLL_INTERVAL_MS, "ms");

runOnce();
setInterval(runOnce, POLL_INTERVAL_MS);