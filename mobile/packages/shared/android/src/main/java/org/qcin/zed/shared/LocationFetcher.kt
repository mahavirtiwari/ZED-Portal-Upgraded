package org.qcin.zed.shared

import android.annotation.SuppressLint
import android.app.Activity
import android.location.Location
import android.os.Build
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.util.Timer
import java.util.TimerTask

/**
 * The legacy global/LocationFetcher.java: fused provider, last known location first, then high-accuracy updates
 * (interval 1 s, fastest 0.5 s). A fix counts when it is not mocked, accuracy <= 100 m and younger than 15 minutes.
 * On timeout (10 s in the legacy apps) the last non-mocked location is used whatever its accuracy; if every location
 * in an update is mocked the request fails with the legacy mock message.
 */
class LocationFetcher(
    private val activity: Activity,
    private val timeoutMs: Long,
    private val promise: Promise,
) {
    private var lastLocation: Location? = null
    private var currentLocation: Location? = null
    private lateinit var client: FusedLocationProviderClient
    private val timer = Timer()
    private var resultReturned = false

    private val callback = object : LocationCallback() {
        override fun onLocationResult(locationResult: LocationResult) {
            var allMockLocations = true
            for (location in locationResult.locations) {
                if (!isMock(location)) allMockLocations = false
                if (!isMock(location) && location.accuracy <= 100 &&
                    (System.currentTimeMillis() - location.time) < LOCATION_THRESHOLD
                ) {
                    currentLocation = location
                    lastLocation = location
                }
            }
            if (allMockLocations) {
                returnResult(MOCKED_MESSAGE)
                return
            }
            if (currentLocation != null) returnResult(null)
        }
    }

    @SuppressLint("MissingPermission")
    fun start() {
        try {
            client = LocationServices.getFusedLocationProviderClient(activity)
            client.lastLocation.addOnSuccessListener { location ->
                if (location != null && !isMock(location)) {
                    lastLocation = location
                    if (location.accuracy <= 100 && (System.currentTimeMillis() - location.time) < LOCATION_THRESHOLD) {
                        currentLocation = location
                    }
                }
            }
            val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000)
                .setMinUpdateIntervalMillis(500)
                .build()
            client.requestLocationUpdates(request, callback, Looper.getMainLooper())
            timer.schedule(object : TimerTask() {
                override fun run() {
                    activity.runOnUiThread { onRequestTimeout(null) }
                }
            }, timeoutMs)
        } catch (e: SecurityException) {
            resultReturned = true
            promise.reject(NO_PERMISSION, "Location permission needed to access current location", e)
        } catch (e: Exception) {
            resultReturned = true
            promise.reject(UNAVAILABLE, e.message, e)
        }
    }

    private fun returnResult(errorMessage: String?) {
        onRequestTimeout(errorMessage)
        timer.cancel()
        timer.purge()
    }

    private fun onRequestTimeout(errorMessage: String?) {
        if (resultReturned) return
        if (!errorMessage.isNullOrEmpty()) {
            promise.reject(MOCKED, errorMessage)
        } else {
            if (currentLocation == null) currentLocation = lastLocation
            val location = currentLocation
            if (location != null) {
                promise.resolve(Arguments.createMap().apply {
                    putDouble("latitude", location.latitude)
                    putDouble("longitude", location.longitude)
                    // Kotlin Double.toString, as the legacy location.latitude.toString()
                    putString("latitudeText", location.latitude.toString())
                    putString("longitudeText", location.longitude.toString())
                    putDouble("accuracy", location.accuracy.toDouble())
                    putDouble("time", location.time.toDouble())
                })
            } else {
                promise.reject(UNAVAILABLE, "Location unavailable")
            }
        }
        try {
            client.removeLocationUpdates(callback)
        } catch (_: Exception) {
        }
        resultReturned = true
    }

    private fun isMock(location: Location): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) location.isMock
        else @Suppress("DEPRECATION") location.isFromMockProvider

    companion object {
        const val LOCATION_THRESHOLD = 15 * 60 * 1000L
        const val MOCKED = "MOCKED"
        const val UNAVAILABLE = "UNAVAILABLE"
        const val NO_PERMISSION = "NO_PERMISSION"
        const val MOCKED_MESSAGE = "Seems like the location is mocked, please uninstall any mock GPS apps and try again"
    }
}
