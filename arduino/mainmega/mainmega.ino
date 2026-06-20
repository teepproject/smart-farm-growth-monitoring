/*
  ==========================================================
  PAKCHOI SMART FARMING SYSTEM - ARDUINO MEGA MAIN CODE
  ==========================================================

  Features:
  - Soil moisture sensors A0-A4 only
  - A5 disabled / not sent to telemetry
  - DHT22 on pin 39
  - RTC DS3231
  - Relay pin 8, 9, 10
  - Send JSON telemetry to ESP8266 using Serial1

  ESP8266 Wiring:
    Mega TX1 pin 18 -> ESP8266 D1 / GPIO5
    Mega RX1 pin 19 <- ESP8266 D2 / GPIO4
    Mega GND        -> ESP8266 GND

  Serial Monitor Arduino Mega:
    115200 baud
    New Line
*/

#include <Wire.h>
#include <RTClib.h>
#include <DHT.h>
#include <avr/wdt.h>

// ==================================================
// MODE SETTING
// ==================================================

// false = real irrigation schedule at 07:00
// true  = relay test based on RTC time
const bool TEST_MODE = false;

// true = relay interval test:
// Relay 1 every 3 seconds
// Relay 2 every 6 seconds
// Relay 3 every 9 seconds
const bool RELAY_INTERVAL_TEST_MODE = false;

// ==================================================
// RTC SETTINGS - GMT+08:00 LOCAL TIME
// ==================================================

RTC_DS3231 rtc;

// Use true only once to set the RTC.
// After the RTC time is correct, change this to false and upload again.
const bool SET_RTC_TIME_ON_UPLOAD = false;

// If the laptop is already set to GMT+08, keep this as 0.
// If the laptop is set to UTC and you want GMT+08, change this to 8.
const int RTC_COMPILE_TIME_OFFSET_HOURS = 0;

// ==================================================
// SOIL MOISTURE SETTINGS
// ==================================================

const int NUM_SENSORS = 5;

const int soilPins[NUM_SENSORS] = {
  A0, A1, A2, A3, A4
};

// Latest calibration values from your new calibration test:
// A0 dry/air = 481, wet = 241
// A1 dry/air = 484, wet = 217
// A2 dry/air = 486, wet = 266
// A3 dry/air = 493, wet = 258
// A4 dry/air = 492, wet = 234
// Important:
// These dry values are taken from sensor in air / very dry condition.
// If you later measure real dry soil, replace these dry values with the real dry-soil values.
int dryValues[NUM_SENSORS] = {
  481, 484, 486, 493, 492
};

int wetValues[NUM_SENSORS] = {
  241, 217, 266, 258, 234
};

// Sensor readings are averaged to make the values more stable
const int soilSampleCount = 30;
const int soilSampleDelayMs = 5;

int rawValues[NUM_SENSORS];
int moisturePercent[NUM_SENSORS];

// ==================================================
// DHT22 SETTINGS
// ==================================================

#define DHTPIN 39
#define DHTTYPE DHT22

DHT dht(DHTPIN, DHTTYPE);

// ==================================================
// RELAY SETTINGS
// ==================================================

const int relay1Pin = 8;
const int relay2Pin = 9;
const int relay3Pin = 10;

// Most relay modules are active LOW:
// LOW  = ON
// HIGH = OFF
const bool RELAY_ACTIVE_LOW = true;

bool relay1State = false;
bool relay2State = false;
bool relay3State = false;

uint32_t relay1OffTime = 0;
uint32_t relay2OffTime = 0;
uint32_t relay3OffTime = 0;

// ==================================================
// RELAY DURATION SETTINGS
// ==================================================

// Relay ON duration = 60 seconds / 1 minute
const uint32_t relay1OnDuration = 60;   // seconds
const uint32_t relay2OnDuration = 60;   // seconds
const uint32_t relay3OnDuration = 60;   // seconds

// ==================================================
// RELAY INTERVAL TEST SETTINGS
// ==================================================

const unsigned long relay1Interval = 3000;  // 3 seconds
const unsigned long relay2Interval = 6000;  // 6 seconds
const unsigned long relay3Interval = 9000;  // 9 seconds

