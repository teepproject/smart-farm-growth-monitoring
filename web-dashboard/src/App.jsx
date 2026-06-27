import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import "./App.css";
import JSZip from "jszip";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isSupabaseReady = Boolean(supabaseUrl && supabaseAnonKey);

const supabase = isSupabaseReady
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const SENSOR_TABLE = "sensor_readings";
const COMMAND_TABLE = "device_commands";
const CAMERA_TABLE = "camera_captures";

const CCTV_STORAGE_BUCKET =
  import.meta.env.VITE_CCTV_STORAGE_BUCKET || "cctv-captures";

const ESP32_CAM_STORAGE_BUCKET =
  import.meta.env.VITE_ESP32_CAM_STORAGE_BUCKET || "esp32-cam-captures";

const ESP32_CAM_TABLE_CANDIDATES = [
  "esp32cam_captures",
  "esp32_cam_captures",
  "esp32_captures",
  CAMERA_TABLE,
];

const IMAGE_URL_COLUMNS = [
  "image_url",
  "public_url",
  "url",
  "signed_url",
  "download_url",
];

const IMAGE_PATH_COLUMNS = [
  "image_path",
  "storage_path",
  "path",
  "file_path",
  "object_path",
];

const IMAGE_BUCKET_COLUMNS = [
  "bucket",
  "bucket_id",
  "storage_bucket",
  "image_bucket",
];

const REALTIME_WINDOW_MS = 60 * 1000;
const DASHBOARD_POLL_MS = 3000;

