/*
  ==========================================================
  ESP8266 MAIN CODE - MEGA TELEMETRY + THINGSBOARD MQTT + RPC
  ==========================================================

  Fungsi:
  1. Menerima JSON telemetry dari Arduino Mega melalui SoftwareSerial.
  2. Mengirim telemetry ke ThingsBoard via MQTT.
  3. Menerima RPC dari ThingsBoard:
     - pump_1 true/false
     - pump_2 true/false
     - pump_3 true/false
  4. Meneruskan command ke Arduino Mega dengan format:
     CMD:PUMP_1_ON
     CMD:PUMP_1_OFF
     CMD:PUMP_2_ON
     CMD:PUMP_2_OFF
     CMD:PUMP_3_ON
     CMD:PUMP_3_OFF

  Wiring final:
    Mega TX1 pin 18 -> ESP D1 / GPIO5
    Mega RX1 pin 19 <- ESP D2 / GPIO4
    Mega GND        -> ESP GND

  Serial Monitor ESP8266:
    115200 baud

  Serial ESP <-> Mega:
    4800 baud
*/

#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <SoftwareSerial.h>

// ==================================================
// SERIAL MEGA <-> ESP8266
// ==================================================

// SoftwareSerial(rx, tx)
// D1 = RX dari Mega TX1 pin 18
// D2 = TX ke Mega RX1 pin 19
SoftwareSerial megaSerial(D1, D2);

const unsigned long SERIAL_MONITOR_BAUD = 115200;
const unsigned long MEGA_SERIAL_BAUD = 4800;

// ==================================================
// WIFI SETTINGS
// ==================================================

const char* WIFI_SSID = "qwertyuiop";
const char* WIFI_PASSWORD = "00000000";

// ==================================================
// THINGSBOARD MQTT SETTINGS
// ==================================================

// Kalau ThingsBoard jalan di laptop yang menjadi gateway/hotspot,
// biasanya IP ini adalah IP laptop dari sisi ESP.
const char* THINGSBOARD_HOST = "192.168.137.1";
const int THINGSBOARD_MQTT_PORT = 1883;

// Device token ThingsBoard
const char* DEVICE_TOKEN = "FPHoXJJ2c0nXYVT05nxt";

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// ==================================================
// WIFI
// ==================================================

void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.println();
  Serial.println("================================");
  Serial.println("Connecting to WiFi...");
  Serial.print("SSID: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempt = 0;

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    attempt++;

    Serial.print(".");

    if (attempt >= 80) {
      Serial.println();
      Serial.println("WiFi connection failed. Restarting ESP8266...");
      ESP.restart();
    }
  }

  Serial.println();
  Serial.println("WiFi connected!");
  Serial.print("IP Address : ");
  Serial.println(WiFi.localIP());
  Serial.print("Gateway    : ");
  Serial.println(WiFi.gatewayIP());
  Serial.print("Signal     : ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
  Serial.println("================================");
}

// ==================================================
// RPC HELPER
// ==================================================

bool extractRpcValue(StaticJsonDocument<512>& doc) {
  JsonVariant params = doc["params"];

  if (params.is<bool>()) {
    return params.as<bool>();
  }

  if (params.is<int>()) {
    return params.as<int>() != 0;
  }

  if (params.is<const char*>()) {
    String text = params.as<String>();
    text.trim();
    text.toLowerCase();

    return text == "true" || text == "on" || text == "1";
  }

  if (params.is<JsonObject>()) {
    JsonVariant value = params["value"];

    if (value.is<bool>()) {
      return value.as<bool>();
    }

    if (value.is<int>()) {
      return value.as<int>() != 0;
    }

    if (value.is<const char*>()) {
      String text = value.as<String>();
      text.trim();
      text.toLowerCase();

      return text == "true" || text == "on" || text == "1";
    }
  }

  return false;
}

void sendRpcResponse(String requestTopic, bool success, String message) {
  String responseTopic = requestTopic;
  responseTopic.replace("request", "response");

  StaticJsonDocument<160> responseDoc;
  responseDoc["success"] = success;
  responseDoc["message"] = message;

  String responsePayload;
  serializeJson(responseDoc, responsePayload);

  mqttClient.publish(responseTopic.c_str(), responsePayload.c_str());

  Serial.print("Sending RPC response topic: ");
  Serial.println(responseTopic);
  Serial.print("RPC response payload: ");
  Serial.println(responsePayload);
}

void sendCommandToMega(const char* method, bool value) {
  String command = "CMD:";

  if (strcmp(method, "pump_1") == 0) {
    command += value ? "PUMP_1_ON" : "PUMP_1_OFF";
  }
  else if (strcmp(method, "pump_2") == 0) {
    command += value ? "PUMP_2_ON" : "PUMP_2_OFF";
  }
  else if (strcmp(method, "pump_3") == 0) {
    command += value ? "PUMP_3_ON" : "PUMP_3_OFF";
  }
  else {
    Serial.print("Unknown pump method: ");
    Serial.println(method);
    return;
  }

  Serial.print("Sending command to Mega: ");
  Serial.println(command);

  // Kirim 3 kali agar lebih tahan noise/kehilangan byte.
  for (int i = 1; i <= 3; i++) {
    megaSerial.println(command);
    megaSerial.flush();

    Serial.print("Command copy ");
    Serial.print(i);
    Serial.println(" sent to Mega.");

    delay(40);
  }
}

