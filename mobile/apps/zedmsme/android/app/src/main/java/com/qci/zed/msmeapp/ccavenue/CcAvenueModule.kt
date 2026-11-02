package com.qci.zed.msmeapp.ccavenue

import android.app.Activity
import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.ViewManager

/**
 * `ZedCcAvenue.startTransaction(order)`: opens CCAvenue's checkout (its Android SDK, libs/indiasdk_grid_v1.2.aar)
 * for an order the server prepared (Pay/GetToken) and resolves { outcome: response|error|cancel, status,
 * description, error }. The payment itself is recorded by the server from CCAvenue's redirect, not from this answer.
 */
class CcAvenueModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), ActivityEventListener {

  private var pending: Promise? = null

  init {
    context.addActivityEventListener(this)
  }

  override fun getName() = NAME

  @ReactMethod
  fun startTransaction(order: ReadableMap, promise: Promise) {
    val activity = context.currentActivity ?: return promise.reject("no_activity", "The app is not in the foreground")
    if (pending != null) return promise.reject("busy", "A payment is already open")
    val extras = android.os.Bundle()
    val it = order.keySetIterator()
    while (it.hasNextKey()) {
      val key = it.nextKey()
      if (!order.isNull(key)) extras.putString(key, order.getString(key))
    }
    pending = promise
    activity.startActivityForResult(
      Intent(activity, CcAvenueCheckoutActivity::class.java).putExtra(CcAvenueCheckoutActivity.EXTRA_ORDER, extras),
      REQUEST,
    )
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST) return
    val promise = pending ?: return
    pending = null
    val result = Arguments.createMap().apply {
      putString("outcome", data?.getStringExtra(CcAvenueCheckoutActivity.RESULT_OUTCOME) ?: CcAvenueCheckoutActivity.OUTCOME_CANCEL)
      putString("status", data?.getStringExtra(CcAvenueCheckoutActivity.RESULT_STATUS))
      putString("description", data?.getStringExtra(CcAvenueCheckoutActivity.RESULT_DESCRIPTION))
      putString("error", data?.getStringExtra(CcAvenueCheckoutActivity.RESULT_ERROR))
    }
    promise.resolve(result)
  }

  override fun onNewIntent(intent: Intent) = Unit

  companion object {
    const val NAME = "ZedCcAvenue"
    private const val REQUEST = 4711
  }
}

class CcAvenuePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(CcAvenueModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
