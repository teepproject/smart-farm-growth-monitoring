#include "esp_camera.h"
#include "img_converters.h"
#include <WiFi.h>
#include "esp_http_server.h"
#include <time.h>

// =====================================================
// WIFI CONFIGURATION
// =====================================================
const char* WIFI_SSID = "K410";
const char* WIFI_PASSWORD = "amaap67674";

// =====================================================
// WORK MODE CONFIGURATION
// =====================================================
// false = the camera can still be displayed on the website, but auto capture and auto flash are not yet active
// true  = the camera starts working: takes a photo every hour + auto flash ON from 7:00 PM to 6:00 AM
const bool DEFAULT_WORK_MODE_ENABLED = false;

// =====================================================
// TIME CONFIGURATION
// =====================================================
// Taiwan UTC+8. If using Indonesia's WIB time zone, convert it to 7 * 3600.
const long GMT_OFFSET_SECONDS = 8 * 3600;
const int DAYLIGHT_OFFSET_SECONDS = 0;

const char* NTP_SERVER_1 = "pool.ntp.org";
const char* NTP_SERVER_2 = "time.google.com";

// =====================================================
// AUTO CAPTURE + FLASH CONFIGURATION
// =====================================================
const int FLASH_ON_HOUR = 19;   // 7 PM
const int FLASH_OFF_HOUR = 6;   // 6 AM

// Manual flashing from the website has NO TIMEOUT.
// Flash ON will remain ON until you click Flash OFF or Flash AUTO.

// =====================================================
// AI THINKER ESP32-CAM PIN CONFIGURATION
// =====================================================
#define PWDN_GPIO_NUM      32
#define RESET_GPIO_NUM     -1
#define XCLK_GPIO_NUM       0
#define SIOD_GPIO_NUM      26
#define SIOC_GPIO_NUM      27

#define Y9_GPIO_NUM        35
#define Y8_GPIO_NUM        34
#define Y7_GPIO_NUM        39
#define Y6_GPIO_NUM        36
#define Y5_GPIO_NUM        21
#define Y4_GPIO_NUM        19
#define Y3_GPIO_NUM        18
#define Y2_GPIO_NUM         5

#define VSYNC_GPIO_NUM     25
#define HREF_GPIO_NUM      23
#define PCLK_GPIO_NUM      22

#define FLASH_LED_PIN       4

// =====================================================
// CAMERA SETTINGS
// =====================================================
// Sensor kamera kamu memberi error:
// "JPEG format is not supported on this sensor".
// Jadi kita pakai RGB565 lalu dikonversi ke JPG oleh ESP32.
//
// FRAMESIZE_QQVGA = 160x120, paling ringan tapi pecah.
// FRAMESIZE_QVGA  = 320x240, lebih jelas dan biasanya stabil.
// FRAMESIZE_VGA   = 640x480, lebih bagus tapi lebih berat.
#define CAMERA_FRAME_SIZE FRAMESIZE_QVGA

// Nilai kecil = kualitas lebih bagus, ukuran file lebih besar.
// Untuk mode RGB565 convert, 12 adalah titik aman.
#define CAMERA_JPG_QUALITY 12

httpd_handle_t cameraServer = NULL;
String cameraMode = "RGB565_convert";

// =====================================================
// GLOBAL STATE
// =====================================================
bool workModeEnabled = DEFAULT_WORK_MODE_ENABLED;

uint8_t* latestPhotoBuffer = NULL;
size_t latestPhotoLength = 0;
String latestPhotoTime = "-";

int lastCaptureYear = -1;
int lastCaptureYDay = -1;
int lastCaptureHour = -1;

bool flashState = false;

// manualFlashOverride = true berarti flash dikontrol manual dari website.
// manualFlashState = true  berarti paksa ON.
// manualFlashState = false berarti paksa OFF.
// Kalau ingin kembali otomatis, buka /flash/auto.
bool manualFlashOverride = false;
bool manualFlashState = false;

unsigned long lastTimePrint = 0;

