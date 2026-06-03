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

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isSupabaseReady = Boolean(supabaseUrl && supabaseAnonKey);

const supabase = isSupabaseReady
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const SENSOR_TABLE = "sensor_readings";
const COMMAND_TABLE = "device_commands";
const CAMERA_TABLE = "camera_captures";

const REALTIME_WINDOW_MS = 60 * 1000; // last 1 minute
const DASHBOARD_POLL_MS = 3000; // refresh every 3 seconds

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
        "Supabase belum dikonfigurasi. Periksa VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY."
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
      setErrorMessage(error.message || "Gagal mengambil data.");
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
      setActionMessage("Supabase belum siap. Periksa konfigurasi environment.");
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
      setActionMessage(`Gagal membuat command: ${error.message}`);
      return;
    }

    if (data) {
      setCommands((previousCommands) => [data, ...previousCommands].slice(0, 20));
    }

    setActionMessage(`Command "${command}" berhasil dikirim ke Supabase.`);
    fetchCommands();
  }

  async function controlPump(pumpNumber, value) {
    await sendCommand(`pump_${pumpNumber}`, value, {
      pump: pumpNumber,
      action: value ? "ON" : "OFF",
    });
  }

  async function requestCameraCapture() {
    await sendCommand("capture_camera_zone_1", true, {
      camera_id: "zone_1",
      action: "capture",
    });
  }

  async function resetSystem() {
    const confirmed = window.confirm(
      "Reset ESP8266 dan Arduino Mega sekarang? Sistem akan terputus beberapa detik."
    );

    if (!confirmed) {
      return;
    }

    await sendCommand("reset_system", true, {
      action: "RESET_ESP_AND_MEGA",
      note: "Soft reset requested from web dashboard",
    });
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
      setActionMessage("Supabase belum siap. Periksa konfigurasi environment.");
      return;
    }

    setActionMessage("");

    const startDate = csvStartDate ? new Date(csvStartDate) : null;
    const endDate = csvEndDate ? new Date(csvEndDate) : null;

    if (startDate && Number.isNaN(startDate.getTime())) {
      setActionMessage("Tanggal awal tidak valid.");
      return;
    }

    if (endDate && Number.isNaN(endDate.getTime())) {
      setActionMessage("Tanggal akhir tidak valid.");
      return;
    }

    if (startDate && endDate && startDate > endDate) {
      setActionMessage("Tanggal awal tidak boleh lebih besar dari tanggal akhir.");
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
      setActionMessage(`Gagal download CSV: ${error.message}`);
      return;
    }

    if (!data || data.length === 0) {
      setActionMessage("Tidak ada data pada periode yang dipilih.");
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
      "soil_a5",
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

    const startLabel = csvStartDate || "awal";
    const endLabel = csvEndDate || "akhir";
    const periodLabel = `${startLabel}_to_${endLabel}`
      .replaceAll(":", "-")
      .replaceAll("T", "_");

    link.href = url;
    link.download = `smart-farm-sensor-data-${periodLabel}.csv`;
    link.click();

    URL.revokeObjectURL(url);

    setActionMessage(
      `CSV berhasil di-download. Jumlah data: ${data.length} baris.`
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
  { name: "A0", key: "soil_z1_s1" },
  { name: "A1", key: "soil_z1_s2" },
  { name: "A2", key: "soil_z2_s1" },
  { name: "A3", key: "soil_z2_s2" },
  { name: "A4", key: "soil_z3_s1" },
  { name: "A5", key: "soil_z3_s2" },
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
  A5: toChartNumber(row.soil_z3_s2),

  zona1: average([row.soil_z1_s1, row.soil_z1_s2]),
  zona2: average([row.soil_z2_s1, row.soil_z2_s2]),
  zona3: average([row.soil_z3_s1, row.soil_z3_s2]),
}));

  const deviceStatus = getDeviceStatus(latestData);

  const pump1Status = getPumpDisplayStatus(latestData, commands, 1);
  const pump2Status = getPumpDisplayStatus(latestData, commands, 2);
  const pump3Status = getPumpDisplayStatus(latestData, commands, 3);


  const zoneSummaries = latestData
  ? [
      {
        name: "Zona 1",
        sensors: "A0 + A1",
        value: average([latestData.soil_z1_s1, latestData.soil_z1_s2]),
        pump: pump1Status.value,
        pumpSource: pump1Status.source,
      },
      {
        name: "Zona 2",
        sensors: "A2 + A3",
        value: average([latestData.soil_z2_s1, latestData.soil_z2_s2]),
        pump: pump2Status.value,
        pumpSource: pump2Status.source,
      },
      {
        name: "Zona 3",
        sensors: "A4 + A5",
        value: average([latestData.soil_z3_s1, latestData.soil_z3_s2]),
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
            Monitoring sensor, grafik realtime, status pompa, command kontrol,
            download data, reset system, dan request capture CCTV.
          </p>
        </div>

        <button onClick={() => fetchAllData(true)}>Refresh Data</button>
      </section>

      {loading && <p className="info">Mengambil data dari Supabase...</p>}

      {errorMessage && (
        <div className="error">
          <b>Gagal mengambil data:</b>
          <p>{errorMessage}</p>
        </div>
      )}

      {actionMessage && <div className="message">{actionMessage}</div>}

      {!loading && !latestData && !errorMessage && (
        <div className="empty">
          Belum ada data sensor di tabel <code>{SENSOR_TABLE}</code>.
        </div>
      )}

      {latestData && (
        <>
          <section className="grid">
            <Card title="Suhu Udara" value={latestData.temperature} unit="°C" />
            <Card title="Kelembapan Udara" value={latestData.humidity} unit="%" />
            <Card title="Pompa Zona 1" value={pumpLabel(pump1Status)} />
            <Card title="Pompa Zona 2" value={pumpLabel(pump2Status)} />
            <Card title="Pompa Zona 3" value={pumpLabel(pump3Status)} />
            <Card title="Update Terakhir" value={formatDate(latestData.created_at)} />
            <StatusCard
              title="Status Device"
              value={deviceStatus.label}
              status={deviceStatus.status}
            />
          </section>

          <section className="panel">
            <h2>Control Panel</h2>

            <div className="control-grid">
              <ControlBox
                title="Pompa Zona 1"
                onTurnOn={() => controlPump(1, true)}
                onTurnOff={() => controlPump(1, false)}
              />

              <ControlBox
                title="Pompa Zona 2"
                onTurnOn={() => controlPump(2, true)}
                onTurnOff={() => controlPump(2, false)}
              />

              <ControlBox
                title="Pompa Zona 3"
                onTurnOn={() => controlPump(3, true)}
                onTurnOff={() => controlPump(3, false)}
              />
            </div>

            <div className="download-panel">
              <h3>Download CSV Berdasarkan Periode</h3>

              <div className="date-filter-grid">
                <label>
                  Dari
                  <input
                    type="datetime-local"
                    value={csvStartDate}
                    onChange={(event) => setCsvStartDate(event.target.value)}
                  />
                </label>

                <label>
                  Sampai
                  <input
                    type="datetime-local"
                    value={csvEndDate}
                    onChange={(event) => setCsvEndDate(event.target.value)}
                  />
                </label>
              </div>

              <div className="preset-row">
                <button className="secondary" onClick={() => setCsvPresetHours(1)}>
                  1 Jam
                </button>

                <button className="secondary" onClick={() => setCsvPresetHours(24)}>
                  24 Jam
                </button>

                <button className="secondary" onClick={() => setCsvPresetHours(24 * 7)}>
                  7 Hari
                </button>

                <button className="secondary" onClick={() => setCsvPresetHours(24 * 30)}>
                  30 Hari
                </button>

                <button className="secondary" onClick={clearCsvPeriod}>
                  Semua Data
                </button>

                <button onClick={downloadCSV}>Download CSV</button>
              </div>

              <p className="note">
                CSV akan diambil dari tabel sensor berdasarkan kolom{" "}
                <b>created_at</b>. Jika memilih “Semua Data”, batas maksimal
                sementara adalah 10.000 baris.
              </p>
            </div>

            <div className="action-row">
              <button onClick={requestCameraCapture}>Capture CCTV Zone 1</button>

              <button className="danger" onClick={resetSystem}>
                Reset ESP + Mega
              </button>
            </div>

            <p className="note">
              Tombol kontrol membuat command dengan status <b>pending</b> di
              Supabase. Command dibaca oleh bridge lalu diteruskan ke
              ThingsBoard/ESP.
            </p>
          </section>

          <section className="panel">
            <h2>Ringkasan Zona</h2>

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
            <h2>Kelembapan Tanah</h2>

            <div className="soil-grid">
              {soilSensors.map((sensor) => (
                <SoilCard
                  key={sensor.key}
                  name={sensor.name}
                  value={latestData[sensor.key]}
                />
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Grafik Realtime Kelembapan Tanah</h2>
            <p className="note">
              Realtime - last 1 minute from Supabase
            </p>

            <SoilRealtimeChart data={chartData} />
          </section>

          <section className="panel">
            <h2>Grafik Suhu dan Kelembapan Udara</h2>
            <p className="note">
              Realtime - last 1 minute from DHT22
            </p>

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
            <h2>Riwayat Data Terbaru</h2>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Suhu</th>
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
                      <td>{showValue(row.soil_z3_s2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>Riwayat Command</h2>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Waktu</th>
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
                      <td>{row.response || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>Capture CCTV</h2>

            {captures.length === 0 && (
              <p className="note">Belum ada hasil capture CCTV.</p>
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

function SoilCard({ name, value }) {
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
    return <p className="note">Belum ada data untuk grafik kelembapan tanah.</p>;
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

          <Line type="monotone" dataKey="A0" stroke="#38bdf8" dot={false} connectNulls />
          <Line type="monotone" dataKey="A1" stroke="#22c55e" dot={false} connectNulls />
          <Line type="monotone" dataKey="A2" stroke="#ef4444" dot={false} connectNulls />
          <Line type="monotone" dataKey="A3" stroke="#facc15" dot={false} connectNulls />
          <Line type="monotone" dataKey="A4" stroke="#94a3b8" dot={false} connectNulls />
          <Line type="monotone" dataKey="A5" stroke="#a855f7" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function AirRealtimeChart({ data }) {
  if (!data || data.length === 0) {
    return <p className="note">Belum ada data untuk grafik suhu dan humidity.</p>;
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
            type="monotone"
            dataKey="temperature"
            name="Temperature °C"
            stroke="#38bdf8"
            dot={false}
            connectNulls
          />

          <Line
            type="monotone"
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
  const CCTV_URL = import.meta.env.VITE_CCTV_ZONE_1_URL || "";

  if (!CCTV_URL) {
    return (
      <div className="cctv-placeholder">
        <h3>CCTV Zone 1 belum disambungkan</h3>
        <p>
          Panel ini disiapkan untuk menampilkan stream realtime CCTV. Jika kamera
          hanya menyediakan RTSP, diperlukan bridge di server/Ubuntu untuk
          mengubah RTSP menjadi MJPEG/HLS agar bisa tampil di browser.
        </p>
      </div>
    );
  }

  return (
    <div className="cctv-live-layout">
      <div className="cctv-wrapper">
        <img src={CCTV_URL} alt="CCTV Zone 1 Realtime" />
      </div>

      <div className="cctv-info">
        <h3>Zone 1 Live Camera</h3>
        <p>
          Status: <b>Connected</b>
        </p>
        <p>Source:</p>
        <code>{CCTV_URL}</code>
      </div>
    </div>
  );
}

function Esp32CamPanel() {
  const ESP32_CAM_URL = import.meta.env.VITE_ESP32_CAM_URL || "";
  const [refreshKey, setRefreshKey] = useState(Date.now());

  useEffect(() => {
    if (!ESP32_CAM_URL) return;

    const interval = setInterval(() => {
      setRefreshKey(Date.now());
    }, 1500);

    return () => clearInterval(interval);
  }, [ESP32_CAM_URL]);

  if (!ESP32_CAM_URL) {
    return (
      <div className="cctv-placeholder">
        <h3>ESP32-CAM belum disambungkan</h3>
        <p>
          Masukkan URL ESP32-CAM ke file .env dengan nama VITE_ESP32_CAM_URL.
        </p>
      </div>
    );
  }
  
  const isVercelWebsite = window.location.hostname.includes("vercel.app");

  const imageUrl = isVercelWebsite
    ? `/api/esp32cam?t=${refreshKey}`
    : `${ESP32_CAM_URL}?t=${refreshKey}`;

  return (
    <div className="cctv-live-layout">
      <div className="cctv-wrapper">
        <img src={imageUrl} alt="ESP32-CAM Realtime" />
      </div>

      <div className="cctv-info">
        <h3>ESP32-CAM Additional Camera</h3>
        <p>
          Status: <b>Connected</b>
        </p>
        <p>Source:</p>
        <code>{ESP32_CAM_URL}</code>
      </div>
    </div>
  );
}

function getSoilStatus(value) {
  if (value <= 30) {
    return {
      label: "Kering",
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
    label: "Basah",
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

  return date.toLocaleString("id-ID");
}

function formatTime(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleTimeString("id-ID", {
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

export default App;