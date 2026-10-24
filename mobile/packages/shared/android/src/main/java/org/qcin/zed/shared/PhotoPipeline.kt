package org.qcin.zed.shared

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * The legacy photo pipeline (ZED_MSME_Bronze global/PhotoCaptureHelper.kt and global/Utils.kt), kept call for call
 * so that captured photos are scaled, rotated, stamped, compressed, named and stored exactly as before:
 *
 *  1. MediaStore.Images.Media.getBitmap(uri)
 *  2. Bitmap.createScaledBitmap to at most IMAGE_MAX_DIMENSION (1080) on the longer side, aspect kept
 *  3. rotation by ExifInterface.TAG_ORIENTATION of the source (90/180/270), after scaling
 *  4. stamp: Paint(textSize 20, Color.BLUE, FILL); line height = measureText("yY");
 *     drawText(time, 20, h + 15), drawText("Lat: <lat>,", 20, 2h + 15), drawText("Long: <long>", 20, 3h + 15)
 *     only when both coordinates are present; time = "MMM dd, yyyy h:mm a" (Locale.ENGLISH)
 *  5. base64 (NO_WRAP) of the bitmap as JPEG quality 75 (Utils.getBitmapString, stored in photos_table.photo)
 *  6. file filesDir/<UUID>.<extension of the uri's MIME type, default jpg>, JPEG quality 100 (copyImage)
 */
object PhotoPipeline {
    private const val TAG = "ZedPhotoPipeline"
    const val IMAGE_MAX_DIMENSION = 1080
    const val STAMP_TEXT_SIZE = 20f
    const val STAMP_X = 20f
    const val STAMP_Y_OFFSET = 15f
    const val PREVIEW_JPEG_QUALITY = 75
    const val FILE_JPEG_QUALITY = 100
    private val dateTimeFormat = SimpleDateFormat("MMM dd, yyyy h:mm a", Locale.ENGLISH)

    data class Result(val photoPath: String, val base64: String, val timeStamp: String, val width: Int, val height: Int)

    /**
     * The older pipeline of the site assessor and consultant apps (BaseActivity.displayImageWithUri + getBitmapString):
     * decode (inSampleSize 1..9 on OutOfMemory), scale to at most BARCODE_IMAGE_MAX_DIMENSION (1280), EXIF rotation, the
     * same stamp, then base64 (DEFAULT, i.e. wrapped every 76 characters) of JPEG quality 75. No file is kept: the photo
     * lives in the app's JSON as base64.
     */
    const val INLINE_MAX_DIMENSION = 1280

    data class InlineResult(val base64: String, val timeStamp: String, val width: Int, val height: Int)

    /** BaseActivity.getCurrentTimeStamp (the auto-time check is done in JS before capturing). */
    fun currentTimeStamp(): String = try {
        dateTimeFormat.format(Date(System.currentTimeMillis()))
    } catch (e: Exception) {
        ""
    }

    /** Utils.getSharedCacheDir. */
    fun sharedCacheDir(context: Context): File {
        val folder = File(context.cacheDir, "SharedDocs")
        if (!folder.exists()) folder.mkdir()
        return folder
    }