// =====================================================
// HTML PAGE
// =====================================================
static const char MAIN_PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <title>ESP32-CAM Smart Farm</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <style>
    body {
      background: #111827;
      color: white;
      font-family: Arial, sans-serif;
      text-align: center;
      margin: 0;
      padding: 20px;
    }

    img {
      width: 640px;
      max-width: 95%;
      height: auto;
      object-fit: contain;
      image-rendering: auto;
      border: 3px solid white;
      border-radius: 12px;
      background: black;
    }

    button, a {
      margin: 8px;
      padding: 10px 16px;
      border-radius: 8px;
      border: none;
      background: #22c55e;
      color: #020617;
      font-weight: bold;
      text-decoration: none;
      cursor: pointer;
      display: inline-block;
    }

    .danger {
      background: #ef4444;
      color: white;
    }

    .secondary {
      background: #38bdf8;
      color: #020617;
    }

    .warning {
      background: #facc15;
      color: #020617;
    }

    code {
      display: block;
      margin: 15px auto;
      padding: 10px;
      background: #020617;
      color: #86efac;
      border-radius: 8px;
      max-width: 760px;
      word-break: break-all;
    }

    .box {
      max-width: 820px;
      margin: 0 auto 20px;
      padding: 16px;
      border: 1px solid #334155;
      border-radius: 16px;
      background: #020617;
    }

    .small {
      color: #cbd5e1;
      font-size: 14px;
    }
  </style>
</head>

<body>
  <h1>ESP32-CAM Smart Farm</h1>
  <p>Live camera always works. Auto hourly capture and night flash depend on work mode.</p>

  <div class="box">
    <h2>Live JPG Preview</h2>
    <img id="cam" src="/jpg" alt="ESP32-CAM">

    <br><br>

    <button onclick="refreshImage()">Refresh</button>
    <a href="/jpg" target="_blank">Open Live JPG</a>
    <a href="/latest.jpg" target="_blank">Open Latest Hourly Photo</a>
    <a href="/status" target="_blank">Status</a>

    <p class="small">Live image refresh every 5 seconds.</p>
  </div>

  <div class="box">
    <h2>Work Mode</h2>
    <p>
      Work Mode ON = foto otomatis tiap jam + flash AUTO ON jam 19:00 sampai 06:00.
    </p>

    <button onclick="fetch('/work/on').then(() => alert('Work Mode ON'))">
      Work Mode ON
    </button>

    <button class="danger" onclick="fetch('/work/off').then(() => alert('Work Mode OFF'))">
      Work Mode OFF
    </button>

    <button class="secondary" onclick="fetch('/capture').then(() => alert('Manual capture saved'))">
      Capture Now
    </button>
  </div>

  <div class="box">
    <h2>Flash Control</h2>

    <button onclick="fetch('/flash/on').then(() => alert('Flash ON - tetap menyala sampai Flash OFF atau AUTO'))">
      Flash ON
    </button>

    <button class="danger" onclick="fetch('/flash/off').then(() => alert('Flash OFF - tetap mati sampai Flash ON atau AUTO'))">
      Flash OFF
    </button>

    <button class="warning" onclick="fetch('/flash/auto').then(() => alert('Flash AUTO'))">
      Flash AUTO
    </button>

    <p class="small">
      Flash ON akan menyala terus sampai kamu klik Flash OFF atau Flash AUTO.
    </p>
  </div>

  <div class="box">
    <h2>Camera URLs</h2>

    <p>Live dashboard URL:</p>
    <code id="jpgUrl"></code>

    <p>Latest hourly photo URL:</p>
    <code id="latestUrl"></code>

    <p>Status URL:</p>
    <code id="statusUrl"></code>
  </div>

  <script>
    function refreshImage() {
      document.getElementById("cam").src = "/jpg?t=" + Date.now();
    }

    setInterval(refreshImage, 5000);

    document.getElementById("jpgUrl").textContent =
      window.location.origin + "/jpg";

    document.getElementById("latestUrl").textContent =
      window.location.origin + "/latest.jpg";

    document.getElementById("statusUrl").textContent =
      window.location.origin + "/status";
  </script>
</body>
</html>
)rawliteral";