// ==================================================
// MQTT CALLBACK / RPC HANDLER
// ==================================================

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String topicString = String(topic);
  String payloadString = "";

  for (unsigned int i = 0; i < length; i++) {
    payloadString += (char)payload[i];
  }

  Serial.println();
  Serial.println("================================");
  Serial.println("RPC received from ThingsBoard");
  Serial.print("Topic: ");
  Serial.println(topicString);
  Serial.print("Payload: ");
  Serial.println(payloadString);
  Serial.println("================================");

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, payloadString);

  if (error) {
    Serial.print("RPC JSON parse failed: ");
    Serial.println(error.c_str());
    sendRpcResponse(topicString, false, "Invalid JSON");
    return;
  }

  const char* method = doc["method"];

  if (method == nullptr) {
    Serial.println("RPC method missing");
    sendRpcResponse(topicString, false, "Missing method");
    return;
  }

  bool value = extractRpcValue(doc);

  Serial.print("RPC Method: ");
  Serial.println(method);

  Serial.print("RPC Value: ");
  Serial.println(value ? "true" : "false");

  if (
    strcmp(method, "pump_1") == 0 ||
    strcmp(method, "pump_2") == 0 ||
    strcmp(method, "pump_3") == 0
  ) {
    sendCommandToMega(method, value);
    sendRpcResponse(topicString, true, String(method) + (value ? " ON" : " OFF"));
    return;
  }

  Serial.print("Unknown RPC method: ");
  Serial.println(method);
  sendRpcResponse(topicString, false, "Unknown method");
}

// ==================================================
// THINGSBOARD MQTT
// ==================================================

void connectToThingsBoard() {
  if (mqttClient.connected()) {
    return;
  }

  while (!mqttClient.connected()) {
    Serial.println();
    Serial.println("Connecting to ThingsBoard MQTT...");
    Serial.print("Host: ");
    Serial.print(THINGSBOARD_HOST);
    Serial.print(":");
    Serial.println(THINGSBOARD_MQTT_PORT);

    String clientId = "esp8266-smart-farm-";
    clientId += String(ESP.getChipId());

    // ThingsBoard MQTT:
    // username = device token
    // password = kosong
    if (mqttClient.connect(clientId.c_str(), DEVICE_TOKEN, "")) {
      Serial.println("Connected to ThingsBoard MQTT!");

      mqttClient.subscribe("v1/devices/me/rpc/request/+");
      Serial.println("Subscribed to RPC topic: v1/devices/me/rpc/request/+");
    }
    else {
      Serial.print("MQTT connection failed, rc=");
      Serial.println(mqttClient.state());
      Serial.println("Retry in 3 seconds...");
      delay(3000);
    }
  }
}

// ==================================================
// TELEMETRY
// ==================================================

void sendTelemetryToThingsBoard(String payload) {
  if (!mqttClient.connected()) {
    connectToThingsBoard();
  }

  Serial.println();
  Serial.println("Sending telemetry to ThingsBoard via MQTT...");
  Serial.println("Topic: v1/devices/me/telemetry");
  Serial.print("Payload: ");
  Serial.println(payload);

  bool ok = mqttClient.publish("v1/devices/me/telemetry", payload.c_str());

  if (ok) {
    Serial.println("Telemetry sent successfully via MQTT.");
  }
  else {
    Serial.println("Telemetry send failed.");
  }
}

// ==================================================
// READ FROM MEGA
// ==================================================

void readTelemetryFromMega() {
  while (megaSerial.available()) {
    String payload = megaSerial.readStringUntil('\n');
    payload.trim();

    if (payload.length() == 0) {
      continue;
    }

    Serial.println();
    Serial.println("Received from Mega:");
    Serial.println(payload);

    if (payload.startsWith("{") && payload.endsWith("}")) {
      sendTelemetryToThingsBoard(payload);
    }
    else {
      Serial.println("Invalid JSON format from Mega. Data ignored.");
    }

    yield();
  }
}

// ==================================================
// SETUP
// ==================================================

void setup() {
  Serial.begin(SERIAL_MONITOR_BAUD);
  delay(500);

  megaSerial.begin(MEGA_SERIAL_BAUD);
  megaSerial.setTimeout(80);
  delay(500);

  Serial.println();
  Serial.println("==============================================");
  Serial.println("ESP8266 SMART FARM BRIDGE STARTED");
  Serial.println("==============================================");
  Serial.print("Serial Monitor baud : ");
  Serial.println(SERIAL_MONITOR_BAUD);
  Serial.print("Mega serial baud    : ");
  Serial.println(MEGA_SERIAL_BAUD);
  Serial.println("Wiring:");
  Serial.println("Mega TX1 pin 18 -> ESP D1 / GPIO5");
  Serial.println("Mega RX1 pin 19 <- ESP D2 / GPIO4");
  Serial.println("==============================================");

  connectToWiFi();

  mqttClient.setServer(THINGSBOARD_HOST, THINGSBOARD_MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(1024);

  connectToThingsBoard();

  Serial.println();
  Serial.println("Waiting JSON from Arduino Mega...");
}

// ==================================================
// LOOP
// ==================================================

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }

  if (!mqttClient.connected()) {
    connectToThingsBoard();
  }

  mqttClient.loop();
  readTelemetryFromMega();
}
