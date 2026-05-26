# Supabase Bridge

Program ini mengambil telemetry terbaru dari ThingsBoard dan menyimpannya ke Supabase.

## Flow

Arduino Mega → ESP8266 → ThingsBoard → Node.js Bridge → Supabase

## Files

- `bridge.js` : program utama bridge
- `.env` : konfigurasi rahasia seperti Supabase key dan ThingsBoard login
- `package.json` : konfigurasi Node.js project

## Install

```bash
npm install