// =====================================================
// TIME HELPER
// =====================================================
bool getCurrentTime(struct tm* timeInfo) {
  return getLocalTime(timeInfo, 1000);
}

String formatTimeString(const struct tm& timeInfo) {
  char buffer[32];

  strftime(
    buffer,
    sizeof(buffer),
    "%Y-%m-%d %H:%M:%S",
    &timeInfo
  );

  return String(buffer);
}

bool isFlashScheduleActive(const struct tm& timeInfo) {
  int hour = timeInfo.tm_hour;

  // Flash ON dari 19:00 sampai 05:59
  // Flash OFF dari 06:00 sampai 18:59
  return hour >= FLASH_ON_HOUR || hour < FLASH_OFF_HOUR;
}

// =====================================================
// FLASH CONTROL
// =====================================================
void applyFlashState(bool state) {
  flashState = state;
  digitalWrite(FLASH_LED_PIN, state ? HIGH : LOW);
}

void updateFlashSchedule() {
  // Prioritas tertinggi: manual override dari website.
  // Jadi meskipun Work Mode OFF, Flash ON tetap menyala
  // sampai user klik Flash OFF atau Flash AUTO.
  if (manualFlashOverride) {
    if (flashState != manualFlashState) {
      applyFlashState(manualFlashState);
    }
    return;
  }

  // Kalau Work Mode OFF dan tidak ada manual override,
  // flash otomatis dipaksa OFF.
  if (!workModeEnabled) {
    if (flashState) {
      applyFlashState(false);
      Serial.println("[FLASH] Work mode OFF. Flash forced OFF.");
    }
    return;
  }

  struct tm timeInfo;

  if (!getCurrentTime(&timeInfo)) {
    return;
  }

  bool shouldBeOn = isFlashScheduleActive(timeInfo);

  if (shouldBeOn != flashState) {
    applyFlashState(shouldBeOn);

    Serial.print("[FLASH] Auto schedule changed. Flash: ");
    Serial.println(shouldBeOn ? "ON" : "OFF");
  }
}

// =====================================================
// CAMERA CAPTURE TO JPG BUFFER
// =====================================================
bool captureJpgToBuffer(uint8_t** outBuffer, size_t* outLength) {
  *outBuffer = NULL;
  *outLength = 0;

  camera_fb_t* fb = esp_camera_fb_get();

  if (!fb) {
    Serial.println("[ERROR] Camera capture failed");
    return false;
  }

  uint8_t* jpgBuffer = NULL;
  size_t jpgLength = 0;

  // Mode terbaik: kamera menghasilkan JPEG langsung.
  // Kita copy buffer supaya aman setelah esp_camera_fb_return().
  if (fb->format == PIXFORMAT_JPEG) {
    jpgLength = fb->len;
    jpgBuffer = (uint8_t*)malloc(jpgLength);

    if (jpgBuffer == NULL) {
      Serial.println("[ERROR] Not enough memory to copy JPG buffer");
      esp_camera_fb_return(fb);
      return false;
    }

    memcpy(jpgBuffer, fb->buf, jpgLength);
    esp_camera_fb_return(fb);

    *outBuffer = jpgBuffer;
    *outLength = jpgLength;
    return true;
  }

  // Fallback kalau suatu saat pixel_format bukan JPEG.
  bool converted = fmt2jpg(
    fb->buf,
    fb->len,
    fb->width,
    fb->height,
    fb->format,
    CAMERA_JPG_QUALITY,
    &jpgBuffer,
    &jpgLength
  );

  esp_camera_fb_return(fb);

  if (!converted || jpgBuffer == NULL || jpgLength == 0) {
    Serial.println("[ERROR] Frame to JPG conversion failed");

    if (jpgBuffer != NULL) {
      free(jpgBuffer);
    }

    return false;
  }

  *outBuffer = jpgBuffer;
  *outLength = jpgLength;

  return true;
}

