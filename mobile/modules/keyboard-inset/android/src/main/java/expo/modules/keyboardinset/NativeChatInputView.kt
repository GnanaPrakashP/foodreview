package expo.modules.keyboardinset

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import androidx.core.widget.TextViewCompat
import com.facebook.react.common.assets.ReactFontManager
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt

private class NativeChatInputTextEvent(
  @Field val text: String,
  @Field val eventCount: Int
) : Record

private class NativeChatInputHeightEvent(
  @Field val height: Double
) : Record

/**
 * Emitted for every native edit with the same generation as the text event.
 *
 * The send/mic button used to be derived from the text event on the JS thread,
 * so it waited on an event round trip plus a React commit and visibly lagged
 * the box (which grows natively in the keystroke's own frame). This lets the
 * button ride the UI thread the same way the height does, without putting the
 * text event itself on a worklet — the text still has to reach JS in order.
 */
private class NativeChatInputHasTextEvent(
  @Field val hasText: Boolean,
  @Field val eventCount: Int
) : Record

class NativeChatInputValue(
  @Field val text: String,
  @Field val eventCount: Int
) : Record

class NativeChatInputSubmitResult(
  @Field val text: String,
  @Field val eventCount: Int,
  @Field val wasComposing: Boolean,
  @Field val nativeSubmitAtMs: Double,
  @Field val payloadCapturedAtMs: Double,
  @Field val inputClearedAtMs: Double
) : Record

/**
 * Android-native auto-growing chat input.
 *
 * The EditText measures its content and the bordered input box in one native
 * measure/layout pass. The exported ExpoView keeps a fixed maximum-height
 * canvas, while the EditText itself is laid out against its bottom edge at the
 * current content height. This makes the text, caret, and visible box move as a
 * single native unit even when Enter/Backspace events arrive faster than React
 * can commit.
 *
 * React receives the resulting height as a direct event only to move sibling
 * UI (send button, list spacer). It never drives the EditText's own geometry.
 */
