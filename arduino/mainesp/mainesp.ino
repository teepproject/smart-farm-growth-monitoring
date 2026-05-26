/*
  ESP8266 Receiver + ThingsBoard MQTT Sender + RPC Receiver

  Fungsi:
  1. ESP8266 menerima JSON telemetry dari Arduino Mega melalui SoftwareSerial.
  2. ESP8266 mengirim telemetry ke ThingsBoard via MQTT.
  3. ESP8266 menerima RPC dari ThingsBoard:
     - pump_1 true/false
     - pump_2 true/false
     - pump_3 true/false
  4. ESP8266 meneruskan command ke Arduino Mega via SoftwareSerial.

  Wiring:
  Mega TX1 pin 18 -> voltage divider -> ESP D5 / GPIO14
  ESP D6 / GPIO12 -> Mega RX1 pin 19
  GND Mega -> GND ESP

  Serial Monitor ESP8266 = 115200
  Serial dari Mega = 9600
*/

#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <SoftwareSerial.h>

// ==========================
// SERIAL FROM/TO MEGA
// ==========================

// SoftwareSerial(rx, tx)
// D5 = RX dari Mega TX1
// D6 = TX ke Mega RX1
SoftwareSerial megaSerial(D5, D6);

// ==========================
// WIFI SETTINGS
// ==========================

const char* WIFI_SSID = "qwertyuiop";
const char* WIFI_PASSWORD = "00000000";

// ==========================
// THINGSBOARD MQTT SETTINGS
// ==========================

// Gunakan IP ThingsBoard yang bisa dijangkau ESP.
// Dari kode lama kamu, ThingsBoard berhasil diakses ESP lewat 192.168.137.1:8080.
// Untuk MQTT, port default ThingsBoard adalah 1883.
const char* THINGSBOARD_HOST = "192.168.137.1";
const int THINGSBOARD_MQTT_PORT = 1883;

// Access token device ThingsBoard kamu
const char* DEVICE_TOKEN = "FPHoXJJ2c0nXYVT05nxt";

// MQTT topics ThingsBoard
const char* TELEMETRY_TOPIC = "v1/devices/me/telemetry";
const char* RPC_SUBSCRIBE_TOPIC = "v1/devices/me/rpc/request/+";

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// ==========================
// FUNCTION DECLARATIONS
// ==========================

void connectToWiFi();
void connectToThingsBoard();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void sendTelemetryToThingsBoard(String payload);
void handleRpc(String topic, String message);
void sendCommandToMega(String command, bool value);
void sendRpcResponse(String topic, bool success, String message);

// ==========================
// CONNECT WIFI
// ==========================

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
      Serial.println("WiFi connection failed. Restarting...");
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

// ==========================
// CONNECT MQTT THINGSBOARD
// ==========================

void connectToThingsBoard() {
  while (!mqttClient.connected()) {
    Serial.println();
    Serial.println("Connecting to ThingsBoard MQTT...");
    Serial.print("Host: ");
    Serial.print(THINGSBOARD_HOST);
    Serial.print(":");
    Serial.println(THINGSBOARD_MQTT_PORT);

    // ThingsBoard MQTT:
    // clientId boleh kosong/random
    // username = DEVICE_TOKEN
    // password = NULL
    String clientId = "ESP8266_SMART_FARM_";
    clientId += String(ESP.getChipId());

    bool connected = mqttClient.connect(
      clientId.c_str(),
      DEVICE_TOKEN,
      NULL
    );

    if (connected) {
      Serial.println("Connected to ThingsBoard MQTT!");

      bool subOk = mqttClient.subscribe(RPC_SUBSCRIBE_TOPIC);

      if (subOk) {
        Serial.print("Subscribed to RPC topic: ");
        Serial.println(RPC_SUBSCRIBE_TOPIC);
      } else {
        Serial.println("Failed to subscribe RPC topic.");
      }

    } else {
      Serial.print("MQTT connection failed. State: ");
      Serial.println(mqttClient.state());
      Serial.println("Retrying in 5 seconds...");
      delay(5000);
    }
  }
}

// ==========================
// SEND TELEMETRY MQTT
// ==========================

void sendTelemetryToThingsBoard(String payload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Reconnecting...");
    connectToWiFi();
  }

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

// ==========================
// MQTT CALLBACK
// ==========================

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String topicStr = String(topic);
  String message = "";

  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.println();
  Serial.println("================================");
  Serial.println("RPC received from ThingsBoard");
  Serial.print("Topic: ");
  Serial.println(topicStr);
  Serial.print("Payload: ");
  Serial.println(message);
  Serial.println("================================");

  handleRpc(topicStr, message);
}

// ==========================
// HANDLE RPC
// ==========================

void handleRpc(String topic, String message) {
  StaticJsonDocument<512> doc;

  DeserializationError error = deserializeJson(doc, message);

  if (error) {
    Serial.print("Failed to parse RPC JSON: ");
    Serial.println(error.c_str());
    sendRpcResponse(topic, false, "Invalid JSON");
    return;
  }

  const char* method = doc["method"] | "";

  bool value = false;

  // Format dari bridge:
  // {
  //   "method": "pump_1",
  //   "params": {
  //     "value": true,
  //     "source": "supabase-dashboard",
  //     "command_id": 2
  //   }
  // }

  if (doc["params"].is<bool>()) {
    value = doc["params"].as<bool>();
  } else if (doc["params"]["value"].is<bool>()) {
    value = doc["params"]["value"].as<bool>();
  } else if (doc["params"]["value"].is<int>()) {
    value = doc["params"]["value"].as<int>() == 1;
  } else if (doc["params"].is<int>()) {
    value = doc["params"].as<int>() == 1;
  } else {
    Serial.println("RPC params.value not found. Default value = false.");
  }

  Serial.print("RPC Method: ");
  Serial.println(method);

  Serial.print("RPC Value: ");
  Serial.println(value ? "true" : "false");

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

// ==========================
// SEND COMMAND TO MEGA
// ==========================

void sendCommandToMega(String command, bool value) {
  String serialCommand = command;
  serialCommand += value ? "_ON" : "_OFF";

  Serial.print("Sending command to Mega: ");
  Serial.println(serialCommand);

  megaSerial.println(serialCommand);
}

// ==========================
// SEND RPC RESPONSE
// ==========================

void sendRpcResponse(String topic, bool success, String message) {
  // Request topic:
  // v1/devices/me/rpc/request/123
  // Response topic:
  // v1/devices/me/rpc/response/123

  int lastSlash = topic.lastIndexOf('/');

  if (lastSlash < 0) {
    Serial.println("Invalid RPC topic. Cannot send response.");
    return;
  }

  String requestId = topic.substring(lastSlash + 1);
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

// ==========================
// SETUP
// ==========================

void setup() {
  Serial.begin(115200);
  megaSerial.begin(9600);

  delay(2000);

  Serial.println();
  Serial.println("================================");
  Serial.println(" ESP8266 Mega Receiver MQTT RPC");
  Serial.println("================================");

  connectToWiFi();

  mqttClient.setServer(THINGSBOARD_HOST, THINGSBOARD_MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);

  connectToThingsBoard();

  Serial.println();
  Serial.println("Waiting JSON from Arduino Mega...");
}

// ==========================
// LOOP
// ==========================

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

      // Cek sederhana: harus JSON object
      if (payload.startsWith("{") && payload.endsWith("}")) {
        sendTelemetryToThingsBoard(payload);
      } else {
        Serial.println("Invalid JSON format. Data ignored.");
      }
    }
  }
}