// =====================================================
// HOURLY PHOTO CAPTURE
// =====================================================
bool captureHourlyPhoto(const String& reason) {
  Serial.print("[CAPTURE] Taking photo. Reason: ");
  Serial.println(reason);

  uint8_t* newBuffer = NULL;
  size_t newLength = 0;

  bool ok = captureJpgToBuffer(&newBuffer, &newLength);

  if (!ok) {
    Serial.println("[CAPTURE] Failed.");
    return false;
  }

  if (latestPhotoBuffer != NULL) {
    free(latestPhotoBuffer);
    latestPhotoBuffer = NULL;
    latestPhotoLength = 0;
  }

  latestPhotoBuffer = newBuffer;
  latestPhotoLength = newLength;

  struct tm timeInfo;

  if (getCurrentTime(&timeInfo)) {
    latestPhotoTime = formatTimeString(timeInfo);
  } else {
    latestPhotoTime = "time-not-synced";
  }

  Serial.print("[CAPTURE] Saved latest photo. Size: ");
  Serial.print(latestPhotoLength);
  Serial.print(" bytes. Time: ");
  Serial.println(latestPhotoTime);

  return true;
}

void checkHourlyCapture() {
  // Kalau work mode false, auto capture tidak berjalan.
  if (!workModeEnabled) {
    return;
  }

  struct tm timeInfo;

  if (!getCurrentTime(&timeInfo)) {
    return;
  }

  // Foto sekali setiap masuk jam baru.
  bool isNewHour =
    timeInfo.tm_year != lastCaptureYear ||
    timeInfo.tm_yday != lastCaptureYDay ||
    timeInfo.tm_hour != lastCaptureHour;

  if (!isNewHour) {
    return;
  }

  bool ok = captureHourlyPhoto("new-hour-auto");

  if (ok) {
    lastCaptureYear = timeInfo.tm_year;
    lastCaptureYDay = timeInfo.tm_yday;
    lastCaptureHour = timeInfo.tm_hour;
  }
}

// =====================================================
// HTTP HANDLERS
// =====================================================
static esp_err_t rootHandler(httpd_req_t* req) {
  httpd_resp_set_type(req, "text/html");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");
  return httpd_resp_send(req, MAIN_PAGE, strlen(MAIN_PAGE));
}

static esp_err_t jpgHandler(httpd_req_t* req) {
  uint8_t* jpgBuffer = NULL;
  size_t jpgLength = 0;

  bool ok = captureJpgToBuffer(&jpgBuffer, &jpgLength);

  if (!ok) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate");
  httpd_resp_set_hdr(req, "Pragma", "no-cache");
  httpd_resp_set_hdr(req, "Expires", "0");

  esp_err_t result = httpd_resp_send(req, (const char*)jpgBuffer, jpgLength);

  free(jpgBuffer);

  return result;
}