function App() {
  const [latestData, setLatestData] = useState(null);
  const [history, setHistory] = useState([]);
  const [commands, setCommands] = useState([]);
  const [captures, setCaptures] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");

  const [csvStartDate, setCsvStartDate] = useState(() =>
    toDateTimeLocalInput(new Date(Date.now() - 24 * 60 * 60 * 1000))
  );
  const [csvEndDate, setCsvEndDate] = useState(() =>
    toDateTimeLocalInput(new Date())
  );

  async function fetchAllData(showLoading = true) {
    if (!supabase) {
      setLoading(false);
      setErrorMessage(
        "Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
      );
      return;
    }

    if (showLoading) {
      setLoading(true);
    }

    setErrorMessage("");

    try {
      await Promise.all([fetchSensorData(), fetchCommands(), fetchCaptures()]);
    } catch (error) {
      setErrorMessage(error.message || "Failed to fetch data.");
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  async function fetchSensorData() {
    const { data, error } = await supabase
      .from(SENSOR_TABLE)
      .select("*")
      .not("soil_a0", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(120);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setHistory(data || []);
    setLatestData(data?.[0] || null);
  }

  async function fetchCommands() {
    const { data, error } = await supabase
      .from(COMMAND_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(20);

    if (!error) {
      setCommands(data || []);
    }
  }

  async function fetchCaptures() {
    const { data, error } = await supabase
      .from(CAMERA_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(6);

    if (!error) {
      setCaptures(data || []);
    }
  }

  async function sendCommand(command, value, payload = {}) {
    if (!supabase) {
      setActionMessage("Supabase is not ready. Check the environment configuration.");
      return;
    }

    setActionMessage("");

    const newCommand = {
      device_id: "esp8266-zone-1",
      command,
      value,
      payload,
      status: "pending",
      source: "web-dashboard",
    };

    const { data, error } = await supabase
      .from(COMMAND_TABLE)
      .insert(newCommand)
      .select("*")
      .single();

    if (error) {
      setActionMessage(`Failed to create command: ${error.message}`);
      return;
    }

    if (data) {
      setCommands((previousCommands) =>
        [data, ...previousCommands].slice(0, 20)
      );
    }

    setActionMessage(`Command "${command}" was successfully sent to Supabase.`);
    fetchCommands();
  }

  async function controlPump(pumpNumber, value) {
    await sendCommand(`pump_${pumpNumber}`, value, {
      pump: pumpNumber,
      action: value ? "ON" : "OFF",
    });
  }

  async function resetSystem() {
    const confirmed = window.confirm(
      "Reset ESP8266 and Arduino Mega now? The system will be disconnected for a few seconds."
    );

    if (!confirmed) {
      return;
    }

    await sendCommand("reset_system", true, {
      action: "RESET_ESP_AND_MEGA",
      note: "Soft reset requested from web dashboard",
    });
  }

  async function downloadSupabaseTableCSV(tableName, filePrefix, label) {
    if (!supabase) {
      setActionMessage("Supabase is not ready. Check the environment configuration.");
      return;
    }

    setActionMessage("");

    const startDate = csvStartDate ? new Date(csvStartDate) : null;
    const endDate = csvEndDate ? new Date(csvEndDate) : null;

    if (startDate && Number.isNaN(startDate.getTime())) {
      setActionMessage("Start date is invalid.");
      return;
    }

    if (endDate && Number.isNaN(endDate.getTime())) {
      setActionMessage("End date is invalid.");
      return;
    }

    if (startDate && endDate && startDate > endDate) {
      setActionMessage("Start date cannot be later than end date.");
      return;
    }

    let query = supabase.from(tableName).select("*");

    if (startDate) {
      query = query.gte("created_at", startDate.toISOString());
    }

    if (endDate) {
      query = query.lte("created_at", endDate.toISOString());
    }

    query = query.order("created_at", { ascending: true }).limit(10000);

    const { data, error } = await query;

    if (error) {
      setActionMessage(`Failed to download ${label}: ${error.message}`);
      return;
    }

    if (!data || data.length === 0) {
      setActionMessage(`No ${label} found for the selected period.`);
      return;
    }

    const columns = Object.keys(data[0]);

    const csvRows = [
      columns.join(","),
      ...data.map((row) =>
        columns.map((column) => csvEscape(row[column])).join(",")
      ),
    ];

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    const startLabel = csvStartDate || "start";
    const endLabel = csvEndDate || "end";
    const periodLabel = `${startLabel}_to_${endLabel}`
      .replaceAll(":", "-")
      .replaceAll("T", "_");

    link.href = url;
    link.download = `${filePrefix}-${periodLabel}.csv`;
    link.click();

    URL.revokeObjectURL(url);

    setActionMessage(`${label} downloaded successfully. Total rows: ${data.length}.`);
  }

  function getSelectedDownloadPeriod() {
    const startDate = csvStartDate ? new Date(csvStartDate) : null;
    const endDate = csvEndDate ? new Date(csvEndDate) : null;

    if (startDate && Number.isNaN(startDate.getTime())) {
      return {
        error: "Start date is invalid.",
      };
    }

    if (endDate && Number.isNaN(endDate.getTime())) {
      return {
        error: "End date is invalid.",
      };
    }

    if (startDate && endDate && startDate > endDate) {
      return {
        error: "Start date cannot be later than end date.",
      };
    }

    return {
      startDate,
      endDate,
    };
  }

  async function fetchRowsByPeriod(tableName, startDate, endDate) {
    let query = supabase.from(tableName).select("*");

    if (startDate) {
      query = query.gte("created_at", startDate.toISOString());
    }

    if (endDate) {
      query = query.lte("created_at", endDate.toISOString());
    }

    query = query.order("created_at", { ascending: true }).limit(10000);

    return query;
  }

  async function downloadImageZipFromRows({
    rows,
    filePrefix,
    label,
    defaultBucket,
    rowFilter = () => true,
  }) {
    const filteredRows = (rows || [])
      .filter(rowFilter)
      .filter((row) => hasImageReference(row));

    if (filteredRows.length === 0) {
      setActionMessage(`No ${label} image data found for the selected period.`);
      return false;
    }

    setActionMessage(`Preparing ${label} ZIP. Total image rows: ${filteredRows.length}...`);

    const zip = new JSZip();
    const folder = zip.folder(label);
    let addedCount = 0;
    let failedCount = 0;

    for (const row of filteredRows) {
      try {
        const imageResult = await getImageBlobFromRow(row, defaultBucket);

        if (!imageResult?.blob) {
          failedCount += 1;
          continue;
        }

        const filename = buildImageFilename(row, imageResult.sourceName, addedCount + 1);
        folder.file(filename, imageResult.blob);
        addedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.error(`Failed to add ${label} image to ZIP:`, error, row);
      }
    }

    if (addedCount === 0) {
      setActionMessage(
        `No ${label} image could be downloaded. Check image_url/storage_path and Supabase Storage policy.`
      );
      return false;
    }

    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: {
        level: 6,
      },
    });

    const startLabel = csvStartDate || "start";
    const endLabel = csvEndDate || "end";
    const periodLabel = `${startLabel}_to_${endLabel}`
      .replaceAll(":", "-")
      .replaceAll("T", "_");

    saveBlobAsFile(zipBlob, `${filePrefix}-${periodLabel}.zip`);

    const failedMessage =
      failedCount > 0 ? ` ${failedCount} image(s) failed to download.` : "";

    setActionMessage(
      `${label} ZIP downloaded successfully. Total images: ${addedCount}.${failedMessage}`
    );

    return true;
  }

  async function downloadImageZipFromTable({
    tableName,
    filePrefix,
    label,
    defaultBucket,
    rowFilter = () => true,
  }) {
    if (!supabase) {
      setActionMessage("Supabase is not ready. Check the environment configuration.");
      return false;
    }

    setActionMessage("");

    const period = getSelectedDownloadPeriod();

    if (period.error) {
      setActionMessage(period.error);
      return false;
    }

    const { data, error } = await fetchRowsByPeriod(
      tableName,
      period.startDate,
      period.endDate
    );

    if (error) {
      setActionMessage(`Failed to read ${label} table "${tableName}": ${error.message}`);
      return false;
    }

    return downloadImageZipFromRows({
      rows: data,
      filePrefix,
      label,
      defaultBucket,
      rowFilter,
    });
  }

  async function downloadCctvData() {
    await downloadImageZipFromTable({
      tableName: CAMERA_TABLE,
      filePrefix: "smart-farm-cctv-images",
      label: "CCTV",
      defaultBucket: CCTV_STORAGE_BUCKET,
      rowFilter: (row) => !isEsp32CaptureRow(row),
    });
  }

  async function downloadEsp32CamData() {
    if (!supabase) {
      setActionMessage("Supabase is not ready. Check the environment configuration.");
      return;
    }

    setActionMessage("");

    const period = getSelectedDownloadPeriod();

    if (period.error) {
      setActionMessage(period.error);
      return;
    }

    let lastError = null;

    for (const tableName of ESP32_CAM_TABLE_CANDIDATES) {
      const { data, error } = await fetchRowsByPeriod(
        tableName,
        period.startDate,
        period.endDate
      );

      if (error) {
        lastError = error;
        console.warn(`ESP32-CAM table "${tableName}" could not be used:`, error);
        continue;
      }

      const rowFilter =
        tableName === CAMERA_TABLE ? (row) => isEsp32CaptureRow(row) : () => true;

      const imageRows = (data || []).filter(rowFilter).filter(hasImageReference);

      if (imageRows.length === 0) {
        continue;
      }

      const downloaded = await downloadImageZipFromRows({
        rows: imageRows,
        filePrefix: "smart-farm-esp32-cam-images",
        label: "ESP32-CAM",
        defaultBucket: ESP32_CAM_STORAGE_BUCKET,
      });

      if (downloaded) {
        return;
      }
    }

    if (lastError) {
      setActionMessage(
        `No ESP32-CAM image data found. Last table error: ${lastError.message}`
      );
      return;
    }

    setActionMessage("No ESP32-CAM image data found for the selected period.");
  }

  function setCsvPresetHours(hours) {
    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);

    setCsvStartDate(toDateTimeLocalInput(start));
    setCsvEndDate(toDateTimeLocalInput(end));
  }

  function clearCsvPeriod() {
    setCsvStartDate("");
    setCsvEndDate("");
  }

  async function downloadCSV() {
    if (!supabase) {
      setActionMessage("Supabase is not ready. Check the environment configuration.");
      return;
    }

    setActionMessage("");

    const startDate = csvStartDate ? new Date(csvStartDate) : null;
    const endDate = csvEndDate ? new Date(csvEndDate) : null;

    if (startDate && Number.isNaN(startDate.getTime())) {
      setActionMessage("Start date is invalid.");
      return;
    }

    if (endDate && Number.isNaN(endDate.getTime())) {
      setActionMessage("End date is invalid.");
      return;
    }

    if (startDate && endDate && startDate > endDate) {
      setActionMessage("Start date cannot be later than end date.");
      return;
    }

    let query = supabase
      .from(SENSOR_TABLE)
      .select("*")
      .not("soil_a0", "is", null);

    if (startDate) {
      query = query.gte("created_at", startDate.toISOString());
    }

    if (endDate) {
      query = query.lte("created_at", endDate.toISOString());
    }

    query = query.order("created_at", { ascending: true }).limit(10000);

    const { data, error } = await query;

    if (error) {
      setActionMessage(`Failed to download CSV: ${error.message}`);
      return;
    }

    if (!data || data.length === 0) {
      setActionMessage("No data found for the selected period.");
      return;
    }

    const columns = [
      "created_at",
      "device_id",
      "temperature",
      "humidity",
      "soil_a0",
      "soil_a1",
      "soil_a2",
      "soil_a3",
      "soil_a4",
      "soil_z1_s1",
      "soil_z1_s2",
      "soil_z2_s1",
      "soil_z2_s2",
      "soil_z3_s1",
      "soil_z1_avg",
      "soil_z2_avg",
      "soil_z3_avg",
      "raw_a0",
      "raw_a1",
      "raw_a2",
      "raw_a3",
      "raw_a4",
      "pump_1",
      "pump_2",
      "pump_3",
      "pump_z1_status",
      "pump_z2_status",
      "pump_z3_status",
      "rtc_hour",
      "rtc_minute",
      "rtc_second",
      "experiment_day",
    ];

    const csvRows = [
      columns.join(","),
      ...data.map((row) =>
        columns.map((column) => csvEscape(row[column])).join(",")
      ),
    ];

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    const startLabel = csvStartDate || "start";
    const endLabel = csvEndDate || "end";
    const periodLabel = `${startLabel}_to_${endLabel}`
      .replaceAll(":", "-")
      .replaceAll("T", "_");

    link.href = url;
    link.download = `smart-farm-sensor-data-${periodLabel}.csv`;
    link.click();

    URL.revokeObjectURL(url);

    setActionMessage(
      `CSV downloaded successfully. Total rows: ${data.length}.`
    );
  }

  useEffect(() => {
    fetchAllData(true);

    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel("smart_farm_dashboard_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: SENSOR_TABLE },
        () => fetchAllData(false)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: COMMAND_TABLE },
        () => fetchAllData(false)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: CAMERA_TABLE },
        () => fetchAllData(false)
      )
      .subscribe();

    const interval = setInterval(() => fetchAllData(false), DASHBOARD_POLL_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const soilSensors = [
    { name: "A0", key: "soil_z1_s1", enabled: true },
    { name: "A1", key: "soil_z1_s2", enabled: true },
    { name: "A2", key: "soil_z2_s1", enabled: true },
    { name: "A3", key: "soil_z2_s2", enabled: true },
    { name: "A4", key: "soil_z3_s1", enabled: true },
    {
      name: "A5",
      key: "soil_z3_s2",
      enabled: false,
      disabledText: "Disabled",
      statusText: "Not used",
    },
  ];

  const realtimeRows = [...history]
    .filter((row) => {
      if (!row.created_at) return false;

      const rowTime = new Date(row.created_at).getTime();

      if (Number.isNaN(rowTime)) return false;

      return Date.now() - rowTime <= REALTIME_WINDOW_MS;
    })
    .reverse();

  const chartData = realtimeRows.map((row) => ({
    time: formatTime(row.created_at),
    temperature: toChartNumber(row.temperature),
    humidity: toChartNumber(row.humidity),

    A0: toChartNumber(row.soil_z1_s1),
    A1: toChartNumber(row.soil_z1_s2),
    A2: toChartNumber(row.soil_z2_s1),
    A3: toChartNumber(row.soil_z2_s2),
    A4: toChartNumber(row.soil_z3_s1),

    zona1: average([row.soil_z1_s1, row.soil_z1_s2]),
    zona2: average([row.soil_z2_s1, row.soil_z2_s2]),
    // A5 is disabled, so Zone 3 only uses A4 for now.
    zona3: average([row.soil_z3_s1]),
  }));

  const deviceStatus = getDeviceStatus(latestData);

  const pump1Status = getPumpDisplayStatus(latestData, commands, 1);
  const pump2Status = getPumpDisplayStatus(latestData, commands, 2);
  const pump3Status = getPumpDisplayStatus(latestData, commands, 3);

  const zoneSummaries = latestData
    ? [
        {
          name: "Zone 1",
          sensors: "A0 + A1",
          value: average([latestData.soil_z1_s1, latestData.soil_z1_s2]),
          pump: pump1Status.value,
          pumpSource: pump1Status.source,
        },
        {
          name: "Zone 2",
          sensors: "A2 + A3",
          value: average([latestData.soil_z2_s1, latestData.soil_z2_s2]),
          pump: pump2Status.value,
          pumpSource: pump2Status.source,
        },
        {
          name: "Zone 3",
          sensors: "A4 only (A5 disabled)",
          value: average([latestData.soil_z3_s1]),
          pump: pump3Status.value,
          pumpSource: pump3Status.source,
        },
      ]
    : [];

  return (
    <main className="dashboard">
      <section className="hero">
        <div>
          <p className="label">Smart Farm Monitoring</p>
          <h1>Growth Monitoring Dashboard</h1>
          <p className="subtitle">
            Sensor monitoring, real-time charts, pump status, command control,
            data download and system reset.
          </p>
        </div>

        <button onClick={() => fetchAllData(true)}>Refresh Data</button>
      </section>

      {loading && <p className="info">Fetching data from Supabase...</p>}

      {errorMessage && (
        <div className="error">
          <b>Failed to fetch data:</b>
          <p>{errorMessage}</p>
        </div>
      )}

      {actionMessage && <div className="message">{actionMessage}</div>}

      {!loading && !latestData && !errorMessage && (
        <div className="empty">
          No sensor data found in table <code>{SENSOR_TABLE}</code>.
        </div>
      )}

      {latestData && (
        <>
          <section className="grid">
            <Card title="Air Temperature" value={latestData.temperature} unit="°C" />
            <Card title="Air Humidity" value={latestData.humidity} unit="%" />
            <Card title="Zone 1 Pump" value={pumpLabel(pump1Status)} />
            <Card title="Zone 2 Pump" value={pumpLabel(pump2Status)} />
            <Card title="Zone 3 Pump" value={pumpLabel(pump3Status)} />
            <Card title="Last Update" value={formatDate(latestData.created_at)} />
            <StatusCard
              title="Device Status"
              value={deviceStatus.label}
              status={deviceStatus.status}
            />
          </section>

          <section className="panel">
            <h2>Control Panel</h2>

            <div className="control-grid">
              <ControlBox
                title="Zone 1 Pump"
                onTurnOn={() => controlPump(1, true)}
                onTurnOff={() => controlPump(1, false)}
              />

              <ControlBox
                title="Zone 2 Pump"
                onTurnOn={() => controlPump(2, true)}
                onTurnOff={() => controlPump(2, false)}
              />

              <ControlBox
                title="Zone 3 Pump"
                onTurnOn={() => controlPump(3, true)}
                onTurnOff={() => controlPump(3, false)}
              />
            </div>

            <div className="download-panel">
              <h3>Download CSV by Period</h3>

              <div className="date-filter-grid">
                <label>
                  From
                  <input
                    type="datetime-local"
                    value={csvStartDate}
                    onChange={(event) => setCsvStartDate(event.target.value)}
                  />
                </label>

                <label>
                  To
                  <input
                    type="datetime-local"
                    value={csvEndDate}
                    onChange={(event) => setCsvEndDate(event.target.value)}
                  />
                </label>
              </div>

              <div className="preset-row">
                <button className="secondary" onClick={() => setCsvPresetHours(1)}>
                  1 Hour
                </button>

                <button className="secondary" onClick={() => setCsvPresetHours(24)}>
                  24 Hours
                </button>

                <button
                  className="secondary"
                  onClick={() => setCsvPresetHours(24 * 7)}
                >
                  7 Days
                </button>

                <button
                  className="secondary"
                  onClick={() => setCsvPresetHours(24 * 30)}
                >
                  30 Days
                </button>

                <button className="secondary" onClick={clearCsvPeriod}>
                  All Data
                </button>

                <button onClick={downloadCSV}>Download CSV</button>

                <button onClick={downloadCctvData}>Download CCTV Data</button>

                <button onClick={downloadEsp32CamData}>
                  Download ESP32-CAM Data
                </button>
              </div>

              <p className="note">
                CSV will be generated from the sensor table based on the{" "}
                <b>created_at</b> column. CCTV and ESP32-CAM buttons will download
                captured image files as a ZIP based on the same selected period.
                If you choose “All Data”, the current temporary limit is 10,000 rows.
              </p>
            </div>

            <div className="action-row">
              <button className="danger" onClick={resetSystem}>
                Reset ESP + Mega
              </button>
            </div>

            <p className="note">
              The pump and reset buttons create commands with <b>pending</b> status in
              Supabase. The bridge reads the commands and forwards them to
              ThingsBoard/ESP.
            </p>
          </section>

          <section className="panel">
            <h2>Zone Summary</h2>

            <div className="zone-grid">
              {zoneSummaries.map((zone) => (
                <ZoneCard
                  key={zone.name}
                  name={zone.name}
                  sensors={zone.sensors}
                  value={zone.value}
                  pump={zone.pump}
                  pumpSource={zone.pumpSource}
                />
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Soil Moisture</h2>

            <div className="soil-grid">
              {soilSensors.map((sensor) => (
                <SoilCard
                  key={sensor.name}
                  name={sensor.name}
                  value={sensor.enabled ? latestData[sensor.key] : null}
                  enabled={sensor.enabled}
                  disabledText={sensor.disabledText}
                  statusText={sensor.statusText}
                />
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Real-Time Soil Moisture Chart</h2>
            <p className="note">Realtime - last 1 minute from Supabase</p>

            <SoilRealtimeChart data={chartData} />
          </section>

          <section className="panel">
            <h2>Air Temperature and Humidity Chart</h2>
            <p className="note">Realtime - last 1 minute from DHT22</p>

            <AirRealtimeChart data={chartData} />
          </section>

          <section className="panel">
            <h2>CCTV Realtime</h2>
            <CctvRealtimePanel />
          </section>

          <section className="panel">
            <h2>ESP32-CAM Realtime</h2>
            <Esp32CamPanel />
          </section>

          <section className="panel">
            <h2>Latest Data History</h2>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Temperature</th>
                    <th>Humidity</th>
                    <th>A0</th>
                    <th>A1</th>
                    <th>A2</th>
                    <th>A3</th>
                    <th>A4</th>
                    <th>A5</th>
                  </tr>
                </thead>

                <tbody>
                  {history.slice(0, 20).map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.created_at)}</td>
                      <td>{showValue(row.temperature)} °C</td>
                      <td>{showValue(row.humidity)} %</td>
                      <td>{showValue(row.soil_z1_s1)}%</td>
                      <td>{showValue(row.soil_z1_s2)}%</td>
                      <td>{showValue(row.soil_z2_s1)}%</td>
                      <td>{showValue(row.soil_z2_s2)}%</td>
                      <td>{showValue(row.soil_z3_s1)}%</td>
                      <td>Disabled</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>Command History</h2>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Command</th>
                    <th>Value</th>
                    <th>Status</th>
                    <th>Response</th>
                  </tr>
                </thead>

                <tbody>
                  {commands.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.created_at)}</td>
                      <td>{row.command}</td>
                      <td>{String(row.value)}</td>
                      <td>
                        <span className={`status ${row.status}`}>
                          {row.status}
                        </span>
                      </td>
                      <td>{translateCommandResponse(row.response)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>Capture CCTV</h2>

            {captures.length === 0 && (
              <p className="note">No CCTV captures available yet.</p>
            )}

            <div className="capture-grid">
              {captures.map((capture) => (
                <div className="capture-card" key={capture.id}>
                  <p>
                    <b>{capture.camera_id}</b> — {formatDate(capture.created_at)}
                  </p>

                  {capture.image_url ? (
                    <img src={capture.image_url} alt="CCTV capture" />
                  ) : (
                    <div className="capture-placeholder">
                      {capture.status || "pending"}
                    </div>
                  )}

                  <small>{capture.note || "-"}</small>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Card({ title, value, unit = "" }) {
  return (
    <div className="card">
      <p>{title}</p>
      <h2>
        {showValue(value)}
        <span>{unit}</span>
      </h2>
    </div>
  );
}

function StatusCard({ title, value, status }) {
  return (
    <div className={`card status-card ${status}`}>
      <p>{title}</p>
      <h2>{value}</h2>
    </div>
  );
}

function ControlBox({ title, onTurnOn, onTurnOff }) {
  return (
    <div className="control-box">
      <h3>{title}</h3>

      <div>
        <button onClick={onTurnOn}>ON</button>
        <button className="danger" onClick={onTurnOff}>
          OFF
        </button>
      </div>
    </div>
  );
}

function ZoneCard({ name, sensors, value, pump, pumpSource }) {
  const numberValue = Number(value || 0);
  const status = getSoilStatus(numberValue);
  const pumpText = pump ? "ON" : "OFF";
  const isPumpPending = pumpSource === "pending";

  return (
    <div className="zone-card">
      <div className="zone-top">
        <div>
          <h3>{name}</h3>
          <p>{sensors}</p>
        </div>

        <span className={`status ${pump ? "done" : "pending"}`}>
          Pump {pumpText}
          {isPumpPending ? "..." : ""}
        </span>
      </div>

      <h2>
        {showValue(value)}
        <span>%</span>
      </h2>

      <div className="bar">
        <div
          className={`bar-fill ${status.className}`}
          style={{ width: `${Math.min(numberValue, 100)}%` }}
        />
      </div>

      <p className={`soil-status ${status.className}`}>{status.label}</p>
    </div>
  );
}

function SoilCard({
  name,
  value,
  enabled = true,
  disabledText = "Disabled",
  statusText = "Not used",
}) {
  if (!enabled) {
    return (
      <div className="soil-card disabled-sensor">
        <div className="soil-header">
          <strong>Sensor {name}</strong>
          <span>{disabledText}</span>
        </div>

        <div className="bar">
          <div
            className="bar-fill"
            style={{ width: "100%", backgroundColor: "#475569" }}
          />
        </div>

        <p className="soil-status">{statusText}</p>
      </div>
    );
  }

  const numberValue = Number(value || 0);
  const status = getSoilStatus(numberValue);

  return (
    <div className="soil-card">
      <div className="soil-header">
        <strong>Sensor {name}</strong>
        <span>{showValue(value)}%</span>
      </div>

      <div className="bar">
        <div
          className={`bar-fill ${status.className}`}
          style={{ width: `${Math.min(numberValue, 100)}%` }}
        />
      </div>

      <p className={`soil-status ${status.className}`}>{status.label}</p>
    </div>
  );
}

function SoilRealtimeChart({ data }) {
  if (!data || data.length === 0) {
    return <p className="note">No data available for the soil moisture chart.</p>;
  }

  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={420}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="time" stroke="#94a3b8" />
          <YAxis domain={[0, 100]} stroke="#94a3b8" />
          <Tooltip
            contentStyle={{
              background: "#020617",
              border: "1px solid #334155",
              color: "#e5e7eb",
            }}
          />
          <Legend />

          <Line type="linear" dataKey="A0" stroke="#38bdf8" dot={false} connectNulls />
          <Line type="linear" dataKey="A1" stroke="#22c55e" dot={false} connectNulls />
          <Line type="linear" dataKey="A2" stroke="#ef4444" dot={false} connectNulls />
          <Line type="linear" dataKey="A3" stroke="#facc15" dot={false} connectNulls />
          <Line type="linear" dataKey="A4" stroke="#94a3b8" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function AirRealtimeChart({ data }) {
  if (!data || data.length === 0) {
    return <p className="note">No data available for the air temperature and humidity chart.</p>;
  }

  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="time" stroke="#94a3b8" />
          <YAxis stroke="#94a3b8" />
          <Tooltip
            contentStyle={{
              background: "#020617",
              border: "1px solid #334155",
              color: "#e5e7eb",
            }}
          />
          <Legend />

          <Line
            type="linear"
            dataKey="temperature"
            name="Temperature °C"
            stroke="#38bdf8"
            dot={false}
            connectNulls
          />

          <Line
            type="linear"
            dataKey="humidity"
            name="Humidity %"
            stroke="#22c55e"
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CctvRealtimePanel() {
  const CCTV_URL = import.meta.env.VITE_CCTV_ZONE_1_URL || "/api/cctv-proxy";
  const [refreshKey, setRefreshKey] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setRefreshKey(Date.now());
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  const imageUrl = `${CCTV_URL}?t=${refreshKey}`;

  return (
    <div className="cctv-live-layout">
      <div className="cctv-wrapper">
        <img
          src={imageUrl}
          alt="CCTV Zone 1 Realtime"
          onError={() => {
            console.error("CCTV failed to load:", imageUrl);
          }}
        />
      </div>

      <div className="cctv-info">
        <h3>Zone 1 Live Camera</h3>

        <p>
          Status: <b>Connected</b>
        </p>

        <p>Source:</p>
        <code>{CCTV_URL}</code>

        <p className="note" style={{ marginTop: "14px" }}>
          Mode: snapshot refresh every 3 seconds.
        </p>
      </div>
    </div>
  );
}

function CctvRealtimePanel() {
  const RAW_CCTV_URL =
    import.meta.env.VITE_CCTV_ZONE_1_URL ||
    "https://string-efficiently-shaft-xbox.trycloudflare.com/cctv.jpg";

  const CCTV_URL = (() => {
    const cleanUrl = String(RAW_CCTV_URL).trim().replace(/\/$/, "");

    if (
      cleanUrl.includes("trycloudflare.com") &&
      !cleanUrl.match(/\.(jpg|jpeg|png|webp)$/i)
    ) {
      return `${cleanUrl}/cctv.jpg`;
    }

    return cleanUrl;
  })();

  const [refreshKey, setRefreshKey] = useState(Date.now());
  const [imageStatus, setImageStatus] = useState("loading");

  useEffect(() => {
    const timer = setInterval(() => {
      setImageStatus("loading");
      setRefreshKey(Date.now());
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  const imageUrl = `${CCTV_URL}${CCTV_URL.includes("?") ? "&" : "?"}t=${refreshKey}`;

  return (
    <div className="cctv-live-layout">
      <div className="cctv-wrapper">
        <img
          src={imageUrl}
          alt="CCTV Zone 1 Realtime"
          onLoad={() => setImageStatus("connected")}
          onError={() => {
            setImageStatus("error");
            console.error("CCTV failed to load:", imageUrl);
          }}
        />
      </div>

      <div className="cctv-info">
        <h3>Zone 1 Live Camera</h3>

        <p>
          Status:{" "}
          <b style={{ color: imageStatus === "error" ? "#ef4444" : "#22c55e" }}>
            {imageStatus === "error" ? "Error" : "Connected"}
          </b>
        </p>

        <p>Source:</p>
        <code>{CCTV_URL}</code>

        {imageStatus === "error" && (
          <p className="note" style={{ marginTop: "14px", color: "#f87171" }}>
            CCTV image failed to load. Open the source URL directly. If it does
            not show an image, restart the CCTV Cloudflare tunnel.
          </p>
        )}

        <p className="note" style={{ marginTop: "14px" }}>
          Mode: snapshot refresh every 3 seconds.
        </p>
      </div>
    </div>
  );
}

function Esp32CamPanel() {
  const RAW_ESP32_BASE_URL =
    import.meta.env.VITE_ESP32_CAM_BASE_URL ||
    "https://achievement-cricket-all-robot.trycloudflare.com";

  const ESP32_CAM_BASE_URL = String(RAW_ESP32_BASE_URL)
    .trim()
    .replace(/\/$/, "")
    .replace(/\/jpg$/, "")
    .replace(/\/esp32cam\.jpg$/, "");

  const RAW_ESP32_IMAGE_URL =
    import.meta.env.VITE_ESP32_CAM_URL || `${ESP32_CAM_BASE_URL}/jpg`;

  const ESP32_CAM_URL = (() => {
    const cleanUrl = String(RAW_ESP32_IMAGE_URL).trim().replace(/\/$/, "");

    if (cleanUrl.endsWith("/jpg")) {
      return cleanUrl;
    }

    if (cleanUrl.endsWith("/esp32cam.jpg")) {
      return cleanUrl.replace(/\/esp32cam\.jpg$/, "/jpg");
    }

    if (
      cleanUrl.includes("trycloudflare.com") &&
      !cleanUrl.match(/\.(jpg|jpeg|png|webp)$/i)
    ) {
      return `${cleanUrl}/jpg`;
    }

    return cleanUrl;
  })();

  const [refreshKey, setRefreshKey] = useState(Date.now());
  const [flashLoading, setFlashLoading] = useState(false);
  const [flashMessage, setFlashMessage] = useState("");
  const [imageStatus, setImageStatus] = useState("loading");

  useEffect(() => {
    const interval = setInterval(() => {
      setImageStatus("loading");
      setRefreshKey(Date.now());
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const imageUrl = `${ESP32_CAM_URL}${ESP32_CAM_URL.includes("?") ? "&" : "?"}t=${refreshKey}`;

  async function controlEsp32Flash(state) {
    const requestUrl = `${ESP32_CAM_BASE_URL}/flash/${state}`;

    try {
      setFlashLoading(true);
      setFlashMessage(`Sending Flash ${state.toUpperCase()}...`);

      const response = await fetch(requestUrl, {
        method: "GET",
        cache: "no-store",
      });

      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          `ESP32-CAM flash request failed. Status: ${response.status}. URL: ${requestUrl}`
        );
      }

      setFlashMessage(`Flash ${state.toUpperCase()} successful.`);
      console.log("ESP32-CAM flash success:", text);
    } catch (error) {
      console.error("ESP32-CAM flash error:", error);
      setFlashMessage(error.message || `Flash ${state} failed.`);
    } finally {
      setFlashLoading(false);
    }
  }

  return (
    <div className="cctv-live-layout">
      <div className="cctv-wrapper">
        <img
          src={imageUrl}
          alt="ESP32-CAM Realtime"
          onLoad={() => setImageStatus("connected")}
          onError={() => {
            setImageStatus("error");
            console.error("ESP32-CAM failed to load:", imageUrl);
          }}
        />
      </div>

      <div className="cctv-info">
        <h3>ESP32-CAM Additional Camera</h3>

        <p>
          Status:{" "}
          <b style={{ color: imageStatus === "error" ? "#ef4444" : "#22c55e" }}>
            {imageStatus === "error" ? "Error" : "Connected"}
          </b>
        </p>

        <p>Source:</p>
        <code>{ESP32_CAM_URL}</code>

        <div className="action-row" style={{ marginTop: "14px" }}>
          <button
            type="button"
            disabled={flashLoading}
            onClick={() => controlEsp32Flash("on")}
          >
            {flashLoading ? "Loading..." : "Flash ON"}
          </button>

          <button
            type="button"
            className="danger"
            disabled={flashLoading}
            onClick={() => controlEsp32Flash("off")}
          >
            {flashLoading ? "Loading..." : "Flash OFF"}
          </button>
        </div>

        {flashMessage && <p className="note">{flashMessage}</p>}

        {imageStatus === "error" && (
          <p className="note" style={{ marginTop: "14px", color: "#f87171" }}>
            ESP32-CAM image failed to load. Open the source URL directly. If it
            does not show an image, restart the ESP32-CAM Cloudflare tunnel.
          </p>
        )}

        <p className="note" style={{ marginTop: "14px" }}>
          Mode: snapshot refresh every 3 seconds.
        </p>
      </div>
    </div>
  );
}

function hasImageReference(row) {
  return Boolean(
    getFirstStringValue(row, IMAGE_URL_COLUMNS) ||
      getFirstStringValue(row, IMAGE_PATH_COLUMNS)
  );
}

function isEsp32CaptureRow(row) {
  const searchableText = [
    row?.camera_id,
    row?.device_id,
    row?.source,
    row?.type,
    row?.name,
    row?.note,
    row?.payload?.camera_id,
    row?.payload?.device_id,
    row?.payload?.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    searchableText.includes("esp32") ||
    searchableText.includes("esp32-cam") ||
    searchableText.includes("esp32cam")
  );
}

function getFirstStringValue(row, columns) {
  for (const column of columns) {
    const value =
      row?.[column] ??
      row?.payload?.[column] ??
      row?.metadata?.[column] ??
      row?.data?.[column];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

async function getImageBlobFromRow(row, defaultBucket) {
  const storageReference = getStorageReferenceFromRow(row, defaultBucket);

  if (storageReference && supabase) {
    const { data, error } = await supabase.storage
      .from(storageReference.bucket)
      .download(storageReference.path);

    if (!error && data) {
      return {
        blob: data,
        sourceName: storageReference.path,
      };
    }

    console.warn("Supabase Storage download failed. Trying image URL instead.", {
      error,
      storageReference,
      row,
    });
  }

  const imageUrl = getFirstStringValue(row, IMAGE_URL_COLUMNS);

  if (!imageUrl) {
    return null;
  }

  const response = await fetch(imageUrl, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Image URL download failed with status ${response.status}`);
  }

  const blob = await response.blob();

  return {
    blob,
    sourceName: imageUrl,
  };
}

function getStorageReferenceFromRow(row, defaultBucket) {
  const imageUrl = getFirstStringValue(row, IMAGE_URL_COLUMNS);
  const parsedFromUrl = parseSupabaseStorageUrl(imageUrl);

  if (parsedFromUrl) {
    return parsedFromUrl;
  }

  const bucket = getFirstStringValue(row, IMAGE_BUCKET_COLUMNS) || defaultBucket;
  let path = getFirstStringValue(row, IMAGE_PATH_COLUMNS);

  if (!bucket || !path) {
    return null;
  }

  path = path.replace(/^\/+/, "");

  if (path.startsWith(`${bucket}/`)) {
    path = path.slice(bucket.length + 1);
  }

  return {
    bucket,
    path,
  };
}

function parseSupabaseStorageUrl(url) {
  if (!url || !url.includes("/storage/v1/object/")) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const publicMarker = "/storage/v1/object/public/";
    const signedMarker = "/storage/v1/object/sign/";

    let objectPath = "";

    if (parsedUrl.pathname.includes(publicMarker)) {
      objectPath = parsedUrl.pathname.split(publicMarker)[1];
    } else if (parsedUrl.pathname.includes(signedMarker)) {
      objectPath = parsedUrl.pathname.split(signedMarker)[1];
    }

    if (!objectPath) {
      return null;
    }

    const decodedPath = decodeURIComponent(objectPath);
    const [bucket, ...pathParts] = decodedPath.split("/");
    const path = pathParts.join("/");

    if (!bucket || !path) {
      return null;
    }

    return {
      bucket,
      path,
    };
  } catch {
    return null;
  }
}

function buildImageFilename(row, sourceName, index) {
  const date = row?.created_at ? new Date(row.created_at) : new Date();
  const safeDate = Number.isNaN(date.getTime())
    ? `image-${index}`
    : date.toISOString().replaceAll(":", "-").replaceAll(".", "-");

  const sourceFilename = getFilenameFromSource(sourceName);
  const extension = getFileExtension(sourceFilename) || "png";
  const baseName = removeFileExtension(sourceFilename) || `capture-${row?.id || index}`;

  return `${safeDate}_${sanitizeFilename(baseName)}.${extension}`;
}

function getFilenameFromSource(sourceName) {
  if (!sourceName) return "";

  try {
    if (sourceName.startsWith("http://") || sourceName.startsWith("https://")) {
      const url = new URL(sourceName);
      const pathParts = url.pathname.split("/").filter(Boolean);
      return pathParts[pathParts.length - 1] || "";
    }

    const pathParts = sourceName.split("/").filter(Boolean);
    return pathParts[pathParts.length - 1] || "";
  } catch {
    const pathParts = String(sourceName).split("/").filter(Boolean);
    return pathParts[pathParts.length - 1] || "";
  }
}

function getFileExtension(filename) {
  const match = String(filename || "").match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function removeFileExtension(filename) {
  return String(filename || "").replace(/\.[a-zA-Z0-9]+$/, "");
}

function sanitizeFilename(value) {
  return String(value || "capture")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

function saveBlobAsFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getSoilStatus(value) {
  if (value <= 30) {
    return {
      label: "Dry",
      className: "dry",
    };
  }

  if (value <= 70) {
    return {
      label: "Normal",
      className: "normal",
    };
  }

  return {
    label: "Wet",
    className: "wet",
  };
}

function average(values) {
  const validValues = values
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value));

  if (validValues.length === 0) return null;

  const total = validValues.reduce((sum, value) => sum + value, 0);
  return Math.round(total / validValues.length);
}

function toChartNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? null : numberValue;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function toDateTimeLocalInput(date) {
  const pad = (number) => String(number).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function showValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  return value;
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("en-US");
}

function formatTime(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getDeviceStatus(data) {
  if (!data?.created_at) {
    return {
      label: "Unknown",
      status: "unknown",
    };
  }

  const lastUpdate = new Date(data.created_at).getTime();

  if (Number.isNaN(lastUpdate)) {
    return {
      label: "Unknown",
      status: "unknown",
    };
  }

  const now = Date.now();
  const diffSeconds = Math.floor((now - lastUpdate) / 1000);

  if (diffSeconds <= 60) {
    return {
      label: "Online",
      status: "online",
    };
  }

  if (diffSeconds <= 180) {
    return {
      label: "Delay",
      status: "delay",
    };
  }

  return {
    label: "Offline",
    status: "offline",
  };
}

function getPumpDisplayStatus(latestData, commands, pumpNumber) {
  const telemetryValue = getPumpTelemetryValue(latestData, pumpNumber);
  const commandName = `pump_${pumpNumber}`;

  const latestCommand = commands.find(
    (command) =>
      command.command === commandName &&
      ["pending", "processing", "done"].includes(command.status)
  );

  if (!latestCommand) {
    return {
      value: telemetryValue,
      source: "telemetry",
    };
  }

  const commandValue = toBooleanValue(latestCommand.value);

  return {
    value: commandValue,
    source: latestCommand.status,
  };
}

function getPumpTelemetryValue(latestData, pumpNumber) {
  if (!latestData) return false;

  const directValue = latestData[`pump_${pumpNumber}`];

  if (directValue !== null && directValue !== undefined) {
    return toBooleanValue(directValue);
  }

  const statusValue = latestData[`pump_z${pumpNumber}_status`];

  return toBooleanValue(statusValue);
}

function pumpLabel(pumpStatus) {
  const label = pumpStatus?.value ? "ON" : "OFF";

  if (pumpStatus?.source === "pending" || pumpStatus?.source === "processing") {
    return `${label}...`;
  }

  return label;
}

function toBooleanValue(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (value === 1) return true;
  if (value === 0) return false;

  const text = String(value ?? "").trim().toLowerCase();

  return text === "true" || text === "on" || text === "1";
}

function translateCommandResponse(response) {
  if (!response) return "-";

  return String(response)
    .replaceAll("berhasil dikirim.", "sent successfully.")
    .replaceAll("berhasil dikirim", "sent successfully")
    .replaceAll("RPC ThingsBoard gagal:", "ThingsBoard RPC failed:")
    .replaceAll("ThingsBoard gagal:", "ThingsBoard failed:")
    .replaceAll("gagal.", "failed.")
    .replaceAll("gagal", "failed");
}

export default App;