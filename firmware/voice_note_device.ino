#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <FS.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <driver/i2s.h>
#include <mbedtls/sha256.h>
#include <time.h>

#if __has_include("config.h")
#include "config.h"
#else
#error "Missing config.h. Copy firmware/config.example.h to firmware/config.h and fill values."
#endif

static const uint32_t SAMPLE_RATE_HZ = 16000;
static const uint16_t WAV_BITS_PER_SAMPLE = 16;
static const uint8_t WAV_CHANNELS = 1;
static const uint32_t MAX_RECORDING_MS = 5UL * 60UL * 1000UL;
static const uint32_t BUTTON_DEBOUNCE_MS = 35;
static const uint32_t WIFI_CONNECT_TIMEOUT_MS = 12000;
static const uint32_t HTTP_RESPONSE_TIMEOUT_MS = 30000;
static const uint32_t QUEUE_RETRY_INTERVAL_MS = 15000;

static const char *QUEUE_DIR = "/queue";

static const char *STATE_READY = "ready";
static const char *STATE_UPLOADING = "uploading";
static const char *STATE_DONE = "done";
static const char *STATE_ERROR = "error";

struct NoteMeta {
  String noteId;
  uint64_t createdUnixMs = 0;
  uint32_t durationMs = 0;
  uint32_t attempts = 0;
  String state = STATE_READY;
  String sha256Hex;
  String lastError;
};

static bool gSdReady = false;
static bool gRecording = false;
static bool gClockSynced = false;

static uint32_t gLastDebounceMs = 0;
static int gLastButtonReading = HIGH;
static int gStableButtonState = HIGH;

static uint32_t gRecordingStartMs = 0;
static uint32_t gLastQueueRetryMs = 0;
static uint32_t gDataBytesWritten = 0;

static File gRecordingFile;
static String gActiveNoteId;
static String gActiveTmpPath;

static int32_t gI2sRawBuffer[256];
static int16_t gPcmBuffer[256];

void logCode(const char *code, const String &message) {
  Serial.print("[");
  Serial.print(code);
  Serial.print("] ");
  Serial.println(message);
}

String wavPathForNote(const String &noteId) {
  return String(QUEUE_DIR) + "/" + noteId + ".wav";
}

String tmpPathForNote(const String &noteId) {
  return String(QUEUE_DIR) + "/" + noteId + ".tmp";
}

String metaPathForNote(const String &noteId) {
  return String(QUEUE_DIR) + "/" + noteId + ".meta";
}

String trimLine(const String &input) {
  String output = input;
  output.trim();
  return output;
}

uint64_t currentUnixMs() {
  time_t now = time(nullptr);
  if (now > 1700000000) {
    return static_cast<uint64_t>(now) * 1000ULL;
  }
  return static_cast<uint64_t>(millis());
}

void writeWavHeader(File &file, uint32_t dataBytes) {
  const uint32_t byteRate = SAMPLE_RATE_HZ * WAV_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);
  const uint16_t blockAlign = WAV_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);
  const uint32_t riffChunkSize = 36 + dataBytes;

  uint8_t header[44];
  memcpy(header + 0, "RIFF", 4);
  header[4] = riffChunkSize & 0xFF;
  header[5] = (riffChunkSize >> 8) & 0xFF;
  header[6] = (riffChunkSize >> 16) & 0xFF;
  header[7] = (riffChunkSize >> 24) & 0xFF;
  memcpy(header + 8, "WAVE", 4);
  memcpy(header + 12, "fmt ", 4);
  header[16] = 16;
  header[17] = 0;
  header[18] = 0;
  header[19] = 0;
  header[20] = 1;
  header[21] = 0;
  header[22] = WAV_CHANNELS;
  header[23] = 0;
  header[24] = SAMPLE_RATE_HZ & 0xFF;
  header[25] = (SAMPLE_RATE_HZ >> 8) & 0xFF;
  header[26] = (SAMPLE_RATE_HZ >> 16) & 0xFF;
  header[27] = (SAMPLE_RATE_HZ >> 24) & 0xFF;
  header[28] = byteRate & 0xFF;
  header[29] = (byteRate >> 8) & 0xFF;
  header[30] = (byteRate >> 16) & 0xFF;
  header[31] = (byteRate >> 24) & 0xFF;
  header[32] = blockAlign & 0xFF;
  header[33] = (blockAlign >> 8) & 0xFF;
  header[34] = WAV_BITS_PER_SAMPLE;
  header[35] = 0;
  memcpy(header + 36, "data", 4);
  header[40] = dataBytes & 0xFF;
  header[41] = (dataBytes >> 8) & 0xFF;
  header[42] = (dataBytes >> 16) & 0xFF;
  header[43] = (dataBytes >> 24) & 0xFF;

  file.seek(0);
  file.write(header, sizeof(header));
}

