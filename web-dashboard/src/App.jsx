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

function App() {
  const [latestData, setLatestData] = useState(null);
  const [history, setHistory] = useState([]);
  const [commands, setCommands] = useState([]);
  const [captures, setCaptures] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");

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
      .limit(60);

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
      .limit(10);

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

    const { error } = await supabase.from(COMMAND_TABLE).insert({
      device_id: "esp8266-zone-1",
      command,
      value,
      payload,
      status: "pending",
      source: "web-dashboard",
    });

    if (error) {
      setActionMessage(`Gagal membuat command: ${error.message}`);
      return;
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

  async function downloadCSV() {
    if (!supabase) {
      setActionMessage("Supabase belum siap. Periksa konfigurasi environment.");
      return;
    }

    const { data, error } = await supabase
      .from(SENSOR_TABLE)
      .select("*")
      .not("soil_a0", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      setActionMessage(`Gagal download CSV: ${error.message}`);
      return;
    }

    if (!data || data.length === 0) {
      setActionMessage("Belum ada data untuk di-download.");
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
        columns.map((column) => `"${row[column] ?? ""}"`).join(",")
      ),
    ];

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `smart-farm-sensor-data-${Date.now()}.csv`;
    link.click();

    URL.revokeObjectURL(url);

    setActionMessage("CSV berhasil dibuat dan di-download.");
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

    const interval = setInterval(() => fetchAllData(false), 10000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const soilSensors = [
    { name: "A0", key: "soil_a0" },
    { name: "A1", key: "soil_a1" },
    { name: "A2", key: "soil_a2" },
    { name: "A3", key: "soil_a3" },
    { name: "A4", key: "soil_a4" },
    { name: "A5", key: "soil_a5" },
  ];

  const zoneSummaries = latestData
    ? [
        {
          name: "Zona 1",
          sensors: "A0 + A1",
          value: average([latestData.soil_a0, latestData.soil_a1]),
          pump: latestData.pump_1,
        },
        {
          name: "Zona 2",
          sensors: "A2 + A3",
          value: average([latestData.soil_a2, latestData.soil_a3]),
          pump: latestData.pump_2,
        },
        {
          name: "Zona 3",
          sensors: "A4 + A5",
          value: average([latestData.soil_a4, latestData.soil_a5]),
          pump: latestData.pump_3,
        },
      ]
    : [];

  const chartData = [...history].reverse().map((row) => ({
    time: formatTime(row.created_at),

    temperature: toChartNumber(row.temperature),
    humidity: toChartNumber(row.humidity),

    A0: toChartNumber(row.soil_a0),
    A1: toChartNumber(row.soil_a1),
    A2: toChartNumber(row.soil_a2),
    A3: toChartNumber(row.soil_a3),
    A4: toChartNumber(row.soil_a4),
    A5: toChartNumber(row.soil_a5),

    zona1: average([row.soil_a0, row.soil_a1]),
    zona2: average([row.soil_a2, row.soil_a3]),
    zona3: average([row.soil_a4, row.soil_a5]),
  }));

  const deviceStatus = getDeviceStatus(latestData);

  return (
    <main className="dashboard">
      <section className="hero">
        <div>
          <p className="label">Smart Farm Monitoring</p>
          <h1>Growth Monitoring Dashboard</h1>
          <p className="subtitle">
            Monitoring sensor, grafik realtime, status pompa, command kontrol,
            download data, dan request capture CCTV.
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
            <Card title="Pompa Zona 1" value={latestData.pump_1 ? "ON" : "OFF"} />
            <Card title="Pompa Zona 2" value={latestData.pump_2 ? "ON" : "OFF"} />
            <Card title="Pompa Zona 3" value={latestData.pump_3 ? "ON" : "OFF"} />
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

            <div className="action-row">
              <button onClick={downloadCSV}>Download Data CSV</button>
              <button onClick={requestCameraCapture}>Capture CCTV Zone 1</button>
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
              Menampilkan data 60 pembacaan terbaru dari Supabase.
            </p>

            <SoilRealtimeChart data={chartData} />
          </section>

          <section className="panel">
            <h2>Grafik Suhu dan Kelembapan Udara</h2>
            <p className="note">
              Menampilkan perubahan suhu dan kelembapan udara dari DHT22.
            </p>

            <AirRealtimeChart data={chartData} />
          </section>

          <section className="panel">
            <h2>CCTV Realtime</h2>
            <CctvRealtimePanel />
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
                      <td>{showValue(row.soil_a0)}%</td>
                      <td>{showValue(row.soil_a1)}%</td>
                      <td>{showValue(row.soil_a2)}%</td>
                      <td>{showValue(row.soil_a3)}%</td>
                      <td>{showValue(row.soil_a4)}%</td>
                      <td>{showValue(row.soil_a5)}%</td>
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

function ZoneCard({ name, sensors, value, pump }) {
  const numberValue = Number(value || 0);
  const status = getSoilStatus(numberValue);

  return (
    <div className="zone-card">
      <div className="zone-top">
        <div>
          <h3>{name}</h3>
          <p>{sensors}</p>
        </div>

        <span className={`status ${pump ? "done" : "pending"}`}>
          Pump {pump ? "ON" : "OFF"}
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

export default App;