unsigned long lastRelay1IntervalMillis = 0;
unsigned long lastRelay2IntervalMillis = 0;
unsigned long lastRelay3IntervalMillis = 0;

// ==================================================
// TEST MODE SCHEDULE BY RTC CLOCK
// ==================================================

const int testRelay1Hour = 16;
const int testRelay1Minute = 50;

const int testRelay2Hour = 16;
const int testRelay2Minute = 51;

const int testRelay3Hour = 16;
const int testRelay3Minute = 52;

bool testRelay1Done = false;
bool testRelay2Done = false;
bool testRelay3Done = false;

// ==================================================
// REAL IRRIGATION SCHEDULE
// ==================================================

const int wateringHour = 7;
const int wateringMinute = 0;

// This is the reference day for watering schedule.
// Day 1: 22 June 2026. Zone 1, Zone 2, and Zone 3 water at 07:00.
// Zone 2 repeats on day 4, 7, 10, ... from 22 June 2026.
// Zone 3 repeats on day 7, 13, 19, ... from 22 June 2026.
// Change this date if your experiment / planting start date is different.
const int startYear = 2026;
const int startMonth = 6;
const int startDay = 22;

int lastWateredDayZone1 = -1;
int lastWateredDayZone2 = -1;
int lastWateredDayZone3 = -1;

// ==================================================
// PRINT / TELEMETRY INTERVAL
// ==================================================

unsigned long lastPrintMillis = 0;
const unsigned long printInterval = 3000;

unsigned long lastTelemetryMillis = 0;
const unsigned long telemetryInterval = 5000;

// Mega Serial1 to ESP8266
const unsigned long espSerialBaud = 4800;

// ==================================================
// HELPER FUNCTIONS
// ==================================================

void print2Digits(int number) {
  if (number < 10) {
    Serial.print("0");
  }
  Serial.print(number);
}

// ==================================================
// RTC FUNCTION
// ==================================================

void setRtcTimeIfNeeded() {
  if (SET_RTC_TIME_ON_UPLOAD) {
    DateTime compileTime(F(__DATE__), F(__TIME__));
    DateTime adjustedTime = compileTime + TimeSpan(0, RTC_COMPILE_TIME_OFFSET_HOURS, 0, 0);

    rtc.adjust(adjustedTime);

    Serial.println();
    Serial.println("RTC time has been adjusted.");
    Serial.println("IMPORTANT:");
    Serial.println("After checking RTC time, set SET_RTC_TIME_ON_UPLOAD = false and upload again.");
    Serial.println();

    Serial.print("RTC Local Time GMT+08: ");
    print2Digits(adjustedTime.hour());
    Serial.print(":");
    print2Digits(adjustedTime.minute());
    Serial.print(":");
    print2Digits(adjustedTime.second());
    Serial.print("   ");
    print2Digits(adjustedTime.day());
    Serial.print("/");
    print2Digits(adjustedTime.month());
    Serial.print("/");
    Serial.println(adjustedTime.year());
  }
}

// ==================================================
// RELAY FUNCTIONS
// ==================================================

void relayOn(int pin) {
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(pin, LOW);
  } else {
    digitalWrite(pin, HIGH);
  }
}

void relayOff(int pin) {
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(pin, HIGH);
  } else {
    digitalWrite(pin, LOW);
  }
}

void startRelay1(uint32_t currentTime) {
  relay1State = true;
  relay1OffTime = currentTime + relay1OnDuration;
  relayOn(relay1Pin);

  Serial.println(">>> Relay 1 / Zone 1 ON");
}

void startRelay2(uint32_t currentTime) {
  relay2State = true;
  relay2OffTime = currentTime + relay2OnDuration;
  relayOn(relay2Pin);

  Serial.println(">>> Relay 2 / Zone 2 ON");
}

void startRelay3(uint32_t currentTime) {
  relay3State = true;
  relay3OffTime = currentTime + relay3OnDuration;
  relayOn(relay3Pin);

  Serial.println(">>> Relay 3 / Zone 3 ON");
}