bool ensureQueueDir() {
  if (!SD.exists(QUEUE_DIR)) {
    if (!SD.mkdir(QUEUE_DIR)) {
      logCode("S101", "Failed to create /queue");
      return false;
    }
  }
  return true;
}

bool saveMeta(const NoteMeta &meta) {
  String path = metaPathForNote(meta.noteId);
  if (SD.exists(path)) {
    SD.remove(path);
  }

  File file = SD.open(path, FILE_WRITE);
  if (!file) {
    logCode("S102", "Failed to open .meta for write: " + meta.noteId);
    return false;
  }

  file.seek(0);
  file.print("note_id=");
  file.println(meta.noteId);
  file.print("created_unix_ms=");
  file.println(String(meta.createdUnixMs));
  file.print("duration_ms=");
  file.println(meta.durationMs);
  file.print("attempts=");
  file.println(meta.attempts);
  file.print("state=");
  file.println(meta.state);
  file.print("sha256_hex=");
  file.println(meta.sha256Hex);
  file.print("last_error=");
  file.println(meta.lastError);
  file.flush();
  file.close();
  return true;
}

bool loadMeta(const String &noteId, NoteMeta &meta) {
  File file = SD.open(metaPathForNote(noteId), FILE_READ);
  if (!file) {
    return false;
  }

  meta = NoteMeta();
  meta.noteId = noteId;

  while (file.available()) {
    String line = trimLine(file.readStringUntil('\n'));
    if (line.length() == 0) {
      continue;
    }

    int equals = line.indexOf('=');
    if (equals <= 0) {
      continue;
    }

    String key = line.substring(0, equals);
    String value = line.substring(equals + 1);

    if (key == "note_id") {
      meta.noteId = value;
    } else if (key == "created_unix_ms") {
      meta.createdUnixMs = strtoull(value.c_str(), nullptr, 10);
    } else if (key == "duration_ms") {
      meta.durationMs = static_cast<uint32_t>(value.toInt());
    } else if (key == "attempts") {
      meta.attempts = static_cast<uint32_t>(value.toInt());
    } else if (key == "state") {
      meta.state = value;
    } else if (key == "sha256_hex") {
      meta.sha256Hex = value;
    } else if (key == "last_error") {
      meta.lastError = value;
    }
  }

  file.close();

  if (meta.noteId.length() == 0) {
    meta.noteId = noteId;
  }

  return true;
}

bool deleteNoteFiles(const String &noteId) {
  bool ok = true;
  String wavPath = wavPathForNote(noteId);
  String metaPath = metaPathForNote(noteId);

  if (SD.exists(wavPath) && !SD.remove(wavPath)) {
    ok = false;
  }
  if (SD.exists(metaPath) && !SD.remove(metaPath)) {
    ok = false;
  }

  return ok;
}

bool computeSha256ForFile(const String &path, String &sha256Out) {
  File file = SD.open(path, FILE_READ);
  if (!file) {
    return false;
  }

  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  if (mbedtls_sha256_starts_ret(&ctx, 0) != 0) {
    mbedtls_sha256_free(&ctx);
    file.close();
    return false;
  }

  uint8_t buffer[1024];
  while (file.available()) {
    size_t readLen = file.read(buffer, sizeof(buffer));
    if (readLen == 0) {
      break;
    }
    if (mbedtls_sha256_update_ret(&ctx, buffer, readLen) != 0) {
      mbedtls_sha256_free(&ctx);
      file.close();
      return false;
    }
  }

  uint8_t digest[32];
  if (mbedtls_sha256_finish_ret(&ctx, digest) != 0) {
    mbedtls_sha256_free(&ctx);
    file.close();
    return false;
  }

  mbedtls_sha256_free(&ctx);
  file.close();

  char hex[65];
  for (int i = 0; i < 32; ++i) {
    sprintf(hex + (i * 2), "%02x", digest[i]);
  }
  hex[64] = '\0';
  sha256Out = String(hex);
  return true;
}

