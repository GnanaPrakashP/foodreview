package com.circlebites.mobile

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  override fun onResume() {
    super.onResume()
    applyHighRefreshRate()
  }

  /**
   * Opt the app surface into a higher refresh rate. Android pins it to 60Hz
   * unless the window requests a mode via preferredDisplayModeId, which halves
   * the frames available to animations (e.g. the memory-room tab transitions).
   *
   * Capped at ~90Hz on purpose, NOT 120/144. On-device gfxinfo of the tab
   * transitions (Motorola Edge 70 Fusion, 2026-07-12) showed 90Hz is the sweet
   * spot: janky-frame rate 60Hz 7.3% -> 90Hz 6.0% -> 120Hz 12.1% (90th-pct
   * frame 27ms -> 15ms -> 36ms). The app's heavier frames blow the 120Hz 8.3ms
   * budget but fit the 90Hz 11ms one, so 120Hz measurably INCREASED jank. Raise
   * this cap only if a device/content profile shows a higher rate helps.
   * Re-applied on every resume so it survives backgrounding.
   */
  private fun applyHighRefreshRate() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    val activeDisplay =
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) this.display else windowManager.defaultDisplay)
        ?: return
    val current = activeDisplay.mode ?: return
    val best = activeDisplay.supportedModes
      .filter {
        it.physicalWidth == current.physicalWidth &&
          it.physicalHeight == current.physicalHeight &&
          it.refreshRate <= 90.5f
      }
      .maxByOrNull { it.refreshRate }
      ?: return
    if (best.modeId == current.modeId) return
    window.attributes = window.attributes.apply { preferredDisplayModeId = best.modeId }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