void stopRelaysIfNeeded(uint32_t currentTime) {
  if (relay1State && currentTime >= relay1OffTime) {
    relay1State = false;
    relayOff(relay1Pin);

    Serial.println(">>> Relay 1 / Zone 1 OFF");
  }

  if (relay2State && currentTime >= relay2OffTime) {
    relay2State = false;
    relayOff(relay2Pin);

    Serial.println(">>> Relay 2 / Zone 2 OFF");
  }

  if (relay3State && currentTime >= relay3OffTime) {
    relay3State = false;
    relayOff(relay3Pin);

    Serial.println(">>> Relay 3 / Zone 3 OFF");
  }
}

// ==================================================
// RELAY INTERVAL TEST FUNCTION
// ==================================================

void handleRelayIntervalTest(uint32_t currentTime) {
  unsigned long nowMillis = millis();

  if (nowMillis - lastRelay1IntervalMillis >= relay1Interval) {
    lastRelay1IntervalMillis = nowMillis;

    if (!relay1State) {
      startRelay1(currentTime);
    }
  }

  if (nowMillis - lastRelay2IntervalMillis >= relay2Interval) {
    lastRelay2IntervalMillis = nowMillis;

    if (!relay2State) {
      startRelay2(currentTime);
    }
  }

  if (nowMillis - lastRelay3IntervalMillis >= relay3Interval) {
    lastRelay3IntervalMillis = nowMillis;

    if (!relay3State) {
      startRelay3(currentTime);
    }
  }
}

// ==================================================
// RELAY TEST COMMAND FUNCTIONS
// ==================================================

void printRelayTestHelp() {
  Serial.println();
  Serial.println("========== RELAY TEST COMMAND ==========");
  Serial.println("Type command in Serial Monitor:");
  Serial.println("r1     = Relay 1 / Pump Zone 1 ON");
  Serial.println("r2     = Relay 2 / Pump Zone 2 ON");
  Serial.println("r3     = Relay 3 / Pump Zone 3 ON");
  Serial.println("all    = Relay 1, 2, 3 ON together");
  Serial.println("off    = Turn OFF all relays");
  Serial.println("status = Show relay status");
  Serial.println("help   = Show this command list");
  Serial.println("========================================");
  Serial.println();
}

void printRelayStatus() {
  Serial.println();
  Serial.println("========== RELAY STATUS ==========");

  Serial.print("Relay 1 / Zone 1: ");
  Serial.println(relay1State ? "ON" : "OFF");

  Serial.print("Relay 2 / Zone 2: ");
  Serial.println(relay2State ? "ON" : "OFF");

  Serial.print("Relay 3 / Zone 3: ");
  Serial.println(relay3State ? "ON" : "OFF");

  Serial.println("==================================");
}

void forceAllRelaysOff() {
  relay1State = false;
  relay2State = false;
  relay3State = false;

  relayOff(relay1Pin);
  relayOff(relay2Pin);
  relayOff(relay3Pin);

  Serial.println(">>> All relays OFF");
}


// ==================================================
// COMMAND FROM ESP8266 / THINGSBOARD RPC
// ==================================================
//
// ESP8266 sends commands from ThingsBoard RPC to the Mega through Serial1.
// Accepted command format:
//   CMD:PUMP_1_ON
//   CMD:PUMP_1_OFF
//   CMD:PUMP_2_ON
//   CMD:PUMP_2_OFF
//   CMD:PUMP_3_ON
//   CMD:PUMP_3_OFF
//   CMD:RESET_MEGA
//
// Safety note:
// ON commands use startRelayX(), so the pump automatically turns OFF after
// relayXOnDuration to prevent it from staying ON if there is a connection issue.

void resetArduinoMega() {
  Serial.println("Reset command received. Restarting Arduino Mega...");
  forceAllRelaysOff();
  delay(500);

  wdt_enable(WDTO_15MS);

  while (true) {
    // wait for watchdog reset
  }
}

void setRelay1FromCommand(bool turnOn, uint32_t currentTime) {
  if (turnOn) {
    startRelay1(currentTime);
  } else {
    relay1State = false;
    relayOff(relay1Pin);
    Serial.println(">>> Relay 1 / Zone 1 OFF from ESP command");
  }
}