void cleanupStaleFiles() {
  File dir = SD.open(QUEUE_DIR);
  if (!dir || !dir.isDirectory()) {
    return;
  }

  File entry;
  while ((entry = dir.openNextFile())) {
    String name = String(entry.name());
    entry.close();

    if (name.endsWith(".tmp")) {
      SD.remove(name);
      logCode("S103", "Removed stale temp file: " + name);
      continue;
    }

    if (name.endsWith(".meta")) {
      int slash = name.lastIndexOf('/');
      String fileOnly = slash >= 0 ? name.substring(slash + 1) : name;
      String noteId = fileOnly.substring(0, fileOnly.length() - 5);

      NoteMeta meta;
      if (loadMeta(noteId, meta) && meta.state == STATE_UPLOADING) {
        meta.state = STATE_ERROR;
        meta.lastError = "Recovered from interrupted upload";
        saveMeta(meta);
      }
    }
  }
}

bool initI2S() {
  i2s_config_t config = {
    .mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = static_cast<int>(SAMPLE_RATE_HZ),
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 256,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pins = {
    .bck_io_num = I2S_SCK_PIN,
    .ws_io_num = I2S_WS_PIN,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD_PIN
  };

  esp_err_t install = i2s_driver_install(I2S_NUM_0, &config, 0, nullptr);
  if (install != ESP_OK) {
    logCode("I101", "i2s_driver_install failed");
    return false;
  }

  esp_err_t setPins = i2s_set_pin(I2S_NUM_0, &pins);
  if (setPins != ESP_OK) {
    logCode("I102", "i2s_set_pin failed");
    return false;
  }

  i2s_zero_dma_buffer(I2S_NUM_0);
  return true;
}

String generateNoteId() {
  uint32_t randomValue = esp_random() & 0xFFFF;
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "%lu-%04X", static_cast<unsigned long>(millis()), randomValue);
  return String(buffer);
}

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
  }

  if (WiFi.status() != WL_CONNECTED) {
    logCode("N101", "Wi-Fi connection timed out");
    return false;
  }

  if (!gClockSynced) {
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    uint32_t syncStart = millis();
    while ((millis() - syncStart) < 5000) {
      time_t now = time(nullptr);
      if (now > 1700000000) {
        gClockSynced = true;
        break;
      }
      delay(100);
    }
  }

  return true;
}

bool readButtonPressedEdge() {
  int reading = digitalRead(BUTTON_PIN);
  if (reading != gLastButtonReading) {
    gLastDebounceMs = millis();
    gLastButtonReading = reading;
  }

  if ((millis() - gLastDebounceMs) > BUTTON_DEBOUNCE_MS && reading != gStableButtonState) {
    gStableButtonState = reading;
    if (gStableButtonState == LOW) {
      return true;
    }
  }

  return false;
}

bool startRecording() {
  if (!gSdReady) {
    logCode("R101", "Cannot record: SD not ready");
    return false;
  }
  if (gRecording) {
    return false;
  }

  gActiveNoteId = generateNoteId();
  gActiveTmpPath = tmpPathForNote(gActiveNoteId);
  gRecordingFile = SD.open(gActiveTmpPath, FILE_WRITE);
  if (!gRecordingFile) {
    logCode("R102", "Failed to open temp wav for write");
    return false;
  }

  uint8_t blankHeader[44] = {0};
  if (gRecordingFile.write(blankHeader, sizeof(blankHeader)) != sizeof(blankHeader)) {
    gRecordingFile.close();
    SD.remove(gActiveTmpPath);
    logCode("R103", "Failed to reserve WAV header bytes");
    return false;
  }

  gRecordingStartMs = millis();
  gDataBytesWritten = 0;
  gRecording = true;
  digitalWrite(LED_PIN, HIGH);
  logCode("R104", "Recording started: " + gActiveNoteId);
  return true;
}

