package com.example.youtubedictation

import android.content.Context
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.example.youtubedictation.theme.YouTubeDictationTheme

class MainActivity : ComponentActivity() {

    private var embeddedServer: EmbeddedServer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Start embedded server
        startEmbeddedServer()

        enableEdgeToEdge()
        setContent {
            YouTubeDictationTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AppScreen(
                        onApiKeyChanged = { apiKey ->
                            embeddedServer?.geminiApiKey = apiKey
                        }
                    )
                }
            }
        }
    }

    private fun startEmbeddedServer() {
        try {
            embeddedServer = EmbeddedServer(this, 8080).apply {
                // Load saved API key
                val prefs = getSharedPreferences("app_prefs", Context.MODE_PRIVATE)
                geminiApiKey = prefs.getString("gemini_api_key", "") ?: ""
                start()
            }
            Log.i("MainActivity", "Embedded server started on port 8080")
        } catch (e: Exception) {
            Log.e("MainActivity", "Failed to start embedded server", e)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        embeddedServer?.stop()
        Log.i("MainActivity", "Embedded server stopped")
    }
}

class BackgroundWebView(context: Context) : WebView(context) {
    override fun onWindowVisibilityChanged(visibility: Int) {
        // Force report VISIBLE to prevent WebView from pausing media/timers in background
        super.onWindowVisibilityChanged(View.VISIBLE)
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        // Force report VISIBLE to prevent internal pauses
        super.onVisibilityChanged(changedView, View.VISIBLE)
    }
}

