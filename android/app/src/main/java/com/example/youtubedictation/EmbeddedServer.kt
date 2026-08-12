package com.example.youtubedictation

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import fi.iki.elonen.NanoHTTPD
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.InputStream
import java.util.concurrent.TimeUnit

/**
 * Embedded HTTP server that serves the React frontend from assets
 * and handles API endpoints (transcript, evaluate, vocabulary) on-device.
 */
class EmbeddedServer(
    private val context: Context,
    port: Int = 8080
) : NanoHTTPD(port) {

    companion object {
        private const val TAG = "EmbeddedServer"
        private const val GEMINI_MODEL = "gemini-2.0-flash"
    }

    private val gson = Gson()
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    var geminiApiKey: String = ""

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri ?: "/"
        val method = session.method

        return try {
            when {
                // API endpoints
                uri == "/api/health" && method == Method.GET -> handleHealth()
                uri == "/api/transcript" && method == Method.POST -> handleTranscript(session)
                uri == "/api/evaluate" && method == Method.POST -> handleEvaluate(session)
                uri == "/api/vocabulary/lookup-ai" && method == Method.POST -> handleVocabularyLookup(session)
                uri == "/api/vocabulary/add-appwrite" && method == Method.POST -> handleAddAppwrite(session)
                // Serve static assets
                else -> serveStaticFile(uri)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error serving $uri", e)
            jsonResponse(Response.Status.INTERNAL_ERROR, mapOf("error" to (e.message ?: "Internal server error")))
        }
    }

    // ==================== Static File Serving ====================

    private fun serveStaticFile(uri: String): Response {
        val assetPath = if (uri == "/" || uri.isEmpty()) {
            "www/index.html"
        } else {
            "www${uri}"
        }

        return try {
            val inputStream: InputStream = context.assets.open(assetPath)
            val mimeType = getMimeType(assetPath)
            newChunkedResponse(Response.Status.OK, mimeType, inputStream)
        } catch (e: Exception) {
            // For SPA routing, serve index.html for non-asset routes
            try {
                val inputStream: InputStream = context.assets.open("www/index.html")
                newChunkedResponse(Response.Status.OK, "text/html", inputStream)
            } catch (e2: Exception) {
                newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_HTML, "Not Found")
            }
        }
    }

    private fun getMimeType(path: String): String {
        return when {
            path.endsWith(".html") -> "text/html"
            path.endsWith(".css") -> "text/css"
            path.endsWith(".js") -> "application/javascript"
            path.endsWith(".json") -> "application/json"
            path.endsWith(".png") -> "image/png"
            path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
            path.endsWith(".gif") -> "image/gif"
            path.endsWith(".svg") -> "image/svg+xml"
            path.endsWith(".ico") -> "image/x-icon"
            path.endsWith(".woff") -> "font/woff"
            path.endsWith(".woff2") -> "font/woff2"
            path.endsWith(".ttf") -> "font/ttf"
            else -> "application/octet-stream"
        }
    }

    // ==================== API Handlers ====================

    private fun handleHealth(): Response {
        return jsonResponse(Response.Status.OK, mapOf(
            "status" to "ok",
            "geminiConfigured" to geminiApiKey.isNotBlank()
        ))
    }

    private fun handleTranscript(session: IHTTPSession): Response {
        val body = parseRequestBody(session)
        val url = body.get("url")?.asString ?: ""
        val userHtml = body.get("html")?.asString
        val userRawText = body.get("rawText")?.asString

        if (url.isBlank()) {
            return jsonResponse(Response.Status.BAD_REQUEST, mapOf("error" to "Vui lòng cung cấp URL video YouTube"))
        }

        val videoId = extractVideoId(url) ?: if (url.trim().length == 11) url.trim() else null
        if (videoId == null) {
            return jsonResponse(Response.Status.BAD_REQUEST, mapOf("error" to "URL YouTube không hợp lệ"))
        }

        // Fetch video metadata via oEmbed
        var videoTitle = "Video YouTube"
        var authorName = "Kênh YouTube"
        var thumbnailUrl = "https://img.youtube.com/vi/$videoId/hqdefault.jpg"

        try {
            val oembedUrl = "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=$videoId&format=json"
            val request = Request.Builder().url(oembedUrl).build()
            val response = httpClient.newCall(request).execute()
            if (response.isSuccessful) {
                val metadata = JsonParser.parseString(response.body?.string() ?: "{}").asJsonObject
                videoTitle = metadata.get("title")?.asString ?: videoTitle
                authorName = metadata.get("author_name")?.asString ?: authorName
                thumbnailUrl = metadata.get("thumbnail_url")?.asString ?: thumbnailUrl
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to fetch oEmbed metadata", e)
        }

        // A. Handle user-provided raw text
        if (!userRawText.isNullOrBlank()) {
            return handleRawTextTranscript(userRawText, videoId, videoTitle, authorName, thumbnailUrl)
        }

        // B. Handle watch page retrieval (Fetch or parse user-provided HTML)
        var captionTracks: JsonArray? = null
        var watchSuccess = false
        var selectedLanguage = "en"

        if (!userHtml.isNullOrBlank()) {
            Log.i(TAG, "Using user-provided YouTube watch page HTML...")
            captionTracks = extractCaptionTracks(userHtml)
            if (captionTracks != null && captionTracks.size() > 0) {
                watchSuccess = true
            } else {
                return jsonResponse(Response.Status.BAD_REQUEST, mapOf(
                    "error" to "Không thể tìm thấy thông tin phụ đề trong đoạn mã nguồn HTML bạn đã dán. Hãy đảm bảo bạn đã mở đúng trang xem video chính thức trên YouTube, nhấn Ctrl+U và sao chép toàn bộ mã nguồn."
                ))
            }
        } else {
            try {
                val watchUrl = "https://www.youtube.com/watch?v=$videoId"
                val request = Request.Builder()
                    .url(watchUrl)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36")
                    .header("Accept-Language", "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7")
                    .build()
                val response = httpClient.newCall(request).execute()

                if (response.isSuccessful) {
                    val html = response.body?.string() ?: ""
                    captionTracks = extractCaptionTracks(html)
                    if (captionTracks != null && captionTracks.size() > 0) {
                        watchSuccess = true
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to fetch/parse watch page", e)
            }
        }

        if (watchSuccess && captionTracks != null && captionTracks.size() > 0) {
            // Select language: vi first, then en, then first available
            var selectedTrack: JsonObject? = null
            for (i in 0 until captionTracks.size()) {
                val track = captionTracks.get(i).asJsonObject
                if (track.get("languageCode")?.asString == "vi") {
                    selectedTrack = track
                    break
                }
            }
            if (selectedTrack == null) {
                for (i in 0 until captionTracks.size()) {
                    val track = captionTracks.get(i).asJsonObject
                    if (track.get("languageCode")?.asString == "en") {
                        selectedTrack = track
                        break
                    }
                }
            }
            if (selectedTrack == null) {
                selectedTrack = captionTracks.get(0).asJsonObject
            }

            selectedLanguage = selectedTrack?.get("languageCode")?.asString ?: "en"
            val transcriptUrl = selectedTrack?.get("baseUrl")?.asString

            if (transcriptUrl != null) {
                try {
                    val transcriptReq = Request.Builder().url(transcriptUrl).build()
                    val transcriptRes = httpClient.newCall(transcriptReq).execute()

                    if (transcriptRes.isSuccessful) {
                        val transcriptXml = transcriptRes.body?.string() ?: ""
                        val rawSegments = parseXmlTranscript(transcriptXml)

                        if (rawSegments.isNotEmpty()) {
                            val merged = mergeRawSegmentsLocally(rawSegments)
                            val finalSentences = merged.mapIndexed { idx, s ->
                                mapOf(
                                    "id" to idx + 1,
                                    "sentence" to s["sentence"]!!,
                                    "start" to s["start"]!!,
                                    "end" to s["end"]!!
                                )
                            }

                            return jsonResponse(Response.Status.OK, mapOf(
                                "videoId" to videoId,
                                "title" to videoTitle,
                                "author" to authorName,
                                "thumbnailUrl" to thumbnailUrl,
                                "language" to selectedLanguage,
                                "sentences" to finalSentences,
                                "geminiEnhanced" to false,
                                "isRestored" to false
                            ))
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to retrieve or parse raw subtitles", e)
                }
            }
        }

        return jsonResponse(Response.Status.NOT_FOUND, mapOf(
            "error" to "Không thể lấy phụ đề tự động từ YouTube. Vui lòng sử dụng tính năng dán văn bản phụ đề thủ công."
        ))
    }

    private fun handleRawTextTranscript(
        rawText: String, videoId: String, videoTitle: String, authorName: String, thumbnailUrl: String
    ): Response {
        val lines = rawText.lines()
        val localSentences = mutableListOf<Map<String, Any>>()
        var currentTime = 0.0
        var idCounter = 1
        var pendingStart: Double? = null

        val timestampRangeRegex = Regex("^\\s*[\\(\\[]?(\\d+:\\d+(?:[.,]\\d+)?(?::\\d+(?:[.,]\\d+)?)?)\\s*(?:-|-->|\\to)\\s*(\\d+:\\d+(?:[.,]\\d+)?(?::\\d+(?:[.,]\\d+)?)?)[\\)\\]]?:?\\s*(.*)$", RegexOption.IGNORE_CASE)
        val singleTimestampRegex = Regex("^\\s*[\\(\\[]?(\\d+:\\d+(?:[.,]\\d+)?(?::\\d+(?:[.,]\\d+)?)?)[\\)\\]]?\\s*$")

        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.isEmpty()) continue

            if (Regex("^\\d+$").matches(trimmed) && trimmed.length < 5) {
                continue
            }

            val singleMatch = singleTimestampRegex.find(trimmed)
            if (singleMatch != null) {
                pendingStart = parseTimestampToSeconds(singleMatch.groupValues[1])
                continue
            }

            val rangeMatch = timestampRangeRegex.find(trimmed)
            if (rangeMatch != null) {
                val startSec = parseTimestampToSeconds(rangeMatch.groupValues[1])
                val endSec = parseTimestampToSeconds(rangeMatch.groupValues[2])
                val rawContent = rangeMatch.groupValues[3].trim()

                var sentenceText = rawContent
                var vietnameseText = ""

                if (rawContent.contains("|")) {
                    val parts = rawContent.split("|")
                    sentenceText = parts[0].trim()
                    vietnameseText = parts.subList(1, parts.size).joinToString("|").replace(Regex("^Dịch:\\s*", RegexOption.IGNORE_CASE), "").trim()
                } else if (Regex("\\(Dịch:\\s*", RegexOption.IGNORE_CASE).containsMatchIn(rawContent)) {
                    val vMatch = Regex("^(.*?)\\s*\\(Dịch:\\s*(.*?)\\)$", RegexOption.IGNORE_CASE).find(rawContent)
                    if (vMatch != null) {
                        sentenceText = vMatch.groupValues[1].trim()
                        vietnameseText = vMatch.groupValues[2].trim()
                    }
                }

                if (sentenceText.isNotEmpty()) {
                    val item = mutableMapOf<String, Any>(
                        "id" to idCounter++,
                        "sentence" to sentenceText,
                        "start" to String.format(java.util.Locale.US, "%.2f", startSec).toDouble(),
                        "end" to String.format(java.util.Locale.US, "%.2f", endSec).toDouble()
                    )
                    if (vietnameseText.isNotEmpty()) {
                        item["vietnamese"] = vietnameseText
                    }
                    localSentences.add(item)
                    currentTime = endSec
                    pendingStart = null
                }
                continue
            }

            var sentenceText = trimmed
            var vietnameseText = ""

            if (trimmed.contains("|")) {
                val parts = trimmed.split("|")
                sentenceText = parts[0].trim()
                vietnameseText = parts.subList(1, parts.size).joinToString("|").replace(Regex("^Dịch:\\s*", RegexOption.IGNORE_CASE), "").trim()
            } else if (Regex("\\(Dịch:\\s*", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) {
                val vMatch = Regex("^(.*?)\\s*\\(Dịch:\\s*(.*?)\\)$", RegexOption.IGNORE_CASE).find(trimmed)
                if (vMatch != null) {
                    sentenceText = vMatch.groupValues[1].trim()
                    vietnameseText = vMatch.groupValues[2].trim()
                }
            }

            if (sentenceText.isNotEmpty()) {
                val wordCount = sentenceText.split(Regex("\\s+")).filter { it.isNotEmpty() }.size
                val estimatedDuration = maxOf(3, minOf(8, Math.round(wordCount * 0.4).toInt()))
                val startSec = pendingStart ?: currentTime
                val endSec = startSec + estimatedDuration

                val item = mutableMapOf<String, Any>(
                    "id" to idCounter++,
                    "sentence" to sentenceText,
                    "start" to String.format(java.util.Locale.US, "%.2f", startSec).toDouble(),
                    "end" to String.format(java.util.Locale.US, "%.2f", endSec).toDouble()
                )
                if (vietnameseText.isNotEmpty()) {
                    item["vietnamese"] = vietnameseText
                }
                localSentences.add(item)
                currentTime = endSec
                pendingStart = null
            }
        }

        if (localSentences.isNotEmpty()) {
            return jsonResponse(Response.Status.OK, mapOf(
                "videoId" to videoId,
                "title" to videoTitle,
                "author" to authorName,
                "thumbnailUrl" to thumbnailUrl,
                "language" to "en",
                "sentences" to localSentences,
                "geminiEnhanced" to false,
                "isRestored" to false,
                "isManualText" to true
            ))
        }

        return jsonResponse(Response.Status.INTERNAL_ERROR, mapOf(
            "error" to "Không thể xử lý phụ đề dạng văn bản."
        ))
    }

    private fun handleEvaluate(session: IHTTPSession): Response {
        val body = parseRequestBody(session)
        val original = body.get("original")?.asString ?: ""
        val input = body.get("input")?.asString ?: ""
        val vietnameseTranslation = body.get("vietnamese")?.asString

        if (original.isBlank()) {
            return jsonResponse(Response.Status.BAD_REQUEST, mapOf("error" to "Thiếu câu gốc"))
        }

        val cleanWord = { w: String ->
            w.lowercase()
                .replace(Regex("[’‘`´]"), "'")
                .replace(Regex("[“”]"), "\"")
                .replace(Regex("[.,/#!\\$%^&*;:{}=\\-_`~()?\"'–—]"), "")
                .trim()
        }

        val normOriginal = original.replace(Regex("\\s+"), " ").trim()
        val normInput = input.replace(Regex("\\s+"), " ").trim()

        if (normInput.isBlank()) {
            val rawOWords = normOriginal.split(Regex("\\s+")).filter { it.isNotEmpty() }
            val corrections = rawOWords.mapIndexed { idx, w ->
                mapOf(
                    "type" to "missing",
                    "expected" to w,
                    "position" to idx + 1,
                    "reason" to "Thiếu từ \"$w\" (chưa nhập nội dung)"
                )
            }
            return jsonResponse(Response.Status.OK, mapOf(
                "accuracy" to 0,
                "feedback" to "Bạn chưa nhập nội dung trả lời.",
                "vietnameseTranslation" to vietnameseTranslation,
                "corrections" to corrections
            ))
        }

        val rawOWords = normOriginal.split(Regex("\\s+")).filter { it.isNotEmpty() }
        val rawIWords = normInput.split(Regex("\\s+")).filter { it.isNotEmpty() }

        val oWords = rawOWords.map(cleanWord)
        val iWords = rawIWords.map(cleanWord)

        val m = oWords.size
        val n = iWords.size

        val dp = Array(m + 1) { IntArray(n + 1) { 0 } }
        for (i in 1..m) {
            for (j in 1..n) {
                if (oWords[i - 1] == iWords[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1
                } else {
                    dp[i][j] = maxOf(dp[i - 1][j], dp[i][j - 1])
                }
            }
        }

        var i = m
        var j = n
        data class Op(val op: String, val oIdx: Int? = null, val iIdx: Int? = null)
        val ops = mutableListOf<Op>()

        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oWords[i - 1] == iWords[j - 1]) {
                ops.add(0, Op("match", i - 1, j - 1))
                i--
                j--
            } else if (i > 0 && j > 0 && dp[i - 1][j - 1] >= dp[i - 1][j] && dp[i - 1][j - 1] >= dp[i][j - 1]) {
                ops.add(0, Op("different", i - 1, j - 1))
                i--
                j--
            } else if (j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                ops.add(0, Op("extra", null, j - 1))
                j--
            } else {
                ops.add(0, Op("missing", i - 1, null))
                i--
            }
        }

        val corrections = mutableListOf<Map<String, Any>>()
        var correctCount = 0

        for (op in ops) {
            when (op.op) {
                "match" -> correctCount++
                "missing" -> {
                    val oIdx = op.oIdx!!
                    corrections.add(mapOf(
                        "type" to "missing",
                        "expected" to rawOWords[oIdx],
                        "position" to oIdx + 1,
                        "reason" to "Bị thiếu từ \"${rawOWords[oIdx]}\" tại vị trí thứ ${oIdx + 1}"
                    ))
                }
                "extra" -> {
                    val iIdx = op.iIdx!!
                    corrections.add(mapOf(
                        "type" to "extra",
                        "word" to rawIWords[iIdx],
                        "position" to iIdx + 1,
                        "reason" to "Thừa từ \"${rawIWords[iIdx]}\" (không có trong câu gốc)"
                    ))
                }
                "different" -> {
                    val oIdx = op.oIdx!!
                    val iIdx = op.iIdx!!
                    corrections.add(mapOf(
                        "type" to "different",
                        "word" to rawIWords[iIdx],
                        "expected" to rawOWords[oIdx],
                        "position" to oIdx + 1,
                        "reason" to "Khác từ tại vị trí thứ ${oIdx + 1}: Bạn gõ \"${rawIWords[iIdx]}\", từ đúng là \"${rawOWords[oIdx]}\""
                    ))
                }
            }
        }

        val accuracy = if (m > 0) maxOf(0, minOf(100, Math.round((correctCount.toDouble() / m) * 100).toInt())) else 0

        val feedback = when {
            accuracy >= 100 -> "Xuất sắc! Bạn chép hoàn toàn chính xác."
            accuracy >= 80 -> "Rất tốt! Chỉ sai một vài lỗi nhỏ."
            accuracy >= 50 -> "Tốt! Cần chú ý kỹ hơn các từ khó."
            else -> "Cố gắng lên nhé!"
        }

        val responseData = mutableMapOf<String, Any?>(
            "accuracy" to accuracy,
            "feedback" to feedback,
            "corrections" to corrections
        )
        if (vietnameseTranslation != null) {
            responseData["vietnameseTranslation"] = vietnameseTranslation
        }

        return jsonResponse(Response.Status.OK, responseData)
    }

    private fun handleVocabularyLookup(session: IHTTPSession): Response {
        val body = parseRequestBody(session)
        val word = body.get("word")?.asString?.trim() ?: ""
        val contextSentence = body.get("contextSentence")?.asString?.trim() ?: ""

        if (word.isBlank()) {
            return jsonResponse(Response.Status.BAD_REQUEST, mapOf("error" to "Vui lòng nhập từ vựng cần tra cứu."))
        }

        if (geminiApiKey.isBlank()) {
            return jsonResponse(Response.Status.BAD_REQUEST, mapOf("error" to "Thiếu cấu hình Gemini API Key."))
        }

        val prompt = """Bạn là một từ điển Anh - Việt chuyên nghiệp. Hãy phân tích từ vựng tiếng Anh sau và trả về thông tin chi tiết bằng tiếng Việt:
Từ vựng: "$word"
${if (contextSentence.isNotBlank()) "Câu ngữ cảnh: \"$contextSentence\"" else ""}

Nhiệm vụ:
1. "vietnamese": Nghĩa tiếng Việt chính xác, phổ biến và ngắn gọn.
2. "grammar": Từ loại chính (ví dụ: "noun", "verb", "adjective").
3. "englishSentence": Câu ví dụ minh họa bằng tiếng Anh.
4. "vietnameseSentence": Dịch nghĩa câu ví dụ sang tiếng Việt.

Trả về JSON."""

        val result = callGeminiApi(prompt)
        if (result != null) {
            return newFixedLengthResponse(Response.Status.OK, "application/json", result)
        }

        return jsonResponse(Response.Status.INTERNAL_ERROR, mapOf("error" to "Không thể tra cứu từ vựng bằng AI."))
    }

    private fun handleAddAppwrite(session: IHTTPSession): Response {
        val body = parseRequestBody(session)
        val word = body.get("word")?.asString?.trim() ?: ""

        if (word.isBlank()) {
            return jsonResponse(Response.Status.BAD_REQUEST, mapOf("error" to "Vui lòng cung cấp từ vựng."))
        }

        val appwriteEndpoint = "https://fra.cloud.appwrite.io/v1"
        val appwriteProjectId = "68cf65390012ceaa2085"
        val appwriteDatabaseId = "68cfb8c900053dca6f90"
        val appwriteCollectionId = "vocabularies"

        val sentencesArr = JsonArray().apply {
            add(JsonObject().apply {
                addProperty("sentences", body.get("englishSentence")?.asString ?: "")
                addProperty("vietnamese", body.get("vietnameseSentence")?.asString ?: "")
                addProperty("grammar", body.get("grammar")?.asString ?: "")
            })
        }

        val category = body.get("category")?.asString
        val documentData = JsonObject().apply {
            addProperty("word", word)
            addProperty("sentences", gson.toJson(sentencesArr))
            addProperty("vietnamese", (body.get("vietnamese")?.asString ?: "").trim())
            addProperty("grammar", (body.get("grammar")?.asString ?: "").trim())
            addProperty("createdAt", System.currentTimeMillis().toString())
            addProperty("lastStudiedAt", System.currentTimeMillis().toString())
            addProperty("priorityScore", "0")
            addProperty("category", if (category == "TOEIC") "TOEIC" else "GENERAL")
            addProperty("totalAttempts", "0")
            addProperty("correctAttempts", "0")
            addProperty("memoryScore", "0")
            addProperty("last10Attempts", "[]")
        }

        val documentId = generateUniqueId()
        val appwriteUrl = "$appwriteEndpoint/databases/$appwriteDatabaseId/collections/$appwriteCollectionId/documents"

        val requestBody = JsonObject().apply {
            addProperty("documentId", documentId)
            add("data", documentData)
        }

        try {
            val request = Request.Builder()
                .url(appwriteUrl)
                .header("Content-Type", "application/json")
                .header("X-Appwrite-Project", appwriteProjectId)
                .post(gson.toJson(requestBody).toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            val responseData = JsonParser.parseString(response.body?.string() ?: "{}").asJsonObject

            if (!response.isSuccessful) {
                throw Exception(responseData.get("message")?.asString ?: "Lỗi lưu từ vựng lên Appwrite Database.")
            }

            return jsonResponse(Response.Status.OK, mapOf(
                "success" to true,
                "message" to "Đã đồng bộ từ \"$word\" lên Appwrite Cloud thành công!",
                "documentId" to (responseData.get("\$id")?.asString ?: documentId),
                "data" to responseData
            ))
        } catch (e: Exception) {
            Log.e(TAG, "Error adding vocabulary to Appwrite", e)
            return jsonResponse(Response.Status.INTERNAL_ERROR, mapOf(
                "error" to (e.message ?: "Không thể kết nối đến Appwrite Server.")
            ))
        }
    }

    // ==================== Utility Functions ====================

    private fun endsWithIncompleteWord(text: String): Boolean {
        val clean = text.trim().lowercase()
            .replace(Regex("[.,/#!\\$%^&*;:{}=\\-_`~()?\"'–—]"), "")
        val words = clean.split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return false
        val lastWord = words.last()
        val danglingWords = setOf(
            "in", "at", "on", "to", "for", "with", "of", "from", "by", "into", "about",
            "through", "under", "over", "between", "behind", "after", "before",
            "a", "an", "the",
            "my", "your", "his", "her", "our", "their", "its", "this", "that", "these", "those",
            "and", "but", "or", "so", "because", "when", "where", "which", "if", "than", "as"
        )
        return danglingWords.contains(lastWord)
    }

    private fun mergeRawSegmentsLocally(rawSegments: List<Map<String, Any>>): List<Map<String, Any>> {
        val result = mutableListOf<Map<String, Any>>()
        if (rawSegments.isEmpty()) return result

        var currentText = ""
        var currentStart = rawSegments[0]["start"] as? Double ?: 0.0
        var currentEnd = currentStart + (rawSegments[0]["duration"] as? Double ?: 2.0)

        for (i in rawSegments.indices) {
            val seg = rawSegments[i]
            val text = (seg["text"] as? String ?: "").trim()
            if (text.isEmpty()) continue

            if (currentText.isEmpty()) {
                currentText = text
                currentStart = seg["start"] as? Double ?: 0.0
                currentEnd = currentStart + (seg["duration"] as? Double ?: 2.0)
            } else {
                currentText += " $text"
                currentEnd = (seg["start"] as? Double ?: 0.0) + (seg["duration"] as? Double ?: 2.0)
            }

            val wordCount = currentText.split(Regex("\\s+")).filter { it.isNotEmpty() }.size
            val duration = currentEnd - currentStart
            val endsWithPunctuation = Regex("[.!?]$").containsMatchIn(currentText)
            val isDangling = endsWithIncompleteWord(currentText)

            if (endsWithPunctuation || ((duration >= 6.0 || wordCount >= 10) && !isDangling) || i == rawSegments.size - 1) {
                result.add(mapOf(
                    "sentence" to currentText.trim(),
                    "start" to String.format(java.util.Locale.US, "%.2f", currentStart).toDouble(),
                    "end" to String.format(java.util.Locale.US, "%.2f", currentEnd).toDouble()
                ))
                currentText = ""
            }
        }

        if (currentText.trim().isNotEmpty()) {
            result.add(mapOf(
                "sentence" to currentText.trim(),
                "start" to String.format(java.util.Locale.US, "%.2f", currentStart).toDouble(),
                "end" to String.format(java.util.Locale.US, "%.2f", currentEnd).toDouble()
            ))
        }

        return result
    }

    private fun extractVideoId(url: String): String? {
        val regex = Regex("^.*(youtu.be/|v/|u/\\w/|embed/|watch\\?v=|&v=)([^#&?]*).*")
        val match = regex.find(url)
        return if (match != null && match.groupValues[2].length == 11) match.groupValues[2] else null
    }

    private fun cleanXmlText(text: String): String {
        return text
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
            .replace("&#x2F;", "/")
            .replace("&#x60;", "`")
            .replace("&#x3D;", "=")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun parseXmlTranscript(xml: String): List<Map<String, Any>> {
        val result = mutableListOf<Map<String, Any>>()
        val regex = Regex("<text([^>]*)>([\\s\\S]*?)</text>", RegexOption.IGNORE_CASE)
        val startRegex = Regex("start=\"([\\d.]+)\"")
        val durRegex = Regex("dur=\"([\\d.]+)\"")

        for (match in regex.findAll(xml)) {
            val attrs = match.groupValues[1]
            val textContent = match.groupValues[2]

            val start = startRegex.find(attrs)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
            val duration = durRegex.find(attrs)?.groupValues?.get(1)?.toDoubleOrNull() ?: 2.0
            val text = cleanXmlText(textContent)

            if (text.isNotBlank() && text != "[âm nhạc]" && text != "[Music]") {
                result.add(mapOf("text" to text, "start" to start, "duration" to duration))
            }
        }
        return result
    }

    private fun extractCaptionTracks(html: String): JsonArray? {
        val regex = Regex("\"captionTracks\":\\s*(\\[.*?\\])")
        val match = regex.find(html) ?: return null
        return try {
            JsonParser.parseString(match.groupValues[1]).asJsonArray
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse caption tracks", e)
            null
        }
    }

    private fun parseTimestampToSeconds(ts: String): Double {
        val parts = ts.trim().split(":").mapNotNull { it.toDoubleOrNull() }
        return when (parts.size) {
            2 -> parts[0] * 60 + parts[1]
            3 -> parts[0] * 3600 + parts[1] * 60 + parts[2]
            else -> 0.0
        }
    }

    private fun generateUniqueId(): String {
        val chars = "abcdefghijklmnopqrstuvwxyz0123456789"
        return (1..20).map { chars.random() }.joinToString("")
    }

    private fun segmentWithGemini(rawSegments: List<Map<String, Any>>): List<Map<String, Any>>? {
        if (geminiApiKey.isBlank()) return null

        val chunkSize = 50
        val allSentences = mutableListOf<Map<String, Any>>()

        for (chunk in rawSegments.chunked(chunkSize)) {
            val prompt = """Bạn là một chuyên gia ngôn ngữ học và trợ lý nghe chép chính tả xuất sắc. Hãy thực hiện việc phân đoạn câu và sửa lỗi viết hoa, dấu câu cho các phân đoạn phụ đề thô của YouTube dưới đây.

Quy tắc quan trọng:
1. CHIA NHỎ CÂU: Mỗi phân đoạn CHỈ NÊN DÀI TỪ 3 ĐẾN 8 GIÂY (tối đa 6 - 12 từ).
2. KHÔNG DỊCH SANG TIẾNG VIỆT, giữ nguyên tiếng Anh gốc.
3. KHÔNG ĐƯỢC tự ý thêm bớt hay thay đổi từ ngữ nào.
4. MỐC THỜI GIAN CHÍNH XÁC.

Dữ liệu phụ đề thô (dưới dạng JSON):
${gson.toJson(chunk)}

Trả về JSON array với mỗi phần tử có: "sentence" (string), "start" (number), "end" (number)."""

            val result = callGeminiApi(prompt)
            if (result != null) {
                try {
                    val parsed = JsonParser.parseString(result).asJsonArray
                    for (i in 0 until parsed.size()) {
                        val item = parsed.get(i).asJsonObject
                        allSentences.add(mapOf(
                            "sentence" to (item.get("sentence")?.asString?.trim() ?: ""),
                            "start" to (item.get("start")?.asDouble ?: 0.0),
                            "end" to (item.get("end")?.asDouble ?: 0.0)
                        ))
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Error parsing Gemini chunk response", e)
                    // Fallback for this chunk
                    chunk.forEach { seg ->
                        allSentences.add(mapOf(
                            "sentence" to (seg["text"] as String),
                            "start" to (seg["start"] as Double),
                            "end" to (seg["start"] as Double) + (seg["duration"] as Double)
                        ))
                    }
                }
            } else {
                // Fallback for this chunk
                chunk.forEach { seg ->
                    allSentences.add(mapOf(
                        "sentence" to (seg["text"] as String),
                        "start" to (seg["start"] as Double),
                        "end" to (seg["start"] as Double) + (seg["duration"] as Double)
                    ))
                }
            }
        }

        if (allSentences.isEmpty()) return null

        // Sort by start time and assign IDs
        return allSentences
            .sortedBy { it["start"] as Double }
            .mapIndexed { idx, s ->
                mapOf(
                    "id" to (idx + 1),
                    "sentence" to s["sentence"]!!,
                    "start" to String.format("%.2f", s["start"] as Double).toDouble(),
                    "end" to String.format("%.2f", s["end"] as Double).toDouble()
                )
            }
    }

    private fun buildRawTextPrompt(rawText: String): String {
        return """Bạn là một chuyên gia ngôn ngữ học tiếng Anh và trợ lý giảng dạy xuất sắc. Dưới đây là phụ đề thô dạng văn bản được người dùng sao chép thủ công.
Hãy thực hiện việc phân đoạn câu, sửa lỗi viết hoa, dấu câu cho các đoạn phụ đề thô dưới đây.

Quy tắc quan trọng:
1. CHIA NHỎ CÂU: Mỗi phân đoạn CHỈ NÊN DÀI TỪ 3 ĐẾN 8 GIÂY (tối đa 6 - 12 từ).
2. MỐC THỜI GIAN CHÍNH XÁC: Nếu dữ liệu phụ đề thô ĐÃ CÓ SẴN các mốc thời gian, hãy sử dụng chính xác. CHỈ KHI không có mốc thời gian, bạn mới tự ước lượng.
3. KHÔNG DỊCH SANG TIẾNG VIỆT, giữ nguyên tiếng Anh gốc.
4. KHÔNG ĐƯỢC tự ý thêm bớt hay thay đổi từ ngữ nào.

Dữ liệu phụ đề thô:
$rawText

Trả về JSON array với mỗi phần tử có: "sentence" (string), "start" (number), "end" (number)."""
    }

    // ==================== Gemini API ====================

    private fun callGeminiApi(prompt: String): String? {
        if (geminiApiKey.isBlank()) return null

        val url = "https://generativelanguage.googleapis.com/v1beta/models/$GEMINI_MODEL:generateContent?key=$geminiApiKey"

        val requestBody = JsonObject().apply {
            add("contents", JsonArray().apply {
                add(JsonObject().apply {
                    add("parts", JsonArray().apply {
                        add(JsonObject().apply {
                            addProperty("text", prompt)
                        })
                    })
                })
            })
            add("generationConfig", JsonObject().apply {
                addProperty("responseMimeType", "application/json")
            })
        }

        try {
            val request = Request.Builder()
                .url(url)
                .header("Content-Type", "application/json")
                .post(gson.toJson(requestBody).toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            val responseText = response.body?.string() ?: ""

            if (!response.isSuccessful) {
                Log.e(TAG, "Gemini API error: ${response.code} - $responseText")
                return null
            }

            val responseJson = JsonParser.parseString(responseText).asJsonObject
            val candidates = responseJson.getAsJsonArray("candidates")
            if (candidates != null && candidates.size() > 0) {
                val content = candidates.get(0).asJsonObject.getAsJsonObject("content")
                val parts = content?.getAsJsonArray("parts")
                if (parts != null && parts.size() > 0) {
                    return parts.get(0).asJsonObject.get("text")?.asString
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error calling Gemini API", e)
        }
        return null
    }

    // ==================== Request Parsing ====================

    private fun parseRequestBody(session: IHTTPSession): JsonObject {
        val contentLength = session.headers["content-length"]?.toIntOrNull() ?: 0
        if (contentLength <= 0) return JsonObject()

        val buffer = ByteArray(contentLength)
        session.inputStream.read(buffer, 0, contentLength)
        val bodyStr = String(buffer)

        return try {
            JsonParser.parseString(bodyStr).asJsonObject
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse request body: $bodyStr", e)
            JsonObject()
        }
    }

    private fun jsonResponse(status: Response.Status, data: Map<String, Any?>): Response {
        val json = gson.toJson(data)
        return newFixedLengthResponse(status, "application/json", json)
    }
}