bool readAndWriteAudioChunk() {
  if (!gRecording || !gRecordingFile) {
    return false;
  }

  size_t bytesRead = 0;
  esp_err_t err = i2s_read(I2S_NUM_0, gI2sRawBuffer, sizeof(gI2sRawBuffer), &bytesRead, 20 / portTICK_PERIOD_MS);
  if (err != ESP_OK || bytesRead == 0) {
    return false;
  }

  size_t samplesRead = bytesRead / sizeof(int32_t);
  for (size_t i = 0; i < samplesRead; ++i) {
    int32_t sample24 = gI2sRawBuffer[i] >> 8;
    int32_t sample16 = sample24 >> 8;
    if (sample16 > 32767) {
      sample16 = 32767;
    } else if (sample16 < -32768) {
      sample16 = -32768;
    }
    gPcmBuffer[i] = static_cast<int16_t>(sample16);
  }

  size_t pcmBytes = samplesRead * sizeof(int16_t);
  size_t written = gRecordingFile.write(reinterpret_cast<uint8_t *>(gPcmBuffer), pcmBytes);
  if (written != pcmBytes) {
    logCode("R105", "SD write short, stopping recording");
    return false;
  }

  gDataBytesWritten += static_cast<uint32_t>(written);
  return true;
}

bool finalizeRecordingToQueue() {
  if (!gRecordingFile) {
    return false;
  }

  writeWavHeader(gRecordingFile, gDataBytesWritten);
  gRecordingFile.flush();
  gRecordingFile.close();

  String finalPath = wavPathForNote(gActiveNoteId);
  if (SD.exists(finalPath)) {
    SD.remove(finalPath);
  }
  if (!SD.rename(gActiveTmpPath, finalPath)) {
    logCode("R106", "Failed to rename temp WAV into queue");
    return false;
  }

  String sha256Hex;
  if (!computeSha256ForFile(finalPath, sha256Hex)) {
    logCode("R107", "Failed to compute SHA256 for WAV");
    return false;
  }

  NoteMeta meta;
  meta.noteId = gActiveNoteId;
  meta.createdUnixMs = currentUnixMs();
  meta.durationMs = millis() - gRecordingStartMs;
  meta.attempts = 0;
  meta.state = STATE_READY;
  meta.sha256Hex = sha256Hex;
  meta.lastError = "";

  if (!saveMeta(meta)) {
    logCode("R108", "Failed to write meta file");
    return false;
  }

  logCode("R109", "Recording finalized: " + meta.noteId);
  return true;
}

void stopRecording(const String &reason) {
  if (!gRecording) {
    return;
  }

  readAndWriteAudioChunk();
  gRecording = false;
  digitalWrite(LED_PIN, LOW);

  bool finalized = finalizeRecordingToQueue();
  if (!finalized) {
    if (gRecordingFile) {
      gRecordingFile.close();
    }
    SD.remove(gActiveTmpPath);
    logCode("R111", "Recording discarded due to finalize error");
  }

  gActiveNoteId = "";
  gActiveTmpPath = "";
  gDataBytesWritten = 0;
  logCode("R112", "Recording stopped: " + reason);
}

bool parseHttpStatusAndBody(const String &response, int &statusCode, String &bodyOut) {
  int firstLineEnd = response.indexOf("\r\n");
  if (firstLineEnd < 0) {
    return false;
  }

  String statusLine = response.substring(0, firstLineEnd);
  int firstSpace = statusLine.indexOf(' ');
  int secondSpace = statusLine.indexOf(' ', firstSpace + 1);
  if (firstSpace < 0 || secondSpace < 0) {
    return false;
  }

  statusCode = statusLine.substring(firstSpace + 1, secondSpace).toInt();
  int bodyIndex = response.indexOf("\r\n\r\n");
  bodyOut = (bodyIndex >= 0) ? response.substring(bodyIndex + 4) : "";
  return true;
}

