package expo.modules.keyboardinset

import android.os.Build
import android.os.Trace
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KeyboardInsetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KeyboardInset")

    // Release-profile instrumentation uses Android's app trace tag directly.
    // React Native's Systrace.isEnabled() remains false on some production
    // builds even when atrace/Perfetto has enabled app tracing.
    Function("beginMemoryRoomTrace") { name: String, cookie: Int ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        Trace.beginAsyncSection(name, cookie)
      }
    }

    Function("endMemoryRoomTrace") { name: String, cookie: Int ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        Trace.endAsyncSection(name, cookie)
      }
    }

    Function("setMemoryRoomTraceCounter") { name: String, value: Int ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        Trace.setCounter(name, value.toLong())
      }
    }

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

    View(NativeChatInputView::class) {
      Name("ChatInput")
      Events("onTextChange", "onHeightChange", "onHasTextChange")

      Prop("value") { view, value: NativeChatInputValue ->
        view.setTextValue(value.text, value.eventCount)
      }
      Prop("placeholder") { view, placeholder: String ->
        view.setPlaceholder(placeholder)
      }
      Prop("accessibilityLabel") { view, label: String ->
        view.setAccessibilityLabel(label)
      }
      Prop("editable") { view, editable: Boolean ->
        view.setEditable(editable)
      }
      Prop("maxLength") { view, maxLength: Int ->
        view.setMaximumLength(maxLength)
      }
      Prop("minInputHeight") { view, height: Double ->
        view.setMinimumInputHeight(height)
      }
      Prop("maxInputHeight") { view, height: Double ->
        view.setMaximumInputHeight(height)
      }
      Prop("horizontalPadding") { view, padding: Double ->
        view.setHorizontalPadding(padding)
      }
      Prop("topPadding") { view, padding: Double ->
        view.setTopPadding(padding)
      }
      Prop("bottomPadding") { view, padding: Double ->
        view.setBottomPadding(padding)
      }
      Prop("fontSize") { view, fontSize: Double ->
        view.setFontSize(fontSize)
      }
      Prop("lineHeight") { view, lineHeight: Double ->
        view.applyLineHeight(lineHeight)
      }
      Prop("fontFamily") { view, fontFamily: String ->
        view.applyFontFamily(fontFamily)
      }
      Prop("textColor") { view, color: Int ->
        view.setTextColorValue(color)
      }
      Prop("placeholderColor") { view, color: Int ->
        view.setPlaceholderColorValue(color)
      }
      Prop("cursorColor") { view, color: Int ->
        view.setCursorColorValue(color)
      }
      Prop("fillColor") { view, color: Int ->
        view.setFillColor(color)
      }
      Prop("strokeColor") { view, color: Int ->
        view.setStrokeColor(color)
      }
      Prop("borderWidth") { view, width: Double ->
        view.setBorderWidth(width)
      }
      Prop("borderRadius") { view, radius: Double ->
        view.setBorderRadius(radius)
      }

      AsyncFunction("focus") { view: NativeChatInputView ->
        view.focusInput()
      }
      AsyncFunction("clear") { view: NativeChatInputView ->
        view.clearInput()
      }
      AsyncFunction("submit") { view: NativeChatInputView ->
        view.submitAndClear()
      }
    }
  }
}