void setRelay2FromCommand(bool turnOn, uint32_t currentTime) {
  if (turnOn) {
    startRelay2(currentTime);
  } else {
    relay2State = false;
    relayOff(relay2Pin);
    Serial.println(">>> Relay 2 / Zone 2 OFF from ESP command");
  }
}

void setRelay3FromCommand(bool turnOn, uint32_t currentTime) {
  if (turnOn) {
    startRelay3(currentTime);
  } else {
    relay3State = false;
    relayOff(relay3Pin);
    Serial.println(">>> Relay 3 / Zone 3 OFF from ESP command");
  }
}

void handleCommandFromESP(uint32_t currentTime) {
  while (Serial1.available() > 0) {
    String rawLine = Serial1.readStringUntil('\n');
    rawLine.trim();

    if (rawLine.length() == 0) {
      continue;
    }

    String command = rawLine;
    command.toUpperCase();

    int cmdIndex = command.indexOf("CMD:");
    if (cmdIndex >= 0) {
      command = command.substring(cmdIndex + 4);
    }

    command.trim();

    Serial.println();
    Serial.println("========== COMMAND FROM ESP8266 ==========");
    Serial.print("Raw Line: ");
    Serial.println(rawLine);
    Serial.print("Parsed Command: ");
    Serial.println(command);

    if (command == "RESET_MEGA") {
      Serial.println(">>> Soft reset requested from dashboard");
      Serial.println("==========================================");
      resetArduinoMega();
    }
    else if (command == "PUMP_1_ON") {
      setRelay1FromCommand(true, currentTime);
    }
    else if (command == "PUMP_1_OFF") {
      setRelay1FromCommand(false, currentTime);
    }
    else if (command == "PUMP_2_ON") {
      setRelay2FromCommand(true, currentTime);
    }
    else if (command == "PUMP_2_OFF") {
      setRelay2FromCommand(false, currentTime);
    }
    else if (command == "PUMP_3_ON") {
      setRelay3FromCommand(true, currentTime);
    }
    else if (command == "PUMP_3_OFF") {
      setRelay3FromCommand(false, currentTime);
    }
    else {
      Serial.print("Unknown ESP command: ");
      Serial.println(command);
    }

    Serial.println("==========================================");
  }
}

void handleRelayTestCommand(uint32_t currentTime) {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toLowerCase();

    if (command == "r1" || command == "1") {
      startRelay1(currentTime);
    }
    else if (command == "r2" || command == "2") {
      startRelay2(currentTime);
    }
    else if (command == "r3" || command == "3") {
      startRelay3(currentTime);
    }
    else if (command == "all") {
      startRelay1(currentTime);
      startRelay2(currentTime);
      startRelay3(currentTime);
    }
    else if (command == "off") {
      forceAllRelaysOff();
    }
    else if (command == "status") {
      printRelayStatus();
    }
    else if (command == "help") {
      printRelayTestHelp();
    }
    else if (command.length() > 0) {
      Serial.print("Unknown command: ");
      Serial.println(command);
      Serial.println("Type 'help' to see relay test commands.");
    }
  }
}

// ==================================================
// DATE / EXPERIMENT DAY FUNCTION
// ==================================================

int getExperimentDay(DateTime now) {
  DateTime startDate(startYear, startMonth, startDay, 0, 0, 0);
  TimeSpan elapsed = now - startDate;

  int days = elapsed.days();

  if (days < 0) {
    return 0;
  }

  return days + 1;
}

// ==================================================
// SENSOR FUNCTIONS
// ==================================================

int readSoilAverage(int pin) {
  long total = 0;

  for (int i = 0; i < soilSampleCount; i++) {
    total += analogRead(pin);
    delay(soilSampleDelayMs);
  }

  return total / soilSampleCount;
}