@Composable
fun AppScreen(onApiKeyChanged: (String) -> Unit = {}) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val sharedPrefs = remember { context.getSharedPreferences("app_prefs", Context.MODE_PRIVATE) }

    var apiKey by remember {
        mutableStateOf(sharedPrefs.getString("gemini_api_key", "") ?: "")
    }

    // Do not show API key dialog automatically since the app can run fully offline/locally now
    var showApiKeyDialog by remember { mutableStateOf(false) }
    var showSettingsDialog by remember { mutableStateOf(false) }
    var webViewInstance by remember { mutableStateOf<WebView?>(null) }
    var hasError by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(true) }

    val serverUrl = "http://localhost:8080"

    Scaffold { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            if (hasError) {
                ConnectionErrorScreen(
                    currentUrl = serverUrl,
                    onRetry = {
                        hasError = false
                        isLoading = true
                        webViewInstance?.loadUrl(serverUrl)
                    },
                    onOpenSettings = { showSettingsDialog = true }
                )
            } else {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        BackgroundWebView(ctx).apply {
                            layoutParams = ViewGroup.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )

                            // Configure WebView settings
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            @Suppress("DEPRECATION")
                            settings.databaseEnabled = true
                            settings.loadWithOverviewMode = true
                            settings.useWideViewPort = true
                            settings.userAgentString = "${settings.userAgentString} YTDictationAndroid"
                            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

                            webViewClient = object : WebViewClient() {
                                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                                    super.onPageStarted(view, url, favicon)
                                    isLoading = true
                                    // Inject visibility overrides as early as possible
                                    view?.evaluateJavascript(
                                        "Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; } }); " +
                                        "Object.defineProperty(document, 'hidden', { get: function() { return false; } }); " +
                                        "document.dispatchEvent(new Event('visibilitychange'));",
                                        null
                                    )
                                }

                                override fun onPageFinished(view: WebView?, url: String?) {
                                    super.onPageFinished(view, url)
                                    isLoading = false
                                    // Reinject visibility overrides on page finish to ensure background playback works
                                    view?.evaluateJavascript(
                                        "Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; } }); " +
                                        "Object.defineProperty(document, 'hidden', { get: function() { return false; } }); " +
                                        "document.dispatchEvent(new Event('visibilitychange'));",
                                        null
                                    )
                                }

                                override fun onReceivedError(
                                    view: WebView?,
                                    request: WebResourceRequest?,
                                    error: WebResourceError?
                                ) {
                                    if (request?.isForMainFrame == true) {
                                        hasError = true
                                        isLoading = false
                                    }
                                }
                            }

                            webViewInstance = this
                            loadUrl(serverUrl)
                        }
                    }
                )
            }

            if (isLoading && !hasError) {
                LinearProgressIndicator(
                    modifier = Modifier
                        .fillMaxWidth()
                        .align(Alignment.TopCenter),
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
    }

    // API Key Dialog (shown on first launch or when explicitly opened)
    if (showApiKeyDialog) {
        var tempKey by remember { mutableStateOf(apiKey) }
        AlertDialog(
            onDismissRequest = {
                // Only allow dismiss if key is already set
                if (apiKey.isNotBlank()) {
                    showApiKeyDialog = false
                }
            },
            title = { Text(text = "Cấu hình Gemini API Key", fontWeight = FontWeight.Bold) },
            text = {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Nhập Gemini API Key của bạn để kích hoạt tính năng AI phân đoạn phụ đề và đánh giá bài nghe. Bạn có thể lấy API Key miễn phí tại aistudio.google.com.",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(bottom = 12.dp)
                    )
                    OutlinedTextField(
                        value = tempKey,
                        onValueChange = { tempKey = it },
                        label = { Text("Gemini API Key") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        apiKey = tempKey.trim()
                        sharedPrefs.edit().putString("gemini_api_key", apiKey).apply()
                        onApiKeyChanged(apiKey)
                        showApiKeyDialog = false
                    }
                ) {
                    Text("Lưu")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showApiKeyDialog = false
                    }
                ) {
                    Text(if (apiKey.isBlank()) "Bỏ qua" else "Hủy")
                }
            }
        )
    }

    // General Settings Dialog
    if (showSettingsDialog) {
        var tempKey by remember { mutableStateOf(apiKey) }
        AlertDialog(
            onDismissRequest = { showSettingsDialog = false },
            title = { Text(text = "Cài đặt", fontWeight = FontWeight.Bold) },
            text = {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Gemini API Key",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(bottom = 4.dp)
                    )
                    OutlinedTextField(
                        value = tempKey,
                        onValueChange = { tempKey = it },
                        label = { Text("API Key") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "App đang chạy server nội bộ tại localhost:8080. Frontend và API xử lý hoàn toàn trên thiết bị.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        apiKey = tempKey.trim()
                        sharedPrefs.edit().putString("gemini_api_key", apiKey).apply()
                        onApiKeyChanged(apiKey)
                        showSettingsDialog = false
                    }
                ) {
                    Text("Lưu")
                }
            },
            dismissButton = {
                TextButton(onClick = { showSettingsDialog = false }) {
                    Text("Hủy")
                }
            }
        )
    }
}

@Composable
fun HeaderBar(
    onRefresh: () -> Unit,
    onOpenSettings: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        tonalElevation = 4.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "YT Dictation",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                fontWeight = FontWeight.Bold
            )
            Row {
                IconButton(onClick = onRefresh, modifier = Modifier.size(36.dp)) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Làm mới",
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(20.dp)
                    )
                }
                IconButton(onClick = onOpenSettings, modifier = Modifier.size(36.dp)) {
                    Icon(
                        imageVector = Icons.Default.Settings,
                        contentDescription = "Cài đặt",
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun ConnectionErrorScreen(
    currentUrl: String,
    onRetry: () -> Unit,
    onOpenSettings: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = Icons.Default.Warning,
            contentDescription = "Cảnh báo lỗi kết nối",
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(64.dp)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Không thể tải giao diện",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Server nội bộ có thể chưa sẵn sàng. Vui lòng thử lại.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp)
        )
        Spacer(modifier = Modifier.height(24.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            OutlinedButton(onClick = onOpenSettings) {
                Text("Cài đặt")
            }
            Button(onClick = onRetry) {
                Text("Thử lại")
            }
        }
    }
}
