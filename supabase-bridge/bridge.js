require("dotenv").config();

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TB_URL = process.env.THINGSBOARD_URL;
const TB_USERNAME = process.env.THINGSBOARD_USERNAME;
const TB_PASSWORD = process.env.THINGSBOARD_PASSWORD;
const DEVICE_ID = process.env.THINGSBOARD_DEVICE_ID;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 10000);

const SUPABASE_TABLE = "sensor_readings";
const SUPABASE_DEVICE_ID = "esp8266-zone-1";

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
let lastSavedSignature = "";

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

function latestTimestampAny(tbData, keys) {
  for (const key of keys) {
    if (tbData[key] && tbData[key][0] && tbData[key][0].ts) {
      return tbData[key][0].ts;
    }
  }

  return Date.now();
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

async function loginThingsBoard() {
  const response = await axios.post(`${TB_URL}/api/auth/login`, {
    username: TB_USERNAME,
    password: TB_PASSWORD,
  });

  jwtToken = response.data.token;
  console.log("[OK] Logged in to ThingsBoard");
}

async function getLatestTelemetry() {
  if (!jwtToken) {
    await loginThingsBoard();
  }

  try {
    const response = await axios.get(
      `${TB_URL}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/timeseries`,
      {
        params: {
          keys: KEYS.join(","),
        },
        headers: {
          "X-Authorization": `Bearer ${jwtToken}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.log("[INFO] ThingsBoard token expired. Login again...");
      jwtToken = null;
      return getLatestTelemetry();
    }

    throw error;
  }
}

async function saveToSupabase(tbData) {
  const soilA0 = toNumber(latestValueAny(tbData, ["soil_a0", "soil_z1_s1"]));
  const soilA1 = toNumber(latestValueAny(tbData, ["soil_a1", "soil_z1_s2"]));
  const soilA2 = toNumber(latestValueAny(tbData, ["soil_a2", "soil_z2_s1"]));
  const soilA3 = toNumber(latestValueAny(tbData, ["soil_a3", "soil_z2_s2"]));
  const soilA4 = toNumber(latestValueAny(tbData, ["soil_a4", "soil_z3_s1"]));
  const soilA5 = toNumber(latestValueAny(tbData, ["soil_a5", "soil_z3_s2"]));

  const pumpZ1Status = latestValue(tbData, "pump_z1_status");
  const pumpZ2Status = latestValue(tbData, "pump_z2_status");
  const pumpZ3Status = latestValue(tbData, "pump_z3_status");

  const pump1 = latestValue(tbData, "pump_1") !== null
    ? toBoolean(latestValue(tbData, "pump_1"))
    : latestValue(tbData, "pump_z1") !== null
      ? toBoolean(latestValue(tbData, "pump_z1"))
      : statusToBoolean(pumpZ1Status);

  const pump2 = latestValue(tbData, "pump_2") !== null
    ? toBoolean(latestValue(tbData, "pump_2"))
    : latestValue(tbData, "pump_z2") !== null
      ? toBoolean(latestValue(tbData, "pump_z2"))
      : statusToBoolean(pumpZ2Status);

  const pump3 = latestValue(tbData, "pump_3") !== null
    ? toBoolean(latestValue(tbData, "pump_3"))
    : latestValue(tbData, "pump_z3") !== null
      ? toBoolean(latestValue(tbData, "pump_z3"))
      : statusToBoolean(pumpZ3Status);

  const telemetryTimestamp = latestTimestampAny(tbData, [
    "temperature",
    "humidity",
    "soil_a0",
    "soil_z1_s1",
    "pump_1",
    "pump_z1_status",
  ]);

  const row = {
    created_at: new Date(telemetryTimestamp).toISOString(),
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

  const signature = JSON.stringify(row);

  if (signature === lastSavedSignature) {
    console.log("[SKIP] Data unchanged");
    return;
  }

  const { error } = await supabase.from(SUPABASE_TABLE).insert(row);

  if (error) {
    throw error;
  }

  lastSavedSignature = signature;

  console.log("[OK] Saved to Supabase:");
  console.log(row);
}

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
console.log("[INFO] Poll interval:", POLL_INTERVAL_MS, "ms");

runOnce();
setInterval(runOnce, POLL_INTERVAL_MS);