void readSoilSensors() {
  for (int i = 0; i < NUM_SENSORS; i++) {
    rawValues[i] = readSoilAverage(soilPins[i]);

    moisturePercent[i] = map(
      rawValues[i],
      dryValues[i],
      wetValues[i],
      0,
      100
    );

    moisturePercent[i] = constrain(moisturePercent[i], 0, 100);
  }
}

// ==================================================
// TEST SCHEDULE FUNCTION
// ==================================================

void handleTestSchedule(DateTime now, uint32_t currentTime) {
  if (
    !testRelay1Done &&
    now.hour() == testRelay1Hour &&
    now.minute() == testRelay1Minute
  ) {
    startRelay1(currentTime);
    testRelay1Done = true;
  }

  if (
    !testRelay2Done &&
    now.hour() == testRelay2Hour &&
    now.minute() == testRelay2Minute
  ) {
    startRelay2(currentTime);
    testRelay2Done = true;
  }

  if (
    !testRelay3Done &&
    now.hour() == testRelay3Hour &&
    now.minute() == testRelay3Minute
  ) {
    startRelay3(currentTime);
    testRelay3Done = true;
  }
}

// ==================================================
// REAL IRRIGATION SCHEDULE FUNCTION
// ==================================================

void handleRealIrrigationSchedule(DateTime now, uint32_t currentTime) {
  int experimentDay = getExperimentDay(now);

  bool isWateringTime =
    now.hour() == wateringHour &&
    now.minute() == wateringMinute;

  if (!isWateringTime) {
    return;
  }

  // Zone 1: every day
  if (lastWateredDayZone1 != experimentDay) {
    startRelay1(currentTime);
    lastWateredDayZone1 = experimentDay;
  }

  // Zone 2: every 3 days
  if ((experimentDay - 1) % 3 == 0) {
    if (lastWateredDayZone2 != experimentDay) {
      startRelay2(currentTime);
      lastWateredDayZone2 = experimentDay;
    }
  }

  // Zone 3: every 6 days
  if ((experimentDay - 1) % 6 == 0) {
    if (lastWateredDayZone3 != experimentDay) {
      startRelay3(currentTime);
      lastWateredDayZone3 = experimentDay;
    }
  }
}

// ==================================================
// SEND JSON TELEMETRY TO ESP8266
// ==================================================

void sendTelemetryToESP(DateTime now, float temperature, float humidity) {
  int zone1Avg = (moisturePercent[0] + moisturePercent[1]) / 2;
  int zone2Avg = (moisturePercent[2] + moisturePercent[3]) / 2;
  int zone3Avg = moisturePercent[4];

  if (isnan(temperature)) {
    temperature = -1;
  }

  if (isnan(humidity)) {
    humidity = -1;
  }

  int pump_z1 = relay1State ? 1 : 0;
  int pump_z2 = relay2State ? 1 : 0;
  int pump_z3 = relay3State ? 1 : 0;

  String payload = "{";

  payload += "\"soil_z1_s1\":" + String(moisturePercent[0]) + ",";
  payload += "\"soil_z1_s2\":" + String(moisturePercent[1]) + ",";
  payload += "\"soil_z2_s1\":" + String(moisturePercent[2]) + ",";
  payload += "\"soil_z2_s2\":" + String(moisturePercent[3]) + ",";
  payload += "\"soil_z3_s1\":" + String(moisturePercent[4]) + ",";
  // A5 / Zone 3 Sensor 2 is disabled for now.
  // Do not send soil_z3_s2 to ESP8266 / ThingsBoard / Supabase.

  payload += "\"soil_z1_avg\":" + String(zone1Avg) + ",";
  payload += "\"soil_z2_avg\":" + String(zone2Avg) + ",";
  payload += "\"soil_z3_avg\":" + String(zone3Avg) + ",";

  payload += "\"raw_a0\":" + String(rawValues[0]) + ",";
  payload += "\"raw_a1\":" + String(rawValues[1]) + ",";
  payload += "\"raw_a2\":" + String(rawValues[2]) + ",";
  payload += "\"raw_a3\":" + String(rawValues[3]) + ",";
  payload += "\"raw_a4\":" + String(rawValues[4]) + ",";

  payload += "\"temperature\":" + String(temperature, 1) + ",";
  payload += "\"humidity\":" + String(humidity, 1) + ",";

  payload += "\"pump_z1\":" + String(pump_z1) + ",";
  payload += "\"pump_z2\":" + String(pump_z2) + ",";
  payload += "\"pump_z3\":" + String(pump_z3) + ",";

  payload += "\"pump_z1_status\":\"" + String(relay1State ? "ON" : "OFF") + "\",";
  payload += "\"pump_z2_status\":\"" + String(relay2State ? "ON" : "OFF") + "\",";
  payload += "\"pump_z3_status\":\"" + String(relay3State ? "ON" : "OFF") + "\",";

  payload += "\"experiment_day\":" + String(getExperimentDay(now)) + ",";
  payload += "\"rtc_hour\":" + String(now.hour()) + ",";
  payload += "\"rtc_minute\":" + String(now.minute()) + ",";
  payload += "\"rtc_second\":" + String(now.second());

  payload += "}";

  Serial.println();
  Serial.println("Sending JSON to ESP8266:");
  Serial.println(payload);

  Serial1.println(payload);
}

