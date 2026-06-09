// Tes hasil kalibrasi Sensor A0
// Dry = 473
// Wet = 292
//
//const int sensorPin = A0;

//const int dryValue = 473;
//const int wetValue = 292;

//void setup() {
//  Serial.begin(9600);
//  delay(1000);

//  Serial.println("=== TES PERSENTASE MOISTURE A0 ===");
//}

//void loop() {
//  int rawValue = analogRead(sensorPin);

//  int moisturePercent = map(rawValue, dryValue, wetValue, 0, 100);
//  moisturePercent = constrain(moisturePercent, 0, 100);

//  Serial.print("RAW: ");
//  Serial.print(rawValue);
//  Serial.print(" | Moisture: ");
//  Serial.print(moisturePercent);
//  Serial.println("%");

//  delay(1000);
//}

// Kalibrasi Sensor A1
// Gunakan untuk mencari nilai kering dan basah Sensor A1

//const int sensorPin = A1;

//const int jumlahSample = 50;
//const int delaySample = 10;

//int bacaRataRata() {
//  long total = 0;
//  int nilaiMin = 1023;
//  int nilaiMax = 0;

//  for (int i = 0; i < jumlahSample; i++) {
//    int nilai = analogRead(sensorPin);

//    total += nilai;

//    if (nilai < nilaiMin) nilaiMin = nilai;
//    if (nilai > nilaiMax) nilaiMax = nilai;

//    delay(delaySample);
//  }

//  int rataRata = total / jumlahSample;

//  Serial.print("RAW AVG: ");
//  Serial.print(rataRata);
//  Serial.print(" | MIN: ");
//  Serial.print(nilaiMin);
//  Serial.print(" | MAX: ");
//  Serial.println(nilaiMax);

//  return rataRata;
//}

//void setup() {
//  Serial.begin(9600);
//  delay(1000);

//  Serial.println("=== KALIBRASI SOIL MOISTURE SENSOR A1 ===");
//  Serial.println("Catat nilai saat kering, lalu saat tanah basah.");
//  Serial.println();
//}

//void loop() {
//  bacaRataRata();
//  delay(1000);
//}

// Kalibrasi Sensor A2
// Gunakan untuk mencari nilai kering dan basah Sensor A2

//const int sensorPin = A2;

//const int jumlahSample = 50;
//const int delaySample = 10;

//int bacaRataRata() {
//  long total = 0;
//  int nilaiMin = 1023;
//  int nilaiMax = 0;

//  for (int i = 0; i < jumlahSample; i++) {
//    int nilai = analogRead(sensorPin);

//    total += nilai;

//    if (nilai < nilaiMin) nilaiMin = nilai;
//    if (nilai > nilaiMax) nilaiMax = nilai;

//    delay(delaySample);
//  }

//  int rataRata = total / jumlahSample;

//  Serial.print("RAW AVG: ");
//  Serial.print(rataRata);
//  Serial.print(" | MIN: ");
//  Serial.print(nilaiMin);
//  Serial.print(" | MAX: ");
//  Serial.println(nilaiMax);

//  return rataRata;
//}

//void setup() {
//  Serial.begin(9600);
//  delay(1000);

//  Serial.println("=== KALIBRASI SOIL MOISTURE SENSOR A2 ===");
//  Serial.println("Catat nilai saat kering, lalu saat tanah basah.");
//  Serial.println();
//}

//void loop() {
//  bacaRataRata();
//  delay(1000);
//}

// Kalibrasi Sensor A3
// Gunakan untuk mencari nilai kering dan basah Sensor A3

//const int sensorPin = A3;

//const int jumlahSample = 50;
//const int delaySample = 10;

//int bacaRataRata() {
//  long total = 0;
//  int nilaiMin = 1023;
//  int nilaiMax = 0;

//  for (int i = 0; i < jumlahSample; i++) {
//    int nilai = analogRead(sensorPin);

//    total += nilai;

//    if (nilai < nilaiMin) nilaiMin = nilai;
//    if (nilai > nilaiMax) nilaiMax = nilai;

//    delay(delaySample);
//  }

//  int rataRata = total / jumlahSample;

//  Serial.print("RAW AVG: ");
//  Serial.print(rataRata);
//  Serial.print(" | MIN: ");
//  Serial.print(nilaiMin);
//  Serial.print(" | MAX: ");
//  Serial.println(nilaiMax);

//  return rataRata;
//}

//void setup() {
//  Serial.begin(9600);
//  delay(1000);

//  Serial.println("=== KALIBRASI SOIL MOISTURE SENSOR A3 ===");
//  Serial.println("Catat nilai saat kering, lalu saat tanah basah.");
//  Serial.println();
//}

//void loop() {
//  bacaRataRata();
//  delay(1000);
//}

// Kalibrasi Sensor A4
// Gunakan untuk mencari nilai kering dan basah Sensor A3

//const int sensorPin = A4;

//const int jumlahSample = 50;
//const int delaySample = 10;

//int bacaRataRata() {
//  long total = 0;
//  int nilaiMin = 1023;
//  int nilaiMax = 0;

//  for (int i = 0; i < jumlahSample; i++) {
//    int nilai = analogRead(sensorPin);

//    total += nilai;

//    if (nilai < nilaiMin) nilaiMin = nilai;
//    if (nilai > nilaiMax) nilaiMax = nilai;

//    delay(delaySample);
//  }

//  int rataRata = total / jumlahSample;

//  Serial.print("RAW AVG: ");
//  Serial.print(rataRata);
//  Serial.print(" | MIN: ");
//  Serial.print(nilaiMin);
//  Serial.print(" | MAX: ");
//  Serial.println(nilaiMax);

//  return rataRata;
//}

//void setup() {
//  Serial.begin(9600);
//  delay(1000);

//  Serial.println("=== KALIBRASI SOIL MOISTURE SENSOR A4 ===");
//  Serial.println("Catat nilai saat kering, lalu saat tanah basah.");
//  Serial.println();
//}

//void loop() {
//  bacaRataRata();
//  delay(1000);
//}

// Calibration for Soil Moisture Sensor A5
// Use this code to find dry and wet calibration values for Sensor A5

const int sensorPin = A5;

const int sampleCount = 50;
const int sampleDelayMs = 10;

int readAverage() {
  long total = 0;
  int minValue = 1023;
  int maxValue = 0;

  for (int i = 0; i < sampleCount; i++) {
    int value = analogRead(sensorPin);

    total += value;

    if (value < minValue) minValue = value;
    if (value > maxValue) maxValue = value;

    delay(sampleDelayMs);
  }

  int averageValue = total / sampleCount;

  Serial.print("RAW AVG: ");
  Serial.print(averageValue);
  Serial.print(" | MIN: ");
  Serial.print(minValue);
  Serial.print(" | MAX: ");
  Serial.println(maxValue);

  return averageValue;
}

void setup() {
  Serial.begin(9600);
  delay(1000);

  Serial.println("=== SOIL MOISTURE SENSOR A5 CALIBRATION ===");
  Serial.println("Step 1: Read the value in dry soil or air.");
  Serial.println("Step 2: Read the value in very wet soil.");
  Serial.println("Write down the stable RAW AVG value.");
  Serial.println();
}

void loop() {
  readAverage();
  delay(1000);
}