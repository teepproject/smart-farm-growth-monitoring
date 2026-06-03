// Tes gabungan Soil Moisture Sensor A0-A5
// Arduino Mega 2560
// Capacitive Soil Moisture Sensor V1.2
// A5 sementara disamakan dengan A4 karena belum dikalibrasi

const int totalSensors = 6;

// Pin sensor
const int sensorPins[totalSensors] = {
  A0,  // Sensor 1
  A1,  // Sensor 2
  A2,  // Sensor 3
  A3,  // Sensor 4
  A4,  // Sensor 5
  A5   // Sensor 6
};

// Nilai kalibrasi kering masing-masing sensor
const int dryValue[totalSensors] = {
  473, // A0 dry
  478, // A1 dry
  478, // A2 dry
  483, // A3 dry
  483, // A4 dry
  483  // A5 dry sementara sama dengan A4
};

// Nilai kalibrasi basah masing-masing sensor
const int wetValue[totalSensors] = {
  292, // A0 wet
  299, // A1 wet
  291, // A2 wet
  291, // A3 wet
  281, // A4 wet
  281  // A5 wet sementara sama dengan A4
};

// Untuk pembacaan rata-rata agar lebih stabil
const int jumlahSample = 30;
const int delaySample = 5;

int bacaRataRata(int pin) {
  long total = 0;

  for (int i = 0; i < jumlahSample; i++) {
    total += analogRead(pin);
    delay(delaySample);
  }

  return total / jumlahSample;
}

int hitungMoisturePercent(int rawValue, int dry, int wet) {
  int moisturePercent = map(rawValue, dry, wet, 0, 100);
  moisturePercent = constrain(moisturePercent, 0, 100);
  return moisturePercent;
}

void setup() {
  Serial.begin(9600);
  delay(1000);

  Serial.println("=== TES GABUNGAN MOISTURE SENSOR A0-A5 ===");
  Serial.println("A0: dry = 473, wet = 292");
  Serial.println("A1: dry = 478, wet = 299");
  Serial.println("A2: dry = 478, wet = 291");
  Serial.println("A3: dry = 483, wet = 291");
  Serial.println("A4: dry = 483, wet = 281");
  Serial.println("A5: dry = 483, wet = 281 sementara sama dengan A4");
  Serial.println();
}

void loop() {
  Serial.println("================================");

  for (int i = 0; i < totalSensors; i++) {
    int rawValue = bacaRataRata(sensorPins[i]);

    int moisturePercent = hitungMoisturePercent(
      rawValue,
      dryValue[i],
      wetValue[i]
    );

    Serial.print("Sensor ");
    Serial.print(i + 1);
    Serial.print(" | Pin A");
    Serial.print(i);
    Serial.print(" | RAW: ");
    Serial.print(rawValue);
    Serial.print(" | Moisture: ");
    Serial.print(moisturePercent);
    Serial.println("%");
  }

  Serial.println("================================");
  Serial.println();

  delay(2000);
}