    /** Utils.createImageFile: cacheDir/SharedDocs/Geostat_yyyyMMdd_HHmmss_<random>.jpg. */
    @Throws(IOException::class)
    fun createImageFile(context: Context): File {
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ENGLISH).format(Date())
        return File.createTempFile("Geostat_" + timeStamp + "_", ".jpg", sharedCacheDir(context))
    }

    fun process(context: Context, uri: Uri, latitude: String?, longitude: String?): Result? {
        val stamp = currentTimeStamp()
        val bitmap = getScaledBitmap(context, uri, latitude, longitude, stamp) ?: return null
        val base64 = getBitmapString(bitmap)
        val path = copyImage(context, uri, bitmap) ?: return null
        return Result(path, base64 ?: "", stamp, bitmap.width, bitmap.height)
    }

    fun processInline(context: Context, uri: Uri, latitude: String?, longitude: String?, quality: Int = PREVIEW_JPEG_QUALITY): InlineResult? {
        val stamp = currentTimeStamp()
        for (i in 1..9) {
            try {
                val o = BitmapFactory.Options()
                o.inSampleSize = i
                o.inJustDecodeBounds = true
                context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) }
                o.inJustDecodeBounds = false
                o.inMutable = true
                val decoded = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) } ?: return null
                val dim = getAspectRatio(o.outWidth, o.outHeight, INLINE_MAX_DIMENSION).split(",")
                var scaledBitmap = Bitmap.createScaledBitmap(decoded, dim[0].toInt(), dim[1].toInt(), true)
                scaledBitmap = imageOrientationValidator(scaledBitmap, uri, context)
                drawStamp(scaledBitmap, latitude, longitude, stamp)
                val stream = ByteArrayOutputStream()
                scaledBitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream)
                val base64 = Base64.encodeToString(stream.toByteArray(), Base64.DEFAULT)
                stream.close()
                return InlineResult(base64, stamp, scaledBitmap.width, scaledBitmap.height)
            } catch (e: OutOfMemoryError) {
                System.gc()
            } catch (e: Exception) {
                Log.e(TAG, e.message ?: "inline processing failed")
                return null
            }
        }
        return null
    }

    private fun drawStamp(bitmap: Bitmap, latitude: String?, longitude: String?, curTime: String) {
        try {
            val cs = Canvas(bitmap)
            val tPaint = Paint()
            tPaint.textSize = STAMP_TEXT_SIZE
            tPaint.color = Color.BLUE
            tPaint.style = Paint.Style.FILL
            if (latitude != null && longitude != null) {
                val height = tPaint.measureText("yY")
                cs.drawText(curTime, STAMP_X, height + STAMP_Y_OFFSET, tPaint)
                cs.drawText("Lat: $latitude,", STAMP_X, height + height + STAMP_Y_OFFSET, tPaint)
                cs.drawText("Long: $longitude", STAMP_X, height + height + height + STAMP_Y_OFFSET, tPaint)
            }
        } catch (e: Exception) {
            Log.e(TAG, e.message ?: "stamp failed")
        }
    }

    @Suppress("DEPRECATION")
    private fun getScaledBitmap(context: Context, uri: Uri, latitude: String?, longitude: String?, curTime: String): Bitmap? {
        return try {
            val bm = MediaStore.Images.Media.getBitmap(context.contentResolver, uri)
            for (i in 1..9) {
                try {
                    val dim = getAspectRatio(bm.width, bm.height, IMAGE_MAX_DIMENSION).split(",")
                    var scaledBitmap = Bitmap.createScaledBitmap(bm, dim[0].toInt(), dim[1].toInt(), true)
                    scaledBitmap = imageOrientationValidator(scaledBitmap, uri, context)
                    try {
                        val cs = Canvas(scaledBitmap)
                        val tPaint = Paint()
                        tPaint.textSize = STAMP_TEXT_SIZE
                        tPaint.color = Color.BLUE
                        tPaint.style = Paint.Style.FILL
                        if (latitude != null && longitude != null) {
                            val height = tPaint.measureText("yY")
                            cs.drawText(curTime, STAMP_X, height + STAMP_Y_OFFSET, tPaint)
                            val latStr = "Lat: $latitude,"
                            val longStr = "Long: $longitude"
                            cs.drawText(latStr, STAMP_X, height + height + STAMP_Y_OFFSET, tPaint)
                            cs.drawText(longStr, STAMP_X, height + height + height + STAMP_Y_OFFSET, tPaint)
                        }
                    } catch (e: Exception) {
                        // As the legacy code: an immutable bitmap (small, unrotated source) is kept unstamped.
                        Log.e(TAG, e.message ?: "stamp failed")
                    }
                    return scaledBitmap
                } catch (e: OutOfMemoryError) {
                    System.gc()
                }
            }
            null
        } catch (e: Exception) {
            null
        }
    }

    private fun imageOrientationValidator(bitmap: Bitmap, image: Uri, context: Context): Bitmap {
        var updatedBitmap = bitmap
        try {
            val ei = context.contentResolver.openInputStream(image)?.use { ExifInterface(it) }
            when (ei?.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> updatedBitmap = rotateImage(bitmap, 90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> updatedBitmap = rotateImage(bitmap, 180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> updatedBitmap = rotateImage(bitmap, 270f)
            }
        } catch (e: IOException) {
            e.printStackTrace()
        } catch (e: Exception) {
            Log.e(TAG, e.message ?: "orientation failed")
        }
        return updatedBitmap
    }

    private fun rotateImage(source: Bitmap, angle: Float): Bitmap {
        var bitmap: Bitmap? = null
        val matrix = Matrix()
        matrix.postRotate(angle)
        try {
            bitmap = Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
        } catch (err: OutOfMemoryError) {
            err.printStackTrace()
        } catch (e: Exception) {
            Log.e(TAG, e.message ?: "rotate failed")
        }
        return bitmap ?: source
    }

    /** PhotoCaptureHelper.getAspectRatio: scales only when a side reaches maxSize. */
    fun getAspectRatio(width: Int, height: Int, maxSize: Int): String {
        return if (maxSize <= width || maxSize <= height) {
            val ratioX = maxSize.toFloat() / width.toFloat()
            val ratioY = maxSize.toFloat() / height.toFloat()
            val ratio = ratioX.coerceAtMost(ratioY)
            "${(width * ratio).toInt()},${(height * ratio).toInt()}"
        } else {
            "$width,$height"
        }
    }

    /** Utils.getBitmapString. */
    private fun getBitmapString(bitmap: Bitmap): String? {
        var encodeImage: String? = ""
        for (i in 0..1) {
            try {
                val stream = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, PREVIEW_JPEG_QUALITY, stream)
                encodeImage = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                stream.close()
                return encodeImage
            } catch (e: Exception) {
                Log.d(TAG, "Exception in getBitmapString")
            } catch (e: OutOfMemoryError) {
                System.gc()
            }
        }
        return encodeImage
    }

    /** PhotoCaptureHelper.copyImage. */
    private fun copyImage(context: Context, uri: Uri, bitmap: Bitmap): String? {
        val extension: String? = MimeTypeMap.getSingleton().getExtensionFromMimeType(context.contentResolver.getType(uri))
        context.contentResolver.openInputStream(uri)?.use {
            val file = File(context.filesDir, UUID.randomUUID().toString() + ".${(extension ?: "jpg")}")
            file.createNewFile()
            FileOutputStream(file).use { fos -> bitmap.compress(Bitmap.CompressFormat.JPEG, FILE_JPEG_QUALITY, fos) }
            return file.absolutePath
        }
        return null
    }
}
