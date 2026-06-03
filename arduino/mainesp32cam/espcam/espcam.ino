#include "esp_camera.h"
#include "img_converters.h"
#include <WiFi.h>
#include <WebServer.h>

// =======================
// WIFI
// =======================
// Ganti kalau nama/password WiFi berbeda
const char* ssid = "qwertyuiop";
const char* password = "00000000";

// =======================
// PIN ESP32-CAM AI THINKER / ESP32 WROVER CAMERA
// =======================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5

#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

#define FLASH_LED_PIN      4

WebServer server(80);

// =======================
// HALAMAN WEB
// =======================
void handleRoot() {
  String html = R"rawliteral(
  <!DOCTYPE html>
  <html>
  <head>
    <title>ESP32-CAM RGB565 Test</title>
    <style>
      body {
        background: #111;
        color: white;
        font-family: Arial;
        text-align: center;
        margin: 0;
        padding: 20px;
      }

      h2 {
        margin-bottom: 8px;
      }

      p {
        margin-top: 0;
        color: #cccccc;
      }

      img {
        width: 320px;
        max-width: 90%;
        border: 3px solid white;
        border-radius: 10px;
      }

      button {
        padding: 12px 20px;
        margin: 8px;
        font-size: 16px;
        cursor: pointer;
      }
    </style>
  </head>

  <body>
    <h2>ESP32-CAM Test</h2>
    <p>Mode: RGB565 lalu convert ke JPG</p>

    <img id="cam" src="/jpg">

    <br><br>

    <button onclick="location.href='/flash/on'">Flash ON</button>
    <button onclick="location.href='/flash/off'">Flash OFF</button>

    <script>
      setInterval(() => {
        document.getElementById("cam").src = "/jpg?t=" + new Date().getTime();
      }, 1500);
    </script>
  </body>
  </html>
  )rawliteral";

  server.send(200, "text/html", html);
}

// =======================
// AMBIL GAMBAR
// =======================
void handleJpg() {
  camera_fb_t *fb = esp_camera_fb_get();

  if (!fb) {
    Serial.println("Gagal ambil gambar");
    server.send(500, "text/plain", "Camera capture failed");
    return;
  }

  uint8_t *jpg_buf = NULL;
  size_t jpg_len = 0;

  bool converted = fmt2jpg(
    fb->buf,
    fb->len,
    fb->width,
    fb->height,
    fb->format,
    80,
    &jpg_buf,
    &jpg_len
  );

  esp_camera_fb_return(fb);

  if (!converted) {
    Serial.println("Gagal convert RGB565 ke JPG");
    server.send(500, "text/plain", "JPG conversion failed");
    return;
  }

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send_P(200, "image/jpeg", (const char *)jpg_buf, jpg_len);

  free(jpg_buf);
}

// =======================
// FLASH ON
// =======================
void handleFlashOn() {
  digitalWrite(FLASH_LED_PIN, HIGH);
  server.sendHeader("Location", "/");
  server.send(303);
}

// =======================
// FLASH OFF
// =======================
void handleFlashOff() {
  digitalWrite(FLASH_LED_PIN, LOW);
  server.sendHeader("Location", "/");
  server.send(303);
}

// =======================
// SETUP
// =======================
void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println();
  Serial.println("=== ESP32-CAM RGB565 WIFI TEST ===");

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  camera_config_t config;

  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;

  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;

  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;

  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;

  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;

  config.xclk_freq_hz = 20000000;

  // Sensor kamu tidak support JPEG langsung,
  // jadi pakai RGB565 lalu dikonversi ke JPG.
  config.pixel_format = PIXFORMAT_RGB565;

  // Resolusi dinaikkan dari QQVGA 160x120 ke QVGA 320x240
  config.frame_size = FRAMESIZE_QVGA;

  config.jpeg_quality = 12;
  config.fb_count = 1;

  Serial.println("Inisialisasi kamera...");

  esp_err_t err = esp_camera_init(&config);

  if (err != ESP_OK) {
    Serial.printf("KAMERA GAGAL. Error: 0x%x\n", err);
    Serial.println("Cek kamera, kabel fleksibel, board, dan power.");
    return;
  }

  Serial.println("KAMERA BERHASIL TERDETEKSI!");

  sensor_t *s = esp_camera_sensor_get();

  if (s != NULL) {
    Serial.printf("Sensor PID: 0x%04X\n", s->id.PID);

    // Kalau gambar terbalik/mirror, ubah 0 jadi 1
    s->set_vflip(s, 0);
    s->set_hmirror(s, 0);
  }

  WiFi.begin(ssid, password);
  Serial.print("Menghubungkan ke WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi terhubung!");
  Serial.print("Buka di browser: http://");
  Serial.println(WiFi.localIP());

  server.on("/", handleRoot);
  server.on("/jpg", handleJpg);
  server.on("/flash/on", handleFlashOn);
  server.on("/flash/off", handleFlashOff);

  server.begin();
  Serial.println("Web server aktif.");
}

// =======================
// LOOP
// =======================
void loop() {
  server.handleClient();
}