static esp_err_t latestJpgHandler(httpd_req_t* req) {
  if (latestPhotoBuffer == NULL || latestPhotoLength == 0) {
    bool ok = captureHourlyPhoto("latest-request-no-photo-yet");

    if (!ok) {
      httpd_resp_send_500(req);
      return ESP_FAIL;
    }
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate");

  return httpd_resp_send(
    req,
    (const char*)latestPhotoBuffer,
    latestPhotoLength
  );
}

static esp_err_t manualCaptureHandler(httpd_req_t* req) {
  bool ok = captureHourlyPhoto("manual-http-capture");

  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  if (!ok) {
    return httpd_resp_send(
      req,
      "{\"success\":false,\"message\":\"capture failed\"}",
      HTTPD_RESP_USE_STRLEN
    );
  }

  String json = "{";
  json += "\"success\":true,";
  json += "\"message\":\"manual capture saved\",";
  json += "\"latest_photo_time\":\"";
  json += latestPhotoTime;
  json += "\",";
  json += "\"latest_photo_size\":";
  json += latestPhotoLength;
  json += "}";

  return httpd_resp_send(req, json.c_str(), json.length());
}

static esp_err_t workOnHandler(httpd_req_t* req) {
  workModeEnabled = true;

  // Work Mode ON mengembalikan flash ke AUTO schedule.
  manualFlashOverride = false;

  updateFlashSchedule();

  // Capture sekali saat work mode dinyalakan.
  bool ok = captureHourlyPhoto("work-mode-enabled");

  if (ok) {
    struct tm timeInfo;

    if (getCurrentTime(&timeInfo)) {
      lastCaptureYear = timeInfo.tm_year;
      lastCaptureYDay = timeInfo.tm_yday;
      lastCaptureHour = timeInfo.tm_hour;
    }
  }

  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  return httpd_resp_send(
    req,
    "{\"success\":true,\"work_mode\":true,\"flash_mode\":\"auto\",\"message\":\"Work mode enabled\"}",
    HTTPD_RESP_USE_STRLEN
  );
}

static esp_err_t workOffHandler(httpd_req_t* req) {
  workModeEnabled = false;

  // Work Mode OFF juga keluar dari auto/manual schedule dan mematikan flash.
  manualFlashOverride = false;
  applyFlashState(false);

  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  return httpd_resp_send(
    req,
    "{\"success\":true,\"work_mode\":false,\"flash_state\":\"off\",\"message\":\"Work mode disabled\"}",
    HTTPD_RESP_USE_STRLEN
  );
}

static esp_err_t statusHandler(httpd_req_t* req) {
  struct tm timeInfo;
  String currentTime = "-";

  if (getCurrentTime(&timeInfo)) {
    currentTime = formatTimeString(timeInfo);
  }

  String json = "{";
  json += "\"device\":\"ESP32-CAM Smart Farm\",";
  json += "\"mode\":\"";
  json += cameraMode;
  json += "\",";
  json += "\"work_mode_enabled\":";
  json += (workModeEnabled ? "true" : "false");
  json += ",";
  json += "\"wifi\":\"";
  json += (WiFi.status() == WL_CONNECTED ? "connected" : "disconnected");
  json += "\",";
  json += "\"ip\":\"";
  json += WiFi.localIP().toString();
  json += "\",";
  json += "\"rssi\":";
  json += WiFi.RSSI();
  json += ",";
  json += "\"free_heap\":";
  json += ESP.getFreeHeap();
  json += ",";
  json += "\"psram\":";
  json += (psramFound() ? "true" : "false");
  json += ",";
  json += "\"current_time\":\"";
  json += currentTime;
  json += "\",";
  json += "\"flash_state\":\"";
  json += (flashState ? "on" : "off");
  json += "\",";
  json += "\"flash_mode\":\"";
  json += (manualFlashOverride ? "manual" : "auto");
  json += "\",";
  json += "\"manual_flash_override\":";
  json += (manualFlashOverride ? "true" : "false");
  json += ",";
  json += "\"manual_flash_state\":\"";
  json += (manualFlashState ? "on" : "off");
  json += "\",";
  json += "\"latest_photo_time\":\"";
  json += latestPhotoTime;
  json += "\",";
  json += "\"latest_photo_size\":";
  json += latestPhotoLength;
  json += "}";

  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");

  return httpd_resp_send(req, json.c_str(), json.length());
}

static esp_err_t flashOnHandler(httpd_req_t* req) {
  manualFlashOverride = true;
  manualFlashState = true;

  applyFlashState(true);

  httpd_resp_set_type(req, "text/plain");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  return httpd_resp_send(
    req,
    "Flash ON manual override - persistent until Flash OFF or AUTO",
    HTTPD_RESP_USE_STRLEN
  );
}

static esp_err_t flashOffHandler(httpd_req_t* req) {
  manualFlashOverride = true;
  manualFlashState = false;

  applyFlashState(false);

  httpd_resp_set_type(req, "text/plain");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  return httpd_resp_send(
    req,
    "Flash OFF manual override - persistent until Flash ON or AUTO",
    HTTPD_RESP_USE_STRLEN
  );
}

static esp_err_t flashAutoHandler(httpd_req_t* req) {
  manualFlashOverride = false;

  updateFlashSchedule();

  httpd_resp_set_type(req, "text/plain");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  return httpd_resp_send(
    req,
    "Flash AUTO mode",
    HTTPD_RESP_USE_STRLEN
  );
}

// =====================================================
// CAMERA SETUP
// =====================================================
void fillCameraConfig(camera_config_t* config, pixformat_t pixelFormat, framesize_t frameSize) {
  config->ledc_channel = LEDC_CHANNEL_0;
  config->ledc_timer = LEDC_TIMER_0;

  config->pin_d0 = Y2_GPIO_NUM;
  config->pin_d1 = Y3_GPIO_NUM;
  config->pin_d2 = Y4_GPIO_NUM;
  config->pin_d3 = Y5_GPIO_NUM;
  config->pin_d4 = Y6_GPIO_NUM;
  config->pin_d5 = Y7_GPIO_NUM;
  config->pin_d6 = Y8_GPIO_NUM;
  config->pin_d7 = Y9_GPIO_NUM;

  config->pin_xclk = XCLK_GPIO_NUM;
  config->pin_pclk = PCLK_GPIO_NUM;
  config->pin_vsync = VSYNC_GPIO_NUM;
  config->pin_href = HREF_GPIO_NUM;

  config->pin_sccb_sda = SIOD_GPIO_NUM;
  config->pin_sccb_scl = SIOC_GPIO_NUM;

  config->pin_pwdn = PWDN_GPIO_NUM;
  config->pin_reset = RESET_GPIO_NUM;

  // 10 MHz sering lebih stabil untuk sensor yang tidak support JPEG langsung.
  config->xclk_freq_hz = 10000000;
  config->pixel_format = pixelFormat;

  config->frame_size = frameSize;
  config->jpeg_quality = CAMERA_JPG_QUALITY;
  config->fb_count = 1;
  config->grab_mode = CAMERA_GRAB_LATEST;

  if (psramFound()) {
    config->fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    config->fb_location = CAMERA_FB_IN_DRAM;
  }
}

void applySensorSettings(framesize_t frameSize) {
  sensor_t* sensor = esp_camera_sensor_get();

  if (!sensor) {
    Serial.println("[WARN] Camera sensor settings skipped.");
    return;
  }

  sensor->set_framesize(sensor, frameSize);

  // Orientasi gambar. Ubah 0 ke 1 kalau gambar terbalik.
  sensor->set_vflip(sensor, 0);
  sensor->set_hmirror(sensor, 0);

  // Setting kualitas gambar.
  sensor->set_brightness(sensor, 0);      // -2 sampai 2
  sensor->set_contrast(sensor, 1);        // -2 sampai 2
  sensor->set_saturation(sensor, 0);      // -2 sampai 2
  sensor->set_special_effect(sensor, 0);  // 0 = normal

  // Auto white balance dan exposure supaya warna lebih natural.
  sensor->set_whitebal(sensor, 1);
  sensor->set_awb_gain(sensor, 1);
  sensor->set_wb_mode(sensor, 0);         // 0 = auto
  sensor->set_exposure_ctrl(sensor, 1);
  sensor->set_aec2(sensor, 1);
  sensor->set_ae_level(sensor, 0);

  // Auto gain untuk kondisi indoor/outdoor berubah-ubah.
  sensor->set_gain_ctrl(sensor, 1);
  sensor->set_agc_gain(sensor, 0);
  sensor->set_gainceiling(sensor, (gainceiling_t)2);

  // Koreksi noise, warna, dan lens shading.
  sensor->set_bpc(sensor, 1);
  sensor->set_wpc(sensor, 1);
  sensor->set_raw_gma(sensor, 1);
  sensor->set_lenc(sensor, 1);
  sensor->set_dcw(sensor, 1);
  sensor->set_colorbar(sensor, 0);
}

void setupCamera() {
  Serial.println("[CAMERA] Starting camera...");

  if (psramFound()) {
    Serial.println("[INFO] PSRAM found. Using PSRAM framebuffer.");
  } else {
    Serial.println("[WARN] PSRAM not found. Using DRAM framebuffer.");
    Serial.println("[WARN] If camera is unstable, use FRAMESIZE_QQVGA.");
  }

  // Sensor kamu tidak support JPEG langsung, jadi default-nya RGB565.
  // Ini menghindari error: JPEG format is not supported on this sensor.
  camera_config_t config;
  fillCameraConfig(&config, PIXFORMAT_RGB565, CAMERA_FRAME_SIZE);

  esp_err_t error = esp_camera_init(&config);

  // Fallback otomatis ke resolusi paling aman jika QVGA/VGA gagal.
  if (error != ESP_OK) {
    Serial.printf("[WARN] Camera init failed at selected size: 0x%x\n", error);
    Serial.println("[WARN] Retrying with FRAMESIZE_QQVGA...");

    esp_camera_deinit();
    delay(500);

    fillCameraConfig(&config, PIXFORMAT_RGB565, FRAMESIZE_QQVGA);
    error = esp_camera_init(&config);

    if (error != ESP_OK) {
      Serial.printf("[ERROR] Camera init failed again: 0x%x\n", error);
      Serial.println("[TIPS]");
      Serial.println("1. Board: AI Thinker ESP32-CAM");
      Serial.println("2. PSRAM: Enabled");
      Serial.println("3. Partition Scheme: Huge APP");
      Serial.println("4. Use stable 5V power supply");
      Serial.println("5. Check camera ribbon cable direction and lock");
      delay(3000);
      ESP.restart();
    }

    cameraMode = "RGB565_convert_QQVGA_fallback";
    applySensorSettings(FRAMESIZE_QQVGA);
    Serial.println("[OK] Camera initialized in RGB565 fallback mode");
    return;
  }

  cameraMode = "RGB565_convert_QVGA";
  applySensorSettings(CAMERA_FRAME_SIZE);
  Serial.println("[OK] Camera initialized in RGB565 convert mode");
}

// =====================================================
// WIFI + TIME
// =====================================================
void connectToWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.println();
  Serial.print("[WiFi] Connecting");

  int retry = 0;

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    retry++;

    if (retry >= 60) {
      Serial.println();
      Serial.println("[WiFi] Failed. Restarting...");
      delay(1000);
      ESP.restart();
    }
  }

  Serial.println();
  Serial.println("[WiFi] Connected");
  Serial.print("[WiFi] IP Address: ");
  Serial.println(WiFi.localIP());
  Serial.print("[WiFi] RSSI: ");
  Serial.println(WiFi.RSSI());
}

