package com.qci.zed.msmeapp.ccavenue

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity
import com.ccavenue.indiasdk.AvenueOrder
import com.ccavenue.indiasdk.AvenuesApplication
import com.ccavenue.indiasdk.AvenuesTransactionCallback

/**
 * Runs one CCAvenue checkout (PaymentActivity.makePayment of the MSME code base) and returns its outcome to
 * [CcAvenueModule]. The SDK calls back the Context it was started from, so this invisible activity is that Context:
 * it starts the SDK's screens and finishes with the result. An AppCompatActivity, as the legacy PaymentActivity: the SDK
 * shows its progress as a dialog fragment and goes no further when it cannot.
 *
 * The SDK does not always call back (e.g. when CCAvenue refuses the order before its screens open), so this screen is
 * never a dead end: it shows "Opening the payment gateway…" with Cancel, and Back cancels too.
 */
class CcAvenueCheckoutActivity : AppCompatActivity(), AvenuesTransactionCallback {

  private var started = false
  private var finished = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(waitingView())
    onBackPressedDispatcher.addCallback(this) { finishWith(OUTCOME_CANCEL) }
    started = savedInstanceState?.getBoolean(STARTED) ?: false
    if (started) return
    val e = intent.getBundleExtra(EXTRA_ORDER) ?: return finishWith(OUTCOME_ERROR, error = "No order")
    val order = AvenueOrder().apply {
      setOrderId(e.getString("orderId"))
      setMerchantId(e.getString("merchantId"))
      setAccessCode(e.getString("accessCode"))
      setCurrency("INR")
      setAmount(e.getString("amount"))
      setRequestHash(e.getString("requestHash"))
      setCustomerId(e.getString("customerId"))
      setBillingName(e.getString("name"))
      setBillingAddress(e.getString("address"))
      setBillingCountry("India")
      setBillingState(e.getString("state"))
      setBillingCity(e.getString("city"))
      setBillingZip(e.getString("zip"))
      setBillingTel(e.getString("tel"))
      setBillingEmail(e.getString("email"))
      setDeliveryName(e.getString("name"))
      setDeliveryAddress(e.getString("address"))
      setDeliveryCountry("India")
      setDeliveryState(e.getString("state"))
      setDeliveryCity(e.getString("city"))
      setDeliveryZip(e.getString("zip"))
      setDeliveryTel(e.getString("tel"))
      setDeliveryEmail(e.getString("email"))
      setMerchant_param1(e.getString("merchantParam1"))
      setMerchant_param2(e.getString("merchantParam2"))
      setPaymentEnviroment(e.getString("environment") ?: "app_live")
      setPaymentType("all")
      setRedirectUrl(e.getString("redirectUrl"))
      setCancelUrl(e.getString("cancelUrl"))
      setColorPrimary("#45A5AD")
      setColorAccent("#45A5AD")
    }
    started = true
    AvenuesApplication.startTransaction(this, order)
  }

  private fun waitingView(): LinearLayout {
    val dp = resources.displayMetrics.density
    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setBackgroundColor(Color.WHITE)
      setPadding((24 * dp).toInt(), (24 * dp).toInt(), (24 * dp).toInt(), (16 * dp).toInt())
      addView(ProgressBar(context))
      addView(TextView(context).apply {
        text = "Opening the payment gateway…"
        setTextColor(Color.BLACK)
        textSize = 16f
        setPadding(0, (12 * dp).toInt(), 0, (12 * dp).toInt())
      })
      addView(Button(context).apply {
        text = "Cancel"
        setOnClickListener { finishWith(OUTCOME_CANCEL) }
      })
    }
    return LinearLayout(this).apply {
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#99000000"))
      addView(card)
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putBoolean(STARTED, started)
  }

  /** "verified_order_status" "Success" (case-insensitive) is a success, anything else a failure (as before). */
  override fun onTransactionResponse(bundle: Bundle?) {
    val status = bundle?.getString("verified_order_status")
    val description = bundle?.getString("verified_order_status_desc")
    finishWith(OUTCOME_RESPONSE, status = status, description = description)
  }

  override fun onErrorOccurred(error: String?) = finishWith(OUTCOME_ERROR, error = error)

  override fun onCancelTransaction() = finishWith(OUTCOME_CANCEL)

  private fun finishWith(outcome: String, status: String? = null, description: String? = null, error: String? = null) {
    if (finished) return
    finished = true
    // The outcome only (no card or order data): what support needs to read a reported failure.
    Log.i(TAG, "checkout $outcome status=$status description=$description error=$error")
    setResult(RESULT_OK, Intent().apply {
      putExtra(RESULT_OUTCOME, outcome)
      putExtra(RESULT_STATUS, status)
      putExtra(RESULT_DESCRIPTION, description)
      putExtra(RESULT_ERROR, error)
    })
    finish()
  }

  companion object {
    const val EXTRA_ORDER = "zed.ccavenue.order"
    const val RESULT_OUTCOME = "outcome"
    const val RESULT_STATUS = "status"
    const val RESULT_DESCRIPTION = "description"
    const val RESULT_ERROR = "error"
    const val OUTCOME_RESPONSE = "response"
    const val OUTCOME_ERROR = "error"
    const val OUTCOME_CANCEL = "cancel"
    private const val STARTED = "started"
    private const val TAG = "ZedCcAvenue"
  }
}
