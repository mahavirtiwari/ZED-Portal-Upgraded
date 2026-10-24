package org.qcin.zed.shared

import android.annotation.SuppressLint
import android.app.Activity
import android.app.ActivityManager
import android.app.DatePickerDialog
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.UUID
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * TurboModule "ZedDevice": the Android behaviour of the legacy apps that React Native does not provide one to one.
 * Method contracts are documented in src/native/NativeZedDevice.ts.
 */
class ZedDeviceModule(private val context: ReactApplicationContext) :
    NativeZedDeviceSpec(context), ActivityEventListener {

    private var pendingPromise: Promise? = null
    private var pendingRequest = 0
    private var captureUri: Uri? = null
    private var captureFile: File? = null

    init {
        context.addActivityEventListener(this)
    }

    override fun getName() = NAME

    // ---- Device -------------------------------------------------------------------------------------------

    /** As the GeoStat apps' Utils.getDeviceInfo (DeviceInfo of the legacy request models). */
    @SuppressLint("HardwareIds")
    override fun getDeviceInfo(): WritableMap = Arguments.createMap().apply {
        putString("deviceId", Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "")
        putString("osVersion", System.getProperty("os.version") + " (" + Build.VERSION.INCREMENTAL + ")")
        putInt("apiLevel", Build.VERSION.SDK_INT)
        putString("device", Build.DEVICE ?: "")
        putString("modelProduct", Build.MODEL + " (" + Build.PRODUCT + ")")
        putString("manufacturer", Build.MANUFACTURER ?: "")
    }

    override fun getAppInfo(): WritableMap {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        @Suppress("DEPRECATION")
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode.toDouble() else info.versionCode.toDouble()
        return Arguments.createMap().apply {
            putString("packageName", context.packageName)
            putString("versionName", info.versionName ?: "")
            putDouble("versionCode", code)
            val resId = context.resources.getIdentifier("zed_environment", "string", context.packageName)
            putString("environment", if (resId != 0) context.getString(resId) else "production")
        }
    }

    /** LauncherActivity.checkAvailableRAM / checkAvailableMemory. */
    override fun getMemoryInfo(): WritableMap {
        val mi = ActivityManager.MemoryInfo()
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mi)
        val stat = StatFs(Environment.getDataDirectory().path)
        return Arguments.createMap().apply {
            putDouble("availableRamMb", (mi.availMem / 1048576L).toDouble())
            putDouble("availableStorageMb", (stat.availableBlocksLong * stat.blockSizeLong / (1024L * 1024L)).toDouble())
        }
    }

    override fun isAutoTimeEnabled(): Boolean =
        Settings.Global.getInt(context.contentResolver, Settings.Global.AUTO_TIME, 0) == 1

    override fun isGpsEnabled(): Boolean =
        (context.getSystemService(Context.LOCATION_SERVICE) as LocationManager).isProviderEnabled(LocationManager.GPS_PROVIDER)

    override fun openLocationSettings() {
        val activity = reactApplicationContext.getCurrentActivity()
        val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
        if (activity != null) activity.startActivity(intent)
        else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    override fun getCurrentLocation(timeoutMs: Double, promise: Promise) {
        val activity = reactApplicationContext.getCurrentActivity()
        if (activity == null) {
            promise.reject(LocationFetcher.UNAVAILABLE, "No activity")
            return
        }
        LocationFetcher(activity, timeoutMs.toLong(), promise).start()
    }

    // ---- Camera, gallery, files ---------------------------------------------------------------------------

    /** BaseActivity.prepareCaptureImageIntent with Utils.createImageFile. */
    override fun capturePhoto(promise: Promise) {
        val activity = reactApplicationContext.getCurrentActivity() ?: return promise.reject("NO_ACTIVITY", "No activity")
        if (!beginRequest(promise, REQUEST_CAPTURE)) return
        try {
            val photoFile = PhotoPipeline.createImageFile(context)
            captureFile = photoFile
            captureUri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", photoFile)
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, captureUri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivityForResult(intent, REQUEST_CAPTURE)
        } catch (e: Exception) {
            finishRequest()?.reject("CAPTURE_FAILED", e.message, e)
        }
    }

    override fun pickImage(promise: Promise) {
        val activity = reactApplicationContext.getCurrentActivity() ?: return promise.reject("NO_ACTIVITY", "No activity")
        if (!beginRequest(promise, REQUEST_PICK_IMAGE)) return
        try {
            activity.startActivityForResult(Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI), REQUEST_PICK_IMAGE)
        } catch (e: Exception) {
            finishRequest()?.reject("PICK_FAILED", e.message, e)
        }
    }

    override fun pickPdf(promise: Promise) {
        val activity = reactApplicationContext.getCurrentActivity() ?: return promise.reject("NO_ACTIVITY", "No activity")
        if (!beginRequest(promise, REQUEST_PICK_PDF)) return
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/pdf"
            }
            activity.startActivityForResult(intent, REQUEST_PICK_PDF)
        } catch (e: Exception) {
            finishRequest()?.reject("PICK_FAILED", e.message, e)
        }
    }

    override fun processImage(uri: String, latitude: String?, longitude: String?, promise: Promise) {
        Thread {
            try {
                val result = PhotoPipeline.process(context, Uri.parse(uri), latitude, longitude)
                if (result == null) {
                    promise.reject("PROCESS_FAILED", "Failed to save the captured photo, please try again")
                } else {
                    promise.resolve(Arguments.createMap().apply {
                        putString("photoPath", result.photoPath)
                        putString("base64", result.base64)
                        putString("timeStamp", result.timeStamp)
                        putInt("width", result.width)
                        putInt("height", result.height)
                    })
                }
            } catch (e: Throwable) {
                promise.reject("PROCESS_FAILED", e.message, e)
            }
        }.start()
    }

    /** PhotosHelper.copyPdf. */
    override fun copyPdf(uri: String, promise: Promise) {
        Thread {
            try {
                val input = context.contentResolver.openInputStream(Uri.parse(uri))
                if (input == null) {
                    promise.reject("COPY_FAILED", "Unable to read the file")
                } else {
                    val file = File(context.filesDir, UUID.randomUUID().toString() + ".pdf")
                    file.createNewFile()
                    input.use { writeStreamToFile(it, file) }
                    promise.resolve(file.absolutePath)
                }
            } catch (e: Exception) {
                promise.reject("COPY_FAILED", e.message, e)
            }
        }.start()
    }

    override fun readFileBase64(path: String, promise: Promise) {
        Thread {
            try {
                promise.resolve(android.util.Base64.encodeToString(File(path).readBytes(), android.util.Base64.NO_WRAP))
            } catch (e: Exception) {
                promise.reject("READ_FAILED", e.message, e)
            }
        }.start()
    }

    /** Utils.deletePhoto. */
    override fun deleteFile(path: String): Boolean = try {
        val f = File(path)
        f.exists() && f.delete()
    } catch (e: Exception) {
        false
    }

    override fun fileExists(path: String): Boolean = File(path).exists()

    /** PhotoCaptureHelper.viewImage. */
    override fun openImage(path: String) {
        val target = File(PhotoPipeline.sharedCacheDir(context), "Image.jpg")
        target.createNewFile()
        FileInputStream(File(path)).use { writeStreamToFile(it, target) }
        startViewer(target, "image/*")
    }

    /** PhotosHelper.setPdfViewListener / Utils.openPdf. */
    override fun openPdf(path: String, fileName: String) {
        val target = File(PhotoPipeline.sharedCacheDir(context), fileName)
        target.createNewFile()
        FileInputStream(File(path)).use { writeStreamToFile(it, target) }
        startViewer(target, "application/pdf")
    }

    private fun startViewer(file: File, mime: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file), mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val activity = reactApplicationContext.getCurrentActivity()
            if (activity != null) activity.startActivity(intent)
            else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(context, "No suitable application found to perform this action", Toast.LENGTH_SHORT).show()
        }
    }

    // ---- Misc ----------------------------------------------------------------------------------------------

    override fun pickDate(initial: String?, promise: Promise) {
        val activity = reactApplicationContext.getCurrentActivity() ?: return promise.reject("NO_ACTIVITY", "No activity")
        val c = Calendar.getInstance()
        initial?.let { runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.ENGLISH).parse(it) }.getOrNull() }?.let { c.time = it }
        activity.runOnUiThread {
            var settled = false
            val dialog = DatePickerDialog(activity, { _, y, m, d ->
                settled = true
                promise.resolve(String.format(Locale.ENGLISH, "%04d-%02d-%02d", y, m + 1, d))
            }, c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH))
            dialog.setOnDismissListener { if (!settled) { settled = true; promise.resolve(null) } }
            dialog.show()
        }
    }

    override fun setClipboard(text: String) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("ZED ID", text))
    }

    override fun hashPassword(password: String, saltHex: String, iterations: Double): String {
        val spec = PBEKeySpec(password.toCharArray(), hexToBytes(saltHex), iterations.toInt(), 256)
        val bytes = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        return bytesToHex(bytes)
    }

    override fun randomHex(bytes: Double): String {
        val b = ByteArray(bytes.toInt())
        SecureRandom().nextBytes(b)
        return bytesToHex(b)
    }

    override fun getPreference(file: String, key: String): String? =
        context.getSharedPreferences(file, Context.MODE_PRIVATE).getString(key, null)

    override fun setPreference(file: String, key: String, value: String) {
        context.getSharedPreferences(file, Context.MODE_PRIVATE).edit().putString(key, value).apply()
    }

    override fun removePreference(file: String, key: String) {
        context.getSharedPreferences(file, Context.MODE_PRIVATE).edit().remove(key).apply()
    }

    // ---- Activity results -----------------------------------------------------------------------------------

    private fun beginRequest(promise: Promise, request: Int): Boolean {
        if (pendingPromise != null) {
            promise.reject("BUSY", "Another request is in progress")
            return false
        }
        pendingPromise = promise
        pendingRequest = request
        return true
    }

    private fun finishRequest(): Promise? {
        val p = pendingPromise
        pendingPromise = null
        pendingRequest = 0
        return p
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != pendingRequest) return
        val promise = finishRequest() ?: return
        if (resultCode != Activity.RESULT_OK) {
            if (requestCode == REQUEST_CAPTURE) captureFile?.delete()
            promise.resolve(null)
            return
        }
        when (requestCode) {
            REQUEST_CAPTURE -> {
                // As the legacy captureImage callback: a uri in the result wins over the EXTRA_OUTPUT uri.
                val uri = data?.data ?: captureUri
                promise.resolve(Arguments.createMap().apply {
                    putString("uri", uri.toString())
                    putString("tempPath", captureFile?.absolutePath ?: "")
                })
            }
            else -> {
                val uri = data?.data
                if (uri == null) {
                    promise.resolve(null)
                } else {
                    promise.resolve(Arguments.createMap().apply {
                        putString("uri", uri.toString())
                        putDouble("size", querySize(uri).toDouble())
                    })
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {}

    /** PhotosHelper.addPhoto size check (OpenableColumns.SIZE). */
    private fun querySize(uri: Uri): Long = try {
        context.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(OpenableColumns.SIZE)
            if (idx >= 0 && c.moveToFirst()) c.getLong(idx) else -1L
        } ?: -1L
    } catch (e: Exception) {
        -1L
    }

    companion object {
        const val NAME = "ZedDevice"
        private const val REQUEST_CAPTURE = 9100
        private const val REQUEST_PICK_IMAGE = 9101
        private const val REQUEST_PICK_PDF = 9102

        /** Utils.writeStreamToFile. */
        fun writeStreamToFile(stream: InputStream, file: File) {
            try {
                FileOutputStream(file).use { out ->
                    val buffer = ByteArray(10 * 1024)
                    var length: Int
                    while (stream.read(buffer).also { length = it } != -1) {
                        out.write(buffer, 0, length)
                    }
                }
            } catch (e: IOException) {
                e.printStackTrace()
            }
        }

        fun bytesToHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

        fun hexToBytes(hex: String): ByteArray =
            ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }

        @Suppress("unused")
        fun now(pattern: String): String = SimpleDateFormat(pattern, Locale.ENGLISH).format(Date())
    }
}