void syncTime() {
  configTime(
    GMT_OFFSET_SECONDS,
    DAYLIGHT_OFFSET_SECONDS,
    NTP_SERVER_1,
    NTP_SERVER_2
  );

  Serial.print("[TIME] Syncing NTP");

  struct tm timeInfo;
  int retry = 0;

  while (!getCurrentTime(&timeInfo) && retry < 30) {
    delay(500);
    Serial.print(".");
    retry++;
  }

  Serial.println();

  if (retry >= 30) {
    Serial.println("[TIME] Failed to sync time. Will retry in loop.");
    return;
  }

  Serial.print("[TIME] Synced: ");
  Serial.println(formatTimeString(timeInfo));
}

// =====================================================
// SERVER
// =====================================================
void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.max_uri_handlers = 12;
  config.stack_size = 8192;

  httpd_uri_t rootUri = {
    .uri = "/",
    .method = HTTP_GET,
    .handler = rootHandler,
    .user_ctx = NULL
  };

  httpd_uri_t jpgUri = {
    .uri = "/jpg",
    .method = HTTP_GET,
    .handler = jpgHandler,
    .user_ctx = NULL
  };

  httpd_uri_t latestJpgUri = {
    .uri = "/latest.jpg",
    .method = HTTP_GET,
    .handler = latestJpgHandler,
    .user_ctx = NULL
  };

  httpd_uri_t captureUri = {
    .uri = "/capture",
    .method = HTTP_GET,
    .handler = manualCaptureHandler,
    .user_ctx = NULL
  };

  httpd_uri_t workOnUri = {
    .uri = "/work/on",
    .method = HTTP_GET,
    .handler = workOnHandler,
    .user_ctx = NULL
  };

  httpd_uri_t workOffUri = {
    .uri = "/work/off",
    .method = HTTP_GET,
    .handler = workOffHandler,
    .user_ctx = NULL
  };

  httpd_uri_t statusUri = {
    .uri = "/status",
    .method = HTTP_GET,
    .handler = statusHandler,
    .user_ctx = NULL
  };

  httpd_uri_t flashOnUri = {
    .uri = "/flash/on",
    .method = HTTP_GET,
    .handler = flashOnHandler,
    .user_ctx = NULL
  };

  httpd_uri_t flashOffUri = {
    .uri = "/flash/off",
    .method = HTTP_GET,
    .handler = flashOffHandler,
    .user_ctx = NULL
  };

  httpd_uri_t flashAutoUri = {
    .uri = "/flash/auto",
    .method = HTTP_GET,
    .handler = flashAutoHandler,
    .user_ctx = NULL
  };

  if (httpd_start(&cameraServer, &config) == ESP_OK) {
    httpd_register_uri_handler(cameraServer, &rootUri);
    httpd_register_uri_handler(cameraServer, &jpgUri);
    httpd_register_uri_handler(cameraServer, &latestJpgUri);
    httpd_register_uri_handler(cameraServer, &captureUri);
    httpd_register_uri_handler(cameraServer, &workOnUri);
    httpd_register_uri_handler(cameraServer, &workOffUri);
    httpd_register_uri_handler(cameraServer, &statusUri);
    httpd_register_uri_handler(cameraServer, &flashOnUri);
    httpd_register_uri_handler(cameraServer, &flashOffUri);
    httpd_register_uri_handler(cameraServer, &flashAutoUri);

    Serial.println("[OK] HTTP server started");
  } else {
    Serial.println("[ERROR] Failed to start HTTP server");
  }
}

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(FLASH_LED_PIN, OUTPUT);
  applyFlashState(false);

  Serial.println();
  Serial.println("==========================================");
  Serial.println("ESP32-CAM SMART FARM WORK MODE");
  Serial.println("==========================================");

  setupCamera();
  connectToWiFi();
  syncTime();

  if (workModeEnabled) {
    updateFlashSchedule();
    captureHourlyPhoto("boot-work-mode-enabled");
  } else {
    applyFlashState(false);
    Serial.println("[WORK MODE] OFF at boot. Live image still available.");
  }

  startCameraServer();

  Serial.println();
  Serial.println("Open these URLs:");
  Serial.print("Home        : http://");
  Serial.println(WiFi.localIP());

  Serial.print("Live JPG    : http://");
  Serial.print(WiFi.localIP());
  Serial.println("/jpg");

  Serial.print("Latest Photo: http://");
  Serial.print(WiFi.localIP());
  Serial.println("/latest.jpg");

  Serial.print("Work ON     : http://");
  Serial.print(WiFi.localIP());
  Serial.println("/work/on");

  Serial.print("Work OFF    : http://");
  Serial.print(WiFi.localIP());
  Serial.println("/work/off");

  Serial.print("Flash ON    : http://");
  Serial.print(WiFi.localIP());
  Serial.println("/flash/on");

  Serial.print("Flash OFF   : http://");
  Serial.print(WiFi.localIP());
  Serial.println("/flash/off");

  Serial.print("Flash AUTO  : http://");
  Serial.print(WiFi.localIP());
  Serial.println("/flash/auto");

  Serial.print("Status      : http://");
  Serial.print(WiFi.localIP());
  Serial.println("/status");

  Serial.println("==========================================");
}

// =====================================================
// LOOP
// =====================================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Disconnected. Restarting...");
    delay(1000);
    ESP.restart();
  }

  updateFlashSchedule();
  checkHourlyCapture();

  if (millis() - lastTimePrint >= 30000) {
    lastTimePrint = millis();

    struct tm timeInfo;

    Serial.print("[WORK MODE] ");
    Serial.print(workModeEnabled ? "ON" : "OFF");
    Serial.print(" | Flash: ");
    Serial.print(flashState ? "ON" : "OFF");
    Serial.print(" | Flash Mode: ");
    Serial.print(manualFlashOverride ? "MANUAL" : "AUTO");
    Serial.print(" | Latest photo: ");
    Serial.print(latestPhotoTime);

    if (getCurrentTime(&timeInfo)) {
      Serial.print(" | Time: ");
      Serial.println(formatTimeString(timeInfo));
    } else {
      Serial.println(" | Time not synced.");
      syncTime();
    }
  }

  delay(1000);
}