bool sendMultipartUpload(const NoteMeta &meta, int &httpStatus, String &responseBody, String &errorText) {
  String wavPath = wavPathForNote(meta.noteId);
  File wav = SD.open(wavPath, FILE_READ);
  if (!wav) {
    errorText = "WAV file missing";
    return false;
  }

  uint32_t fileSize = static_cast<uint32_t>(wav.size());
  String boundary = "----ESP32Boundary" + String(static_cast<uint32_t>(esp_random()), HEX);

  String prefix;
  prefix.reserve(1024);

  auto addTextField = [&](const char *name, const String &value) {
    prefix += "--" + boundary + "\r\n";
    prefix += "Content-Disposition: form-data; name=\"" + String(name) + "\"\r\n\r\n";
    prefix += value + "\r\n";
  };

  addTextField("device_id", DEVICE_ID);
  addTextField("note_id", meta.noteId);
  addTextField("recorded_at_unix_ms", String(meta.createdUnixMs));
  addTextField("duration_ms", String(meta.durationMs));
  addTextField("sample_rate_hz", String(SAMPLE_RATE_HZ));
  addTextField("sha256_hex", meta.sha256Hex);

  prefix += "--" + boundary + "\r\n";
  prefix += "Content-Disposition: form-data; name=\"audio\"; filename=\"" + meta.noteId + ".wav\"\r\n";
  prefix += "Content-Type: audio/wav\r\n\r\n";

  String suffix = "\r\n--" + boundary + "--\r\n";

  uint32_t contentLength = prefix.length() + fileSize + suffix.length();

  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  Client *client = nullptr;

  if (BACKEND_USE_TLS) {
    secureClient.setInsecure();
    client = &secureClient;
  } else {
    client = &plainClient;
  }

  if (!client->connect(BACKEND_HOST, BACKEND_PORT)) {
    errorText = "Failed to connect to backend";
    wav.close();
    return false;
  }

  client->print(String("POST ") + BACKEND_PATH + " HTTP/1.1\r\n");
  client->print(String("Host: ") + BACKEND_HOST + ":" + BACKEND_PORT + "\r\n");
  client->print(String("Authorization: Bearer ") + DEVICE_TOKEN + "\r\n");
  client->print(String("Content-Type: multipart/form-data; boundary=") + boundary + "\r\n");
  client->print(String("Content-Length: ") + contentLength + "\r\n");
  client->print("Connection: close\r\n\r\n");

  client->print(prefix);

  uint8_t fileBuffer[1024];
  while (wav.available()) {
    size_t n = wav.read(fileBuffer, sizeof(fileBuffer));
    if (n == 0) {
      break;
    }
    size_t sent = client->write(fileBuffer, n);
    if (sent != n) {
      wav.close();
      errorText = "Socket write failed while streaming WAV";
      client->stop();
      return false;
    }
  }

  wav.close();
  client->print(suffix);

  String rawResponse;
  uint32_t waitStart = millis();
  while (client->connected() && (millis() - waitStart) < HTTP_RESPONSE_TIMEOUT_MS) {
    while (client->available()) {
      char c = static_cast<char>(client->read());
      rawResponse += c;
    }
    delay(5);
  }
  client->stop();

  if (!parseHttpStatusAndBody(rawResponse, httpStatus, responseBody)) {
    errorText = "Could not parse backend response";
    return false;
  }

  return true;
}

bool isUploadResponseConfirmed(const NoteMeta &meta, int httpStatus, const String &body) {
  if (httpStatus != 200) {
    return false;
  }
  if (body.indexOf("\"status\":\"processed\"") < 0) {
    return false;
  }
  String noteToken = "\"note_id\":\"" + meta.noteId + "\"";
  if (body.indexOf(noteToken) < 0) {
    return false;
  }
  return true;
}