// ==================================================
// PRINT MONITORING DATA
// ==================================================

void printMonitoringData(DateTime now, float temperature, float humidity) {
  int zone1Avg = (moisturePercent[0] + moisturePercent[1]) / 2;
  int zone2Avg = (moisturePercent[2] + moisturePercent[3]) / 2;
  int zone3Avg = moisturePercent[4];

  Serial.println();
  Serial.println("========== Pakchoi Monitoring ==========");

  Serial.print("RTC Time GMT+08: ");
  print2Digits(now.hour());
  Serial.print(":");
  print2Digits(now.minute());
  Serial.print(":");
  print2Digits(now.second());

  Serial.print("   ");

  print2Digits(now.day());
  Serial.print("/");
  print2Digits(now.month());
  Serial.print("/");
  Serial.println(now.year());

  Serial.print("Experiment Day: ");
  Serial.println(getExperimentDay(now));

  Serial.println("---------- Soil Moisture ----------");

  Serial.print("A0 / Zone 1 Sensor 1 | Raw: ");
  Serial.print(rawValues[0]);
  Serial.print(" | Moisture: ");
  Serial.print(moisturePercent[0]);
  Serial.println(" %");

  Serial.print("A1 / Zone 1 Sensor 2 | Raw: ");
  Serial.print(rawValues[1]);
  Serial.print(" | Moisture: ");
  Serial.print(moisturePercent[1]);
  Serial.println(" %");

  Serial.print("A2 / Zone 2 Sensor 1 | Raw: ");
  Serial.print(rawValues[2]);
  Serial.print(" | Moisture: ");
  Serial.print(moisturePercent[2]);
  Serial.println(" %");

  Serial.print("A3 / Zone 2 Sensor 2 | Raw: ");
  Serial.print(rawValues[3]);
  Serial.print(" | Moisture: ");
  Serial.print(moisturePercent[3]);
  Serial.println(" %");

  Serial.print("A4 / Zone 3 Sensor 1 | Raw: ");
  Serial.print(rawValues[4]);
  Serial.print(" | Moisture: ");
  Serial.print(moisturePercent[4]);
  Serial.println(" %");

  Serial.println("A5 / Zone 3 Sensor 2 | Disabled / not used");

  Serial.println("---------- Zone Average ----------");

  Serial.print("Zone 1 Average: ");
  Serial.print(zone1Avg);
  Serial.println(" %");

  Serial.print("Zone 2 Average: ");
  Serial.print(zone2Avg);
  Serial.println(" %");

  Serial.print("Zone 3 Average: ");
  Serial.print(zone3Avg);
  Serial.println(" %");

  Serial.println("---------- DHT22 ----------");

  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("Failed to read from DHT22 sensor!");
  } else {
    Serial.print("Air Temperature: ");
    Serial.print(temperature);
    Serial.println(" C");

    Serial.print("Air Humidity: ");
    Serial.print(humidity);
    Serial.println(" %");
  }

  Serial.println("---------- Relay Status ----------");

  Serial.print("Relay 1 / Zone 1: ");
  Serial.println(relay1State ? "ON" : "OFF");

  Serial.print("Relay 2 / Zone 2: ");
  Serial.println(relay2State ? "ON" : "OFF");

  Serial.print("Relay 3 / Zone 3: ");
  Serial.println(relay3State ? "ON" : "OFF");

  Serial.println("========================================");
}

