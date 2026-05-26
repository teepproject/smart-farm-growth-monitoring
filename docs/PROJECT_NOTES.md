# TEEP Smart Farm Growth Monitoring

## Project Overview
Sistem ini digunakan untuk monitoring dan automatic irrigation pada smart farm.

## Hardware
- Arduino Mega
- ESP8266 NodeMCU
- RTC DS3231
- DHT22
- 6 capacitive soil moisture sensor A0-A5
- Relay 3 channel
- 3 pompa

## Platform
- Arduino IDE untuk Mega dan ESP8266
- ThingsBoard untuk IoT dashboard
- VSCode untuk struktur project dan Supabase bridge
- Supabase untuk cloud database

## Current Status
- Arduino Mega membaca sensor, RTC, dan relay
- ESP8266 mengirim telemetry ke ThingsBoard
- Dashboard ThingsBoard sudah berhasil
- Pump status tampil ON/OFF
- RTC sudah GMT+08
- Experiment Day dimulai 1 Juni 2026
- Relay otomatis sudah berhasil dites
- Kamera belum dimasukkan karena masih perlu perbaikan
- Supabase project sudah dibuat
- Tabel sensor_readings sudah dibuat
- Node.js Supabase bridge berhasil mengirim data dari ThingsBoard ke Supabase
- Data berhasil masuk ke Supabase setiap 10 detik
- Supabase bridge berhasil dijalankan otomatis melalui Windows Task Scheduler
- Log bridge tersimpan di `supabase-bridge/logs/bridge.log`
- Data telemetry berhasil masuk otomatis ke tabel `sensor_readings`
- ThingsBoard berhasil diakses melalui Tailscale
- IP Tailscale komputer ThingsBoard: `100.83.225.103`
- Dashboard dapat dibuka dari perangkat lain menggunakan `http://100.83.225.103:8080`
- Supabase bridge berhasil dijalankan otomatis melalui Task Scheduler
- Data telemetry berhasil masuk ke Supabase

# Supabase Bridge

Program ini mengambil telemetry terbaru dari ThingsBoard dan menyimpannya ke Supabase.

## Flow

Arduino Mega → ESP8266 → ThingsBoard → Node.js Bridge → Supabase

## Install

```bash
npm install