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
     - reset_system true
  4. Meneruskan command ke Arduino Mega dengan format:
     CMD:PUMP_1_ON
     CMD:PUMP_1_OFF
     CMD:PUMP_2_ON
     CMD:PUMP_2_OFF
     CMD:PUMP_3_ON
     CMD:PUMP_3_OFF
     CMD:RESET_MEGA

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

const char* WIFI_SSID = "K410";
const char* WIFI_PASSWORD = "amaap67674";

// ==================================================
// THINGSBOARD MQTT SETTINGS
// ==================================================

const char* THINGSBOARD_HOST = "192.168.0.189";
const int THINGSBOARD_MQTT_PORT = 1883;

// Access token device ThingsBoard
const char* DEVICE_TOKEN = "FPHoXJJ2c0nXYVT05nxt";

const char* TELEMETRY_TOPIC = "v1/devices/me/telemetry";
const char* RPC_SUBSCRIBE_TOPIC = "v1/devices/me/rpc/request/+";

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// ==================================================
// FUNCTION DECLARATIONS
// ==================================================

void connectToWiFi();
void connectToThingsBoard();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void sendTelemetryToThingsBoard(String payload);
void handleRpc(String topic, String message);
void sendCommandToMega(String commandName, bool value);
void sendRawCommandToMega(String command, int repeatCount = 3, int delayMs = 80);
void sendRpcResponse(String topic, bool success, String message);
bool getRpcBooleanValue(JsonDocument& doc);

// ==================================================
// WIFI
// ==================================================

void connectToWiFi() {
  Serial.println();
  Serial.println("Connecting to WiFi...");
  Serial.print("SSID: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int count = 0;

  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    count++;

    Serial.print("Attempt ");
    Serial.print(count);
    Serial.print(" | WiFi Status: ");
    Serial.println(WiFi.status());

    if (count >= 45) {
      Serial.println("WiFi connection failed. Restarting ESP...");
      ESP.restart();
    }
  }

  Serial.println();
  Serial.println("WiFi connected!");
  Serial.print("ESP8266 IP Address: ");
  Serial.println(WiFi.localIP());
  Serial.print("Gateway: ");
  Serial.println(WiFi.gatewayIP());
  Serial.print("Signal: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
}

// ==================================================
// MQTT / THINGSBOARD
// ==================================================

void connectToThingsBoard() {
  while (!mqttClient.connected()) {
    Serial.println();
    Serial.println("Connecting to ThingsBoard MQTT...");
    Serial.print("Host: ");
    Serial.print(THINGSBOARD_HOST);
    Serial.print(":");
    Serial.println(THINGSBOARD_MQTT_PORT);

    String clientId = "esp8266-smart-farm-";
    clientId += String(ESP.getChipId());

    if (mqttClient.connect(clientId.c_str(), DEVICE_TOKEN, NULL)) {
      Serial.println("Connected to ThingsBoard MQTT.");

      if (mqttClient.subscribe(RPC_SUBSCRIBE_TOPIC)) {
        Serial.print("Subscribed RPC topic: ");
        Serial.println(RPC_SUBSCRIBE_TOPIC);
      } else {
        Serial.println("Failed to subscribe RPC topic.");
      }
    } else {
      Serial.print("MQTT connection failed, rc=");
      Serial.println(mqttClient.state());
      Serial.println("Retry in 3 seconds...");
      delay(3000);
    }
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String topicString = String(topic);
  String message = "";

  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.println();
  Serial.println("==============================");
  Serial.println("RPC received from ThingsBoard");
  Serial.print("Topic: ");
  Serial.println(topicString);
  Serial.print("Payload: ");
  Serial.println(message);
  Serial.println("==============================");

  handleRpc(topicString, message);
}

void sendTelemetryToThingsBoard(String payload) {
  if (!mqttClient.connected()) {
    connectToThingsBoard();
  }

  Serial.println();
  Serial.println("Sending telemetry to ThingsBoard via MQTT...");
  Serial.print("Topic: ");
  Serial.println(TELEMETRY_TOPIC);
  Serial.print("Payload: ");
  Serial.println(payload);

  bool ok = mqttClient.publish(TELEMETRY_TOPIC, payload.c_str());

  if (ok) {
    Serial.println("Telemetry sent successfully via MQTT.");
  } else {
    Serial.println("Failed to send telemetry via MQTT.");
  }
}

// ==================================================
// RPC HANDLER
// ==================================================

void handleRpc(String topic, String message) {
  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (error) {
    Serial.print("RPC JSON parse error: ");
    Serial.println(error.c_str());
    sendRpcResponse(topic, false, "Invalid JSON");
    return;
  }

  const char* method = doc["method"] | "";
  bool value = getRpcBooleanValue(doc);

  Serial.println();
  Serial.print("RPC Method: ");
  Serial.println(method);
  Serial.print("RPC Value: ");
  Serial.println(value ? "true" : "false");

  if (strcmp(method, "reset_system") == 0) {
    Serial.println("RESET SYSTEM command received");

    sendCommandToMega("RESET_SYSTEM", true);
    sendRpcResponse(topic, true, "Reset command sent to Mega. ESP restarting...");

    delay(1500);
    ESP.restart();
    return;
  }

  if (strcmp(method, "pump_1") == 0) {
    sendCommandToMega("PUMP_1", value);
    sendRpcResponse(topic, true, value ? "pump_1 ON" : "pump_1 OFF");
    return;
  }

  if (strcmp(method, "pump_2") == 0) {
    sendCommandToMega("PUMP_2", value);
    sendRpcResponse(topic, true, value ? "pump_2 ON" : "pump_2 OFF");
    return;
  }

  if (strcmp(method, "pump_3") == 0) {
    sendCommandToMega("PUMP_3", value);
    sendRpcResponse(topic, true, value ? "pump_3 ON" : "pump_3 OFF");
    return;
  }

  Serial.print("Unknown RPC method: ");
  Serial.println(method);
  sendRpcResponse(topic, false, "Unknown method");
}

bool getRpcBooleanValue(JsonDocument& doc) {
  JsonVariant params = doc["params"];

  if (params.is<bool>()) {
    return params.as<bool>();
  }

  if (params.is<int>()) {
    return params.as<int>() != 0;
  }

  if (params.is<const char*>()) {
    String text = params.as<const char*>();
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
      String text = value.as<const char*>();
      text.trim();
      text.toLowerCase();
      return text == "true" || text == "on" || text == "1";
    }
  }

  return false;
}

// ==================================================
// COMMAND TO MEGA
// ==================================================

void sendRawCommandToMega(String command, int repeatCount, int delayMs) {
  Serial.print("Sending command to Mega: ");
  Serial.println(command);

  for (int i = 1; i <= repeatCount; i++) {
    megaSerial.println(command);
    megaSerial.flush();

    Serial.print("Command copy ");
    Serial.print(i);
    Serial.println(" sent to Mega.");

    delay(delayMs);
  }
}

void sendCommandToMega(String commandName, bool value) {
  String command = "";

  if (commandName == "RESET_SYSTEM") {
    sendRawCommandToMega("CMD:RESET_MEGA", 5, 120);
    return;
  }

  if (commandName == "PUMP_1") {
    command = value ? "CMD:PUMP_1_ON" : "CMD:PUMP_1_OFF";
  }
  else if (commandName == "PUMP_2") {
    command = value ? "CMD:PUMP_2_ON" : "CMD:PUMP_2_OFF";
  }
  else if (commandName == "PUMP_3") {
    command = value ? "CMD:PUMP_3_ON" : "CMD:PUMP_3_OFF";
  }
  else {
    Serial.print("Unknown command name for Mega: ");
    Serial.println(commandName);
    return;
  }

  sendRawCommandToMega(command, 3, 80);
}

// ==================================================
// RPC RESPONSE
// ==================================================

void sendRpcResponse(String topic, bool success, String message) {
  int requestIndex = topic.lastIndexOf('/');
  String requestId = "";

  if (requestIndex >= 0) {
    requestId = topic.substring(requestIndex + 1);
  }

  if (requestId.length() == 0) {
    Serial.println("Cannot send RPC response: request id not found.");
    return;
  }

  String responseTopic = "v1/devices/me/rpc/response/";
  responseTopic += requestId;

  StaticJsonDocument<256> responseDoc;
  responseDoc["success"] = success;
  responseDoc["message"] = message;

  String responsePayload;
  serializeJson(responseDoc, responsePayload);

  Serial.print("Sending RPC response topic: ");
  Serial.println(responseTopic);
  Serial.print("RPC response payload: ");
  Serial.println(responsePayload);

  mqttClient.publish(responseTopic.c_str(), responsePayload.c_str());
}

// ==================================================
// SETUP
// ==================================================

void setup() {
  Serial.begin(SERIAL_MONITOR_BAUD);
  megaSerial.begin(MEGA_SERIAL_BAUD);
  megaSerial.setTimeout(80);

  delay(2000);

  Serial.println();
  Serial.println("================================");
  Serial.println(" ESP8266 Mega Receiver MQTT RPC");
  Serial.println("================================");
  Serial.print("Serial Monitor baud: ");
  Serial.println(SERIAL_MONITOR_BAUD);
  Serial.print("Mega serial baud: ");
  Serial.println(MEGA_SERIAL_BAUD);

  connectToWiFi();

  mqttClient.setServer(THINGSBOARD_HOST, THINGSBOARD_MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
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

  if (megaSerial.available()) {
    String payload = megaSerial.readStringUntil('\n');
    payload.trim();

    if (payload.length() > 0) {
      Serial.println();
      Serial.println("Received from Mega:");
      Serial.println(payload);

      if (payload.startsWith("{") && payload.endsWith("}")) {
        sendTelemetryToThingsBoard(payload);
      } else {
        Serial.println("Invalid JSON format. Data ignored.");
      }
    }
  }
}
