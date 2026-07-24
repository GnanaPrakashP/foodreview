package expo.modules.keyboardinset

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KeyboardInsetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KeyboardInset")

    View(KeyboardInsetView::class) {
      // Whether this surface should track the IME. Only the visible chat tab
      // sets this true, so a keyboard opened on another tab does not move it.
      Prop("active") { view, active: Boolean ->
        view.setActiveState(active)
      }

      // Composer's closed-state bottom padding, in dp (RN units). The safe-area
      // portion of it is absorbed into the translation so the composer rests
      // `openGap` above the keyboard when open. Converted to px natively.
      Prop("closedGap") { view, closedGap: Double ->
        view.closedGapDp = closedGap.toFloat()
        view.reapply()
      }

      // Resting gap between the composer and the keyboard top when open, in dp.
      Prop("openGap") { view, openGap: Double ->
        view.openGapDp = openGap.toFloat()
        view.reapply()
      }

      // Verbose per-frame logcat of the inset callback (tag: KeyboardInsetView).
      Prop("debug") { view, debug: Boolean ->
        view.debug = debug
      }
    }
  }
}
