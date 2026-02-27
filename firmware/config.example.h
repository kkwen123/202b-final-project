#ifndef VOICE_NOTE_CONFIG_H
#define VOICE_NOTE_CONFIG_H

// Wi-Fi credentials used for upload and time sync.
#define WIFI_SSID "REPLACE_WITH_WIFI_SSID"
#define WIFI_PASSWORD "REPLACE_WITH_WIFI_PASSWORD"

// Backend endpoint for POST /api/v1/notes/upload.
#define BACKEND_HOST "192.168.1.100"
#define BACKEND_PORT 3000
#define BACKEND_PATH "/api/v1/notes/upload"
#define BACKEND_USE_TLS false

// Device authentication and metadata.
#define DEVICE_TOKEN "REPLACE_WITH_DEVICE_TOKEN"
#define DEVICE_ID "esp32-voice-note-01"

// GPIO mapping for ESP32 dev board (update as needed).
#define BUTTON_PIN 13
#define LED_PIN 2
#define SD_CS_PIN 5
#define I2S_WS_PIN 25
#define I2S_SCK_PIN 26
#define I2S_SD_PIN 33

#endif
