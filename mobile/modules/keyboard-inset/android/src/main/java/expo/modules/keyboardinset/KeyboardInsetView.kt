package expo.modules.keyboardinset

import android.content.Context
import android.util.Log
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

private const val TAG = "KeyboardInsetView"

/**
 * A container that glues its children to the soft keyboard by translating
 * itself from the IME inset on the native side — the same mechanism
 * WhatsApp/Instagram use. Setting translationY updates the view's RenderNode and
 * redraws without a measure/layout traversal, so it bypasses the React/Fabric
 * per-frame commit that stalls ~33ms at slide start on this device (see the
 * memory-room keyboard forensics). The composer + message list are children, so
 * they travel as one rigid unit with the keyboard.
 *
 * Two inset sources are handled:
 *  - WindowInsetsAnimationCompat.Callback.onProgress drives the per-frame SLIDE
 *    (normal keyboard open/close). The root KeyboardProvider dispatches with
 *    DISPATCH_MODE_CONTINUE_ON_SUBTREE, so this deeper callback still fires.
 *  - setOnApplyWindowInsetsListener catches NON-animated inset changes — most
 *    importantly the alphabet<->emoji panel swap, which resizes the IME with no
 *    WindowInsetsAnimation, so onProgress never sees it. It is gated by an
 *    `animating` flag so it only applies the settled inset when no slide is in
 *    flight (otherwise it would snap to the target mid-open and fight onProgress).
 *
 * We never consume the insets (return them unchanged), so other consumers
 * (safe-area, RNKC's JS events) are unaffected.
 */
class KeyboardInsetView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var closedGapDp: Float = 0f
  var openGapDp: Float = 0f
  var debug: Boolean = false

  private var active: Boolean = false
  private val density: Float = context.resources.displayMetrics.density
  private var animating = false
  private var frame = 0

  init {
    ViewCompat.setWindowInsetsAnimationCallback(
      this,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onPrepare(animation: WindowInsetsAnimationCompat) {
          // Fires before the view is laid out with the new insets, i.e. before
          // the apply-listener sees the target — so setting this here reliably
          // suppresses the pre-slide snap.
          animating = true
          frame = 0
        }

        override fun onProgress(
          insets: WindowInsetsCompat,
          runningAnimations: MutableList<WindowInsetsAnimationCompat>
        ): WindowInsetsCompat {
          frame++
          applyFromInsets(insets, "progress#$frame")
          return insets
        }

        override fun onEnd(animation: WindowInsetsAnimationCompat) {
          animating = false
          // The last onProgress frame is normally exact; reconcile to the
          // settled inset defensively so an interrupted animation can't leave
          // the surface parked at a stale offset.
          ViewCompat.getRootWindowInsets(this@KeyboardInsetView)?.let {
            applyFromInsets(it, "end")
          }
        }
      }
    )

    ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
      // Only handle the settled/instant case here; the slide is owned by
      // onProgress. This is what tracks the emoji-panel swap and guarantees the
      // resting offset always matches the current IME height (fixes "stuck at
      // emoji height" after switching panels).
      if (!animating) {
        applyFromInsets(insets, "applyInsets")
      }
      insets
    }
  }

  fun setActiveState(next: Boolean) {
    if (active == next) return
    active = next
    if (debug) Log.d(TAG, "setActiveState active=$next")
    reapply()
  }

  /** Re-evaluate translation from the current insets (prop change / activation). */
  fun reapply() {
    val insets = ViewCompat.getRootWindowInsets(this)
    if (insets != null) {
      applyFromInsets(insets, "reapply")
    } else if (!active) {
      translationY = 0f
    }
  }

  private fun applyFromInsets(insets: WindowInsetsCompat, reason: String) {
    if (!active) {
      if (translationY != 0f) translationY = 0f
      return
    }
    // ime().bottom is the full keyboard height from the window bottom (it
    // overlays the nav bar). The composer's static closed padding already holds
    // it above the nav bar, so absorb only (closedGap - openGap) and lift the
    // rest, leaving the composer exactly openGap above the keyboard top.
    val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    val closedSafeAreaGapPx = ((closedGapDp - openGapDp) * density).coerceAtLeast(0f)
    val shift = (ime.toFloat() - closedSafeAreaGapPx).coerceAtLeast(0f)
    translationY = -shift
    if (debug) {
      Log.d(TAG, "$reason ime=$ime shiftPx=$shift ty=$translationY tMs=${System.nanoTime() / 1_000_000}")
    }
  }
}
