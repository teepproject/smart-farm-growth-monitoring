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

const int sensorPin = A1;

const int jumlahSample = 50;
const int delaySample = 10;

int bacaRataRata() {
  long total = 0;
  int nilaiMin = 1023;
  int nilaiMax = 0;

  for (int i = 0; i < jumlahSample; i++) {
    int nilai = analogRead(sensorPin);

    total += nilai;

    if (nilai < nilaiMin) nilaiMin = nilai;
    if (nilai > nilaiMax) nilaiMax = nilai;

    delay(delaySample);
  }

  int rataRata = total / jumlahSample;

  Serial.print("RAW AVG: ");
  Serial.print(rataRata);
  Serial.print(" | MIN: ");
  Serial.print(nilaiMin);
  Serial.print(" | MAX: ");
  Serial.println(nilaiMax);

  return rataRata;
}

void setup() {
  Serial.begin(9600);
  delay(1000);

  Serial.println("=== KALIBRASI SOIL MOISTURE SENSOR A1 ===");
  Serial.println("Catat nilai saat kering, lalu saat tanah basah.");
  Serial.println();
}

void loop() {
  bacaRataRata();
  delay(1000);
}

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

const int sensorPin = A4;

const int jumlahSample = 50;
const int delaySample = 10;

int bacaRataRata() {
  long total = 0;
  int nilaiMin = 1023;
  int nilaiMax = 0;

  for (int i = 0; i < jumlahSample; i++) {
    int nilai = analogRead(sensorPin);

    total += nilai;

    if (nilai < nilaiMin) nilaiMin = nilai;
    if (nilai > nilaiMax) nilaiMax = nilai;

    delay(delaySample);
  }

  int rataRata = total / jumlahSample;

  Serial.print("RAW AVG: ");
  Serial.print(rataRata);
  Serial.print(" | MIN: ");
  Serial.print(nilaiMin);
  Serial.print(" | MAX: ");
  Serial.println(nilaiMax);

  return rataRata;
}

void setup() {
  Serial.begin(9600);
  delay(1000);

  Serial.println("=== KALIBRASI SOIL MOISTURE SENSOR A4 ===");
  Serial.println("Catat nilai saat kering, lalu saat tanah basah.");
  Serial.println();
}

void loop() {
  bacaRataRata();
  delay(1000);
}