// ==================================================
// SETUP
// ==================================================

void setup() {
  Serial.begin(115200);
  Serial1.begin(espSerialBaud);

  Serial.setTimeout(50);

  delay(1000);

  dht.begin();

  pinMode(relay1Pin, OUTPUT);
  pinMode(relay2Pin, OUTPUT);
  pinMode(relay3Pin, OUTPUT);

  relayOff(relay1Pin);
  relayOff(relay2Pin);
  relayOff(relay3Pin);

  Serial.println("=====================================");
  Serial.println(" Pakchoi Smart Farming System");
  Serial.println(" Soil calibrated A0-A4 only + DHT22 + RTC GMT+08 + Relay + ESP8266 Telemetry");
  Serial.println("=====================================");
  Serial.print("Serial1 to ESP8266 baud: ");
  Serial.println(espSerialBaud);

  if (!rtc.begin()) {
    Serial.println("RTC not found!");
    while (1);
  }

  setRtcTimeIfNeeded();

  if (rtc.lostPower() && !SET_RTC_TIME_ON_UPLOAD) {
    Serial.println("RTC lost power detected.");
    Serial.println("RTC has been set using compile time.");
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  if (RELAY_INTERVAL_TEST_MODE) {
    Serial.println("RELAY INTERVAL TEST MODE ACTIVE");
    Serial.println("Relay 1: every 3 seconds");
    Serial.println("Relay 2: every 6 seconds");
    Serial.println("Relay 3: every 9 seconds");
    Serial.println("Each relay ON duration: 60 seconds");
  }
  else if (TEST_MODE) {
    Serial.println("TEST MODE ACTIVE");

    Serial.print("Relay 1 ON at ");
    print2Digits(testRelay1Hour);
    Serial.print(":");
    print2Digits(testRelay1Minute);
    Serial.println();

    Serial.print("Relay 2 ON at ");
    print2Digits(testRelay2Hour);
    Serial.print(":");
    print2Digits(testRelay2Minute);
    Serial.println();

    Serial.print("Relay 3 ON at ");
    print2Digits(testRelay3Hour);
    Serial.print(":");
    print2Digits(testRelay3Minute);
    Serial.println();
  }
  else {
    Serial.println("REAL IRRIGATION MODE ACTIVE");
    Serial.println("Zone 1: every day at 07:00");
    Serial.println("Zone 2: every 3 days at 07:00");
    Serial.println("Zone 3: every 6 days at 07:00");
    Serial.println("Start date / Day 1: 22/06/2026");
  }

  Serial.println("RTC found.");
  printRelayTestHelp();
  Serial.println("System ready.");
}

// ==================================================
// LOOP
// ==================================================

void loop() {
  DateTime now = rtc.now();
  uint32_t currentTime = now.unixtime();

  handleRelayTestCommand(currentTime);
  handleCommandFromESP(currentTime);

  readSoilSensors();

  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();

  // Turn relays OFF first if the ON duration has finished.
  // This is important so the relays do not appear to stay ON continuously.
  stopRelaysIfNeeded(currentTime);

  if (RELAY_INTERVAL_TEST_MODE) {
    handleRelayIntervalTest(currentTime);
  }
  else if (TEST_MODE) {
    handleTestSchedule(now, currentTime);
  }
  else {
    handleRealIrrigationSchedule(now, currentTime);
  }

  if (millis() - lastPrintMillis >= printInterval) {
    lastPrintMillis = millis();
    printMonitoringData(now, temperature, humidity);
  }

  if (millis() - lastTelemetryMillis >= telemetryInterval) {
    lastTelemetryMillis = millis();
    sendTelemetryToESP(now, temperature, humidity);
    Serial1.flush();
    handleCommandFromESP(currentTime);
  }
}