class NativeChatInputView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val density = resources.displayMetrics.density
  private val onTextChange by EventDispatcher<NativeChatInputTextEvent>()
  private val onHeightChange by EventDispatcher<NativeChatInputHeightEvent>()
  private val onHasTextChange by EventDispatcher<NativeChatInputHasTextEvent>()

  private var minInputHeightPx = dp(42.0)
  private var maxInputHeightPx = dp(125.0)
  private var horizontalPaddingPx = dp(12.0)
  private var topPaddingPx = dp(8.0)
  private var bottomPaddingPx = dp(10.0)
  private var borderWidthPx = dp(1.0)
  private var borderRadiusPx = dp(14.0).toFloat()
  private var fillColor = Color.TRANSPARENT
  private var strokeColor = Color.TRANSPARENT
  private var currentInputHeightPx = minInputHeightPx
  private var lastDispatchedHeightPx = -1
  private var mostRecentNativeEventCount = 0
  private var applyingTextProp = false

  private val editText = EditText(context).apply {
    layoutParams = ViewGroup.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.WRAP_CONTENT
    )
    background = null
    gravity = Gravity.BOTTOM or Gravity.START
    includeFontPadding = false
    inputType =
      InputType.TYPE_CLASS_TEXT or
        InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or
        InputType.TYPE_TEXT_FLAG_MULTI_LINE or
        InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
    imeOptions = EditorInfo.IME_ACTION_NONE or EditorInfo.IME_FLAG_NO_EXTRACT_UI
    isSaveEnabled = false
    isSingleLine = false
    isVerticalScrollBarEnabled = false
    maxLines = 5
    minLines = 1
    overScrollMode = View.OVER_SCROLL_NEVER
    setHorizontallyScrolling(false)
    setPadding(horizontalPaddingPx, topPaddingPx, horizontalPaddingPx, bottomPaddingPx)
    setTextColor(Color.WHITE)
    setHintTextColor(Color.GRAY)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
  }

  private val textWatcher = object : TextWatcher {
    override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit

    override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) = Unit

    override fun afterTextChanged(editable: Editable?) {
      // React Native owns the host view's outer layout and may swallow a
      // requestLayout() when that host keeps the same fixed max-height canvas.
      // Measure and place the EditText ourselves while still on the native UI
      // thread so its text, caret, and border grow in this exact edit.
      synchronizeInputGeometry()

      if (!applyingTextProp) {
        val text = editable?.toString().orEmpty()
        mostRecentNativeEventCount += 1
        onHasTextChange(NativeChatInputHasTextEvent(text.isNotBlank(), mostRecentNativeEventCount))
        onTextChange(NativeChatInputTextEvent(text, mostRecentNativeEventCount))
      }
    }
  }

  init {
    clipChildren = false
    clipToPadding = false
    editText.addTextChangedListener(textWatcher)
    addView(editText)
    refreshBackground()
    applyFontFamily("DMSans_500Medium")
    applyLineHeight(21.0)
  }

  fun setTextValue(value: String, eventCount: Int) {
    // React can commit an earlier render after the user has already entered
    // more characters natively. Never let that stale controlled value replace
    // the newer EditText buffer.
    if (eventCount < mostRecentNativeEventCount) return
    replaceTextValue(value)
  }

  private fun replaceTextValue(value: String) {
    if (editText.text?.toString() == value) return
    applyingTextProp = true
    editText.setText(value)
    editText.setSelection(value.length)
    applyingTextProp = false
    synchronizeInputGeometry()
  }

  fun setPlaceholder(value: String) {
    editText.hint = value
  }

  fun setAccessibilityLabel(value: String) {
    editText.contentDescription = value
  }

  fun setEditable(value: Boolean) {
    editText.isEnabled = value
    editText.isFocusable = value
    editText.isFocusableInTouchMode = value
  }

  fun setMaximumLength(value: Int) {
    editText.filters = if (value > 0) arrayOf(InputFilter.LengthFilter(value)) else emptyArray()
  }

  fun setMinimumInputHeight(value: Double) {
    minInputHeightPx = dp(value)
    if (maxInputHeightPx < minInputHeightPx) maxInputHeightPx = minInputHeightPx
    requestLayout()
  }

  fun setMaximumInputHeight(value: Double) {
    maxInputHeightPx = dp(value).coerceAtLeast(minInputHeightPx)
    requestLayout()
  }

  fun setHorizontalPadding(value: Double) {
    horizontalPaddingPx = dp(value)
    applyPadding()
  }

  fun setTopPadding(value: Double) {
    topPaddingPx = dp(value)
    applyPadding()
  }

  fun setBottomPadding(value: Double) {
    bottomPaddingPx = dp(value)
    applyPadding()
  }

  fun setFontSize(value: Double) {
    editText.setTextSize(TypedValue.COMPLEX_UNIT_SP, value.toFloat())
    requestLayout()
  }

  fun applyLineHeight(value: Double) {
    TextViewCompat.setLineHeight(editText, dp(value))
    requestLayout()
  }

  fun applyFontFamily(value: String) {
    editText.typeface = ReactFontManager.getInstance().getTypeface(
      value,
      Typeface.NORMAL,
      context.assets
    )
    requestLayout()
  }

  fun setTextColorValue(value: Int) {
    editText.setTextColor(value)
  }

  fun setPlaceholderColorValue(value: Int) {
    editText.setHintTextColor(value)
  }

  fun setCursorColorValue(value: Int) {
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
      editText.textCursorDrawable?.setTint(value)
    }
  }

  fun setFillColor(value: Int) {
    fillColor = value
    refreshBackground()
  }

  fun setStrokeColor(value: Int) {
    strokeColor = value
    refreshBackground()
  }

  fun setBorderWidth(value: Double) {
    borderWidthPx = dp(value)
    refreshBackground()
  }

  fun setBorderRadius(value: Double) {
    borderRadiusPx = dp(value).toFloat()
    refreshBackground()
  }

  fun focusInput() {
    editText.requestFocus()
    editText.post {
      val inputMethodManager = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      inputMethodManager.showSoftInput(editText, InputMethodManager.SHOW_IMPLICIT)
    }
  }

  fun blurInput() {
    editText.clearFocus()
    val inputMethodManager =
      context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    inputMethodManager.hideSoftInputFromWindow(editText.windowToken, 0)
  }

  fun clearInput() {
    clearNativeBuffer()
    // A programmatic clear used to be completely silent, which lost sends.
    //
    // The counter did not move, so a keystroke event still in flight would be
    // applied by JS after the clear and echoed straight back down through the
    // controlled `value` prop — and setTextValue's guard let it through,
    // restoring the text the user had just sent. The next thing they typed was
    // appended to it and went out as part of the following message.
    //
    // Bumping the counter makes that guard reject the stale echo, and
    // dispatching the empty text tells JS authoritatively, and in order behind
    // any in-flight event, that the box is now empty.
    mostRecentNativeEventCount += 1
    onHasTextChange(NativeChatInputHasTextEvent(false, mostRecentNativeEventCount))
    onTextChange(NativeChatInputTextEvent("", mostRecentNativeEventCount))
  }

  /**
   * One UI-thread transaction owns capture, IME composition commit, clear and
   * generation advance. JS never reconstructs the submitted value from an
   * older text event.
   */
  fun submitAndClear(): NativeChatInputSubmitResult {
    val nativeSubmitAtMs = SystemClock.elapsedRealtimeNanos() / 1_000_000.0
    val editable = editText.text
    val wasComposing = editable != null &&
      BaseInputConnection.getComposingSpanStart(editable) >= 0
    if (editable != null) BaseInputConnection.removeComposingSpans(editable)
    val submittedText = editable?.toString().orEmpty()
    val payloadCapturedAtMs = SystemClock.elapsedRealtimeNanos() / 1_000_000.0
    if (submittedText.isBlank()) {
      return NativeChatInputSubmitResult(
        submittedText,
        mostRecentNativeEventCount,
        wasComposing,
        nativeSubmitAtMs,
        payloadCapturedAtMs,
        payloadCapturedAtMs
      )
    }

    clearNativeBuffer()
    val inputClearedAtMs = SystemClock.elapsedRealtimeNanos() / 1_000_000.0
    mostRecentNativeEventCount += 1
    onHasTextChange(NativeChatInputHasTextEvent(false, mostRecentNativeEventCount))
    onTextChange(NativeChatInputTextEvent("", mostRecentNativeEventCount))
    return NativeChatInputSubmitResult(
      submittedText,
      mostRecentNativeEventCount,
      wasComposing,
      nativeSubmitAtMs,
      payloadCapturedAtMs,
      inputClearedAtMs
    )
  }

  private fun clearNativeBuffer() {
    if (editText.text.isNullOrEmpty()) {
      synchronizeInputGeometry()
      return
    }
    applyingTextProp = true
    editText.text?.clear()
    applyingTextProp = false
    synchronizeInputGeometry()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val rootWidth = MeasureSpec.getSize(widthMeasureSpec)
    val rootHeight = when (MeasureSpec.getMode(heightMeasureSpec)) {
      MeasureSpec.EXACTLY -> MeasureSpec.getSize(heightMeasureSpec)
      MeasureSpec.AT_MOST -> maxInputHeightPx.coerceAtMost(MeasureSpec.getSize(heightMeasureSpec))
      else -> maxInputHeightPx
    }
    measureInput(rootWidth)

    setMeasuredDimension(
      resolveSize(rootWidth, widthMeasureSpec),
      resolveSize(rootHeight, heightMeasureSpec)
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val rootHeight = bottom - top
    val rootWidth = right - left
    layoutInput(rootWidth, rootHeight)
  }

  private fun synchronizeInputGeometry() {
    val rootWidth = width
    val rootHeight = height
    if (rootWidth <= 0 || rootHeight <= 0) {
      requestLayout()
      return
    }

    measureInput(rootWidth)
    layoutInput(rootWidth, rootHeight)
    editText.invalidate()
    invalidate()
  }

  private fun measureInput(rootWidth: Int) {
    val childWidth = rootWidth.coerceAtLeast(0)
    val childWidthSpec = MeasureSpec.makeMeasureSpec(childWidth, MeasureSpec.EXACTLY)

    // First pass asks EditText for its intrinsic content height. Second pass
    // fixes the visible bordered box to the clamped result so gravity, caret,
    // and glyph positions all resolve against the exact same native height.
    // forceLayout prevents Android from reusing the previous one-line measure
    // specs when rapid edits arrive inside the same traversal.
    editText.forceLayout()
    editText.measure(
      childWidthSpec,
      MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
    )
    currentInputHeightPx = editText.measuredHeight.coerceIn(minInputHeightPx, maxInputHeightPx)
    editText.measure(
      childWidthSpec,
      MeasureSpec.makeMeasureSpec(currentInputHeightPx, MeasureSpec.EXACTLY)
    )
  }

  private fun layoutInput(rootWidth: Int, rootHeight: Int) {
    val childTop = (rootHeight - currentInputHeightPx).coerceAtMost(rootHeight)
    editText.layout(0, childTop, rootWidth, childTop + currentInputHeightPx)

    if (lastDispatchedHeightPx != currentInputHeightPx) {
      lastDispatchedHeightPx = currentInputHeightPx
      onHeightChange(NativeChatInputHeightEvent(currentInputHeightPx / density.toDouble()))
    }
  }

  private fun applyPadding() {
    editText.setPadding(horizontalPaddingPx, topPaddingPx, horizontalPaddingPx, bottomPaddingPx)
    requestLayout()
  }

  private fun refreshBackground() {
    editText.background = GradientDrawable().apply {
      cornerRadius = borderRadiusPx
      setColor(fillColor)
      setStroke(borderWidthPx, strokeColor)
    }
    // Android backgrounds may replace the TextView's existing padding.
    applyPadding()
  }

  private fun dp(value: Double): Int = (value * density).roundToInt()
}