bool findNextQueuedNote(String &noteIdOut) {
  File dir = SD.open(QUEUE_DIR);
  if (!dir || !dir.isDirectory()) {
    return false;
  }

  bool found = false;
  uint64_t bestCreated = UINT64_MAX;
  String bestId;

  File entry;
  while ((entry = dir.openNextFile())) {
    String name = String(entry.name());
    entry.close();

    if (!name.endsWith(".meta")) {
      continue;
    }

    int slash = name.lastIndexOf('/');
    String fileOnly = slash >= 0 ? name.substring(slash + 1) : name;
    String noteId = fileOnly.substring(0, fileOnly.length() - 5);

    NoteMeta meta;
    if (!loadMeta(noteId, meta)) {
      continue;
    }

    bool pending = (meta.state == STATE_READY || meta.state == STATE_ERROR || meta.state == STATE_UPLOADING);
    if (!pending) {
      continue;
    }

    uint64_t created = meta.createdUnixMs > 0 ? meta.createdUnixMs : UINT64_MAX - 1;
    if (!found || created < bestCreated || (created == bestCreated && noteId < bestId)) {
      found = true;
      bestCreated = created;
      bestId = noteId;
    }
  }

  if (!found) {
    return false;
  }

  noteIdOut = bestId;
  return true;
}

bool uploadQueuedNote(const String &noteId) {
  NoteMeta meta;
  if (!loadMeta(noteId, meta)) {
    logCode("U101", "Meta missing for note: " + noteId);
    return false;
  }

  if (!SD.exists(wavPathForNote(noteId))) {
    logCode("U102", "WAV missing; deleting orphan meta: " + noteId);
    SD.remove(metaPathForNote(noteId));
    return false;
  }

  if (!connectWiFi()) {
    meta.state = STATE_ERROR;
    meta.lastError = "Wi-Fi unavailable";
    meta.attempts += 1;
    saveMeta(meta);
    return false;
  }

  meta.state = STATE_UPLOADING;
  saveMeta(meta);

  int httpStatus = 0;
  String responseBody;
  String uploadError;

  bool sent = sendMultipartUpload(meta, httpStatus, responseBody, uploadError);
  if (!sent) {
    meta.state = STATE_ERROR;
    meta.lastError = uploadError;
    meta.attempts += 1;
    saveMeta(meta);
    logCode("U103", "Upload failed for " + noteId + ": " + uploadError);
    return false;
  }

  if (!isUploadResponseConfirmed(meta, httpStatus, responseBody)) {
    meta.state = STATE_ERROR;
    meta.lastError = "Backend rejected note or returned non-processed status";
    meta.attempts += 1;
    saveMeta(meta);
    logCode("U104", "Upload response not confirmed for " + noteId + ", status=" + String(httpStatus));
    return false;
  }

  meta.state = STATE_DONE;
  saveMeta(meta);

  if (!deleteNoteFiles(noteId)) {
    logCode("U105", "Processed note uploaded, but failed to delete local files: " + noteId);
    return false;
  }

  logCode("U106", "Uploaded and deleted local files for: " + noteId);
  return true;
}

void processQueueUntilBlocked() {
  if (!gSdReady || gRecording) {
    return;
  }

  while (true) {
    String nextNoteId;
    if (!findNextQueuedNote(nextNoteId)) {
      return;
    }

    bool success = uploadQueuedNote(nextNoteId);
    if (!success) {
      return;
    }

    delay(50);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  randomSeed(esp_random());

  if (!SD.begin(SD_CS_PIN)) {
    gSdReady = false;
    logCode("S100", "SD.begin failed");
  } else {
    gSdReady = true;
    if (ensureQueueDir()) {
      cleanupStaleFiles();
    }
  }

  if (!initI2S()) {
    logCode("I100", "I2S init failed");
  }

  processQueueUntilBlocked();
}

void loop() {
  if (readButtonPressedEdge()) {
    if (!gRecording) {
      startRecording();
    } else {
      stopRecording("button_stop");
      processQueueUntilBlocked();
    }
  }

  if (gRecording) {
    bool chunkOk = readAndWriteAudioChunk();
    if (!chunkOk) {
      stopRecording("capture_error");
      processQueueUntilBlocked();
    }

    if ((millis() - gRecordingStartMs) >= MAX_RECORDING_MS) {
      stopRecording("max_duration");
      processQueueUntilBlocked();
    }
  } else {
    if ((millis() - gLastQueueRetryMs) >= QUEUE_RETRY_INTERVAL_MS) {
      gLastQueueRetryMs = millis();
      processQueueUntilBlocked();
    }
  }

  delay(2);
}
