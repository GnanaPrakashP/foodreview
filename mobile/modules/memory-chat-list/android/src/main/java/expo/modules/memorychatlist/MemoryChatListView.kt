package expo.modules.memorychatlist

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.SystemClock
import android.os.Trace
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.facebook.react.common.assets.ReactFontManager
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.time.Instant
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

private const val TYPE_INCOMING_TEXT = 1
private const val TYPE_OUTGOING_TEXT = 2
private const val TYPE_INCOMING_REPLY = 3
private const val TYPE_OUTGOING_REPLY = 4
private const val TYPE_DATE = 5
private const val TYPE_UNREAD = 6
private const val TYPE_SYSTEM = 7
private const val MAX_REVEAL_FRAMES = 4

private const val EVENT_ROWS_RECEIVED = "NATIVE_CHAT_ROWS_RECEIVED"
private const val EVENT_LAYOUT_LISTENER_REGISTERED =
  "NATIVE_CHAT_LAYOUT_LISTENER_REGISTERED"
private const val EVENT_LAYOUT_REQUESTED = "NATIVE_CHAT_LAYOUT_REQUESTED"
private const val EVENT_BOUNDS_READY = "NATIVE_CHAT_BOUNDS_READY"
private const val EVENT_CELLS_ATTACHED = "NATIVE_CHAT_CELLS_ATTACHED"
private const val EVENT_ANCHOR_APPLIED = "NATIVE_CHAT_ANCHOR_APPLIED"
private const val EVENT_PRE_DRAW = "NATIVE_CHAT_PRE_DRAW"
private const val EVENT_REVEALED = "NATIVE_CHAT_REVEALED"
private const val EVENT_REVEAL_FALLBACK = "NATIVE_CHAT_REVEAL_FALLBACK"
private const val EVENT_REVEAL_FAILED = "NATIVE_CHAT_REVEAL_FAILED"

private const val INCOMING_BUBBLE = 0xFFF7F3EC.toInt()
private const val OUTGOING_BUBBLE = 0xFFE0F0D4.toInt()
private const val PANEL_BORDER = 0xFFE3D8C8.toInt()
private const val TEXT_PRIMARY = 0xFF2E2923.toInt()
private const val TEXT_MUTED = 0xFF786F65.toInt()
private const val ACCENT = 0xFF9A572D.toInt()
private const val SELECTED = 0x333E7B4F

private class TracingMemoryChatRecyclerView(context: Context) : RecyclerView(context) {
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    Trace.beginSection("MemoryRoomNativeChatLayout")
    try {
      super.onLayout(changed, left, top, right, bottom)
    } finally {
      Trace.endSection()
    }
  }
}

private class KeyEvent(@Field val key: String) : Record
private class AnchorEvent(
  @Field val key: String,
  @Field val height: Double,
  @Field val pageX: Double,
  @Field val pageY: Double,
  @Field val width: Double
) : Record
private class EmptyEvent(@Field val emittedAtMs: Double) : Record
private class VisibleRangeEvent(
  @Field val firstKey: String,
  @Field val firstPosition: Int,
  @Field val lastKey: String,
  @Field val lastPosition: Int,
  @Field val latestCreatedAt: String,
  @Field val latestSourceId: String,
  @Field val nearLatest: Boolean
) : Record
private class MetricsEvent(
  @Field val attachedCells: Int,
  @Field val boundRows: Int,
  @Field val createdCells: Int,
  @Field val pooledCells: Int,
  @Field val recycledCells: Int,
  @Field val rowCount: Int
) : Record
private class RevealStateEvent(
  @Field val alpha: Double,
  @Field val anchorAdapterPosition: Int,
  @Field val anchorType: String,
  @Field val attachedCells: Int,
  @Field val createdCells: Int,
  @Field val decoratedBottom: Int,
  @Field val decoratedTop: Int,
  @Field val event: String,
  @Field val firstVisiblePosition: Int,
  @Field val generation: Double,
  @Field val height: Int,
  @Field val lastVisiblePosition: Int,
  @Field val monotonicTimestampMs: Double,
  @Field val pooledCells: Int,
  @Field val recycledCells: Int,
  @Field val rowCount: Int,
  @Field val visibleRows: Int,
  @Field val visibleStableIds: List<String>,
  @Field val width: Int
) : Record

/**
 * Stage-1 Memory Room renderer.
 *
 * React owns the canonical message/outbox state and submits a lightweight,
 * content-safe row contract. RecyclerView owns cell creation, measurement,
 * recycling, viewport anchoring and visibility. The composer remains a sibling
 * inside KeyboardInsetView, so this view never observes draft text or the IME.
 */
class MemoryChatListView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  private val density = resources.displayMetrics.density
  private val layoutManager = LinearLayoutManager(context).apply {
    orientation = RecyclerView.VERTICAL
    stackFromEnd = true
  }
  private val adapter = MemoryChatAdapter(
    context = context,
    onLongPress = { key, height, pageX, pageY, width ->
      onMessageLongPress(AnchorEvent(key, height, pageX, pageY, width))
    },
    onPress = { onMessagePress(KeyEvent(it)) },
    onReply = { onReplySwipe(KeyEvent(it)) }
  )
  private val recyclerView = TracingMemoryChatRecyclerView(context).apply {
    alpha = 0f
    clipToPadding = false
    itemAnimator = null
    layoutManager = this@MemoryChatListView.layoutManager
    overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
    setHasFixedSize(false)
    setItemViewCacheSize(4)
    adapter = this@MemoryChatListView.adapter
    recycledViewPool.setMaxRecycledViews(TYPE_INCOMING_TEXT, 12)
    recycledViewPool.setMaxRecycledViews(TYPE_OUTGOING_TEXT, 12)
    recycledViewPool.setMaxRecycledViews(TYPE_INCOMING_REPLY, 8)
    recycledViewPool.setMaxRecycledViews(TYPE_OUTGOING_REPLY, 8)
    recycledViewPool.setMaxRecycledViews(TYPE_DATE, 4)
    recycledViewPool.setMaxRecycledViews(TYPE_UNREAD, 2)
    recycledViewPool.setMaxRecycledViews(TYPE_SYSTEM, 4)
  }

  private val onLoadNewer by EventDispatcher<EmptyEvent>()
  private val onLoadOlder by EventDispatcher<EmptyEvent>()
  private val onMessageLongPress by EventDispatcher<AnchorEvent>()
  private val onMessagePress by EventDispatcher<KeyEvent>()
  private val onMetrics by EventDispatcher<MetricsEvent>()
  private val onRevealStateChanged by EventDispatcher<RevealStateEvent>()
  private val onReplySwipe by EventDispatcher<KeyEvent>()
  private val onVisibleRangeChanged by EventDispatcher<VisibleRangeEvent>()

  private var active = false
  private var attached = false
  private var bottomClearancePx = 0
  private var topClearancePx = 0
  private var anchorGeneration = Int.MIN_VALUE
  private var pendingInitialAnchor: NativeMemoryChatAnchor? = null
  private var currentAnchor: NativeMemoryChatAnchor? = null
  private var diagnosticsEnabled = false
  private var expectedRowCount = 0
  private val revealGate = NativeMemoryChatRevealGate()
  private var revealAnchorApplied = false
  private var revealAnchorPosition = RecyclerView.NO_POSITION
  private var revealFrame = 0
  private var revealFrameRunnable: Runnable? = null
  private var revealObserver: ViewTreeObserver? = null
  private var revealPreDrawListener: ViewTreeObserver.OnPreDrawListener? = null
  private var scrollGeneration = Int.MIN_VALUE
  private var previousRowCount = 0
  private var olderRequestRowCount = -1
  private var newerRequestRowCount = -1
  private var visibilityPosted = false
  private var nearLatest = true

  init {
    addView(
      recyclerView,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    )
    recyclerView.addOnScrollListener(object : RecyclerView.OnScrollListener() {
      override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
        postVisibility()
      }

      override fun onScrollStateChanged(recyclerView: RecyclerView, newState: Int) {
        if (newState == RecyclerView.SCROLL_STATE_IDLE) postVisibility()
      }
    })
  }

  fun setActive(value: Boolean) {
    if (active == value) return
    active = value
    if (value) {
      if (recyclerView.alpha < 1f) beginRevealCycle()
      postVisibility()
    } else {
      recyclerView.alpha = 0f
      cancelRevealCycle(invalidate = true)
    }
  }

  fun setDiagnosticsEnabled(value: Boolean) {
    diagnosticsEnabled = value
    updateDiagnosticsDescription()
  }

  fun setMyUsername(value: String) {
    // Direction is already resolved in the JS row contract. Keeping this prop
    // makes the authority boundary explicit without retaining user state here.
  }

  fun setBottomClearance(value: Double) {
    val next = dp(value)
    if (next == bottomClearancePx) return
    bottomClearancePx = next
    applyPadding()
  }

  fun setTopClearance(value: Double) {
    val next = dp(value)
    if (next == topClearancePx) return
    topClearancePx = next
    applyPadding()
  }

  fun setInitialAnchor(value: NativeMemoryChatAnchor) {
    if (value.generation == anchorGeneration) return
    anchorGeneration = value.generation
    currentAnchor = value
    recyclerView.alpha = 0f
    pendingInitialAnchor = value
    beginRevealCycle()
  }

  fun setSelectedKeys(keys: List<String>) {
    adapter.setSelectedKeys(keys.toSet())
  }

  fun setRows(rows: List<NativeMemoryChatRow>) {
    Trace.beginSection("MemoryRoomNativeChatRowUpdate")
    try {
      val oldCount = adapter.itemCount
      val preserve = captureVisibleAnchor()
      previousRowCount = oldCount
      expectedRowCount = rows.size
      val hidden = recyclerView.alpha < 1f
      val rowGeneration = if (hidden) beginRevealCycle() else {
        revealGate.nextGeneration().also { cancelRevealObservation() }
      }
      emitRevealEvent(EVENT_ROWS_RECEIVED, rowGeneration)
      adapter.submitList(rows.toList()) {
        if (!revealGate.isCurrent(rowGeneration)) return@submitList
        when {
          hidden -> beginRevealCycle()
          preserve != null && !nearLatest -> restoreVisibleAnchor(preserve)
          nearLatest && rows.isNotEmpty() -> layoutManager.scrollToPosition(rows.lastIndex)
        }
        if (rows.size != oldCount) {
          olderRequestRowCount = -1
          newerRequestRowCount = -1
        }
        postVisibility()
        emitMetrics()
      }
    } finally {
      Trace.endSection()
    }
  }

  fun applyScrollCommand(command: NativeMemoryChatScrollCommand) {
    if (command.kind == "none" || command.generation == scrollGeneration) return
    scrollGeneration = command.generation
    when (command.kind) {
      "latest" -> {
        if (adapter.itemCount > 0) recyclerView.smoothScrollToPosition(adapter.itemCount - 1)
      }
      "key" -> {
        val position = adapter.currentList.indexOfFirst { it.key == command.key }
        if (position >= 0) layoutManager.scrollToPositionWithOffset(position, dp(16.0))
      }
    }
  }

  override fun onDetachedFromWindow() {
    recyclerView.stopScroll()
    attached = false
    recyclerView.alpha = 0f
    cancelRevealCycle(invalidate = true)
    super.onDetachedFromWindow()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    if (active && recyclerView.alpha < 1f) beginRevealCycle()
  }

  private fun applyPadding() {
    recyclerView.setPadding(0, topClearancePx, 0, bottomClearancePx)
  }

  private fun beginRevealCycle(): Long {
    val generation = revealGate.nextGeneration()
    cancelRevealObservation()
    recyclerView.alpha = 0f
    revealAnchorApplied = false
    revealAnchorPosition = RecyclerView.NO_POSITION
    revealFrame = 0
    if (!active || !attached) return generation

    val listener = ViewTreeObserver.OnPreDrawListener {
      if (!revealGate.isCurrent(generation) || !active || !attached) {
        removeRevealPreDrawListener()
        true
      } else {
        emitRevealEvent(EVENT_PRE_DRAW, generation)
        attemptReveal(generation, finalAttempt = false, usedFallback = false)
        true
      }
    }
    revealPreDrawListener = listener
    revealObserver = recyclerView.viewTreeObserver
    revealObserver?.addOnPreDrawListener(listener)
    emitRevealEvent(EVENT_LAYOUT_LISTENER_REGISTERED, generation)
    recyclerView.requestLayout()
    emitRevealEvent(EVENT_LAYOUT_REQUESTED, generation)
    scheduleRevealFrame(generation)
    return generation
  }

  private fun applyAnchorIfReady(generation: Long): Boolean {
    if (!revealGate.isCurrent(generation) || revealAnchorApplied) {
      return revealAnchorApplied
    }
    val anchor = currentAnchor ?: pendingInitialAnchor ?: return false
    if (
      recyclerView.width <= 0 ||
      recyclerView.height <= 0 ||
      adapter.itemCount != expectedRowCount
    ) {
      return false
    }
    if (expectedRowCount == 0) {
      revealAnchorPosition = RecyclerView.NO_POSITION
      revealAnchorApplied = true
      pendingInitialAnchor = null
      emitRevealEvent(EVENT_ANCHOR_APPLIED, generation)
      return true
    }
    if (anchor.kind == "unread") {
      val unreadKey = "unread:${anchor.key}"
      val position = adapter.currentList.indexOfFirst {
        it.key == unreadKey || it.key == anchor.key || it.sourceId == anchor.key
      }
      if (position < 0) return false
      revealAnchorPosition = position
      layoutManager.scrollToPositionWithOffset(position, dp(16.0))
      nearLatest = position >= adapter.itemCount - 2
    } else {
      revealAnchorPosition = adapter.itemCount - 1
      layoutManager.scrollToPosition(adapter.itemCount - 1)
      nearLatest = true
    }
    revealAnchorApplied = true
    pendingInitialAnchor = null
    emitRevealEvent(EVENT_ANCHOR_APPLIED, generation)
    recyclerView.requestLayout()
    emitRevealEvent(EVENT_LAYOUT_REQUESTED, generation)
    return true
  }

  private fun attemptReveal(
    generation: Long,
    finalAttempt: Boolean,
    usedFallback: Boolean
  ) {
    if (!revealGate.isCurrent(generation) || !active || !attached) return
    val boundsReady = recyclerView.width > 0 && recyclerView.height > 0
    if (boundsReady) emitRevealEvent(EVENT_BOUNDS_READY, generation)
    if (!applyAnchorIfReady(generation)) {
      finishRevealDecision(
        generation,
        finalAttempt,
        usedFallback,
        revealSnapshot(boundsReady)
      )
      return
    }
    val snapshot = revealSnapshot(boundsReady)
    if (snapshot.attachedMessageCells > 0) {
      emitRevealEvent(EVENT_CELLS_ATTACHED, generation)
    }
    finishRevealDecision(generation, finalAttempt, usedFallback, snapshot)
  }

  private fun finishRevealDecision(
    generation: Long,
    finalAttempt: Boolean,
    usedFallback: Boolean,
    snapshot: NativeMemoryChatRevealSnapshot
  ) {
    when (revealGate.evaluate(generation, finalAttempt, snapshot)) {
      NativeMemoryChatRevealDecision.REVEAL_EMPTY,
      NativeMemoryChatRevealDecision.REVEAL_ROWS -> {
        if (!revealGate.commitReveal(generation)) return
        if (usedFallback) emitRevealEvent(EVENT_REVEAL_FALLBACK, generation)
        recyclerView.alpha = 1f
        removeRevealPreDrawListener()
        revealFrameRunnable?.let(recyclerView::removeCallbacks)
        revealFrameRunnable = null
        emitRevealEvent(EVENT_REVEALED, generation)
        postVisibility()
      }
      NativeMemoryChatRevealDecision.FAIL -> {
        removeRevealPreDrawListener()
        revealFrameRunnable = null
        emitRevealEvent(EVENT_REVEAL_FAILED, generation)
      }
      NativeMemoryChatRevealDecision.STALE,
      NativeMemoryChatRevealDecision.WAIT -> Unit
    }
  }

  private fun revealSnapshot(boundsReady: Boolean): NativeMemoryChatRevealSnapshot {
    val first = layoutManager.findFirstVisibleItemPosition()
    val last = layoutManager.findLastVisibleItemPosition()
    val visible = visibleCells()
    val anchorVisible = expectedRowCount == 0 || (
      revealAnchorPosition != RecyclerView.NO_POSITION &&
        revealAnchorPosition in first..last &&
        visible.positions.contains(revealAnchorPosition)
      )
    return NativeMemoryChatRevealSnapshot(
      adapterRows = adapter.itemCount,
      anchorApplied = revealAnchorApplied,
      anchorVisible = anchorVisible,
      attachedMessageCells = visible.messageCount,
      boundsReady = boundsReady,
      expectedRows = expectedRowCount,
      firstVisiblePosition = first,
      lastVisiblePosition = last,
      visibleCellInsideViewport = visible.count > 0
    )
  }

  private data class VisibleCells(
    val count: Int,
    val messageCount: Int,
    val positions: Set<Int>
  )

  private fun visibleCells(): VisibleCells {
    var count = 0
    var messageCount = 0
    val positions = mutableSetOf<Int>()
    val viewportTop = recyclerView.paddingTop
    val viewportBottom = recyclerView.height - recyclerView.paddingBottom
    for (index in 0 until recyclerView.childCount) {
      val child = recyclerView.getChildAt(index)
      val position = recyclerView.getChildAdapterPosition(child)
      if (position == RecyclerView.NO_POSITION) continue
      val top = layoutManager.getDecoratedTop(child)
      val bottom = layoutManager.getDecoratedBottom(child)
      if (bottom <= viewportTop || top >= viewportBottom) continue
      count += 1
      positions += position
      if (adapter.currentList.getOrNull(position)?.sourceType == "message") {
        messageCount += 1
      }
    }
    return VisibleCells(count, messageCount, positions)
  }

  private fun scheduleRevealFrame(generation: Long) {
    val runnable = Runnable {
      if (!revealGate.isCurrent(generation) || !active || !attached) return@Runnable
      revealFrame += 1
      val finalAttempt = revealFrame >= MAX_REVEAL_FRAMES
      attemptReveal(generation, finalAttempt, usedFallback = revealFrame > 1)
      if (
        recyclerView.alpha < 1f &&
        !finalAttempt &&
        revealGate.isCurrent(generation)
      ) {
        scheduleRevealFrame(generation)
      }
    }
    revealFrameRunnable = runnable
    recyclerView.postOnAnimation(runnable)
  }

  private fun cancelRevealCycle(invalidate: Boolean) {
    cancelRevealObservation()
    if (invalidate) revealGate.invalidate()
  }

  private fun cancelRevealObservation() {
    removeRevealPreDrawListener()
    revealFrameRunnable?.let(recyclerView::removeCallbacks)
    revealFrameRunnable = null
  }

  private fun removeRevealPreDrawListener() {
    val listener = revealPreDrawListener ?: return
    val observer = revealObserver
    if (observer?.isAlive == true) observer.removeOnPreDrawListener(listener)
    revealPreDrawListener = null
    revealObserver = null
  }

  private fun emitRevealEvent(event: String, generation: Long) {
    if (diagnosticsEnabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      Trace.setCounter(event, 1)
      Trace.setCounter("NATIVE_CHAT_REVEAL_GENERATION", generation)
    }
    val first = layoutManager.findFirstVisibleItemPosition()
    val last = layoutManager.findLastVisibleItemPosition()
    val visible = visibleCells()
    val firstView = layoutManager.findViewByPosition(first)
    val lastView = layoutManager.findViewByPosition(last)
    onRevealStateChanged(
      RevealStateEvent(
        alpha = recyclerView.alpha.toDouble(),
        anchorAdapterPosition = revealAnchorPosition,
        anchorType = (currentAnchor ?: pendingInitialAnchor)?.kind.orEmpty(),
        attachedCells = recyclerView.childCount,
        createdCells = adapter.createdCells,
        decoratedBottom = lastView?.let(layoutManager::getDecoratedBottom) ?: -1,
        decoratedTop = firstView?.let(layoutManager::getDecoratedTop) ?: -1,
        event = event,
        firstVisiblePosition = first,
        generation = generation.toDouble(),
        height = recyclerView.height,
        lastVisiblePosition = last,
        monotonicTimestampMs = SystemClock.elapsedRealtime().toDouble(),
        pooledCells = pooledCellCount(),
        recycledCells = adapter.recycledCells,
        rowCount = adapter.itemCount,
        visibleRows = visible.count,
        visibleStableIds = visible.positions.sorted().mapNotNull { position ->
          adapter.currentList.getOrNull(position)?.key?.let {
            java.lang.Long.toUnsignedString(nativeMemoryChatStableId(it))
          }
        },
        width = recyclerView.width
      )
    )
    updateDiagnosticsDescription()
  }

  private fun updateDiagnosticsDescription() {
    recyclerView.contentDescription = if (diagnosticsEnabled) {
      val first = layoutManager.findFirstVisibleItemPosition()
      val last = layoutManager.findLastVisibleItemPosition()
      val visible = visibleCells().count
      "Memory Chat list; alpha=${recyclerView.alpha}; rows=${adapter.itemCount}; " +
        "visible=$visible; first=$first; last=$last; anchor=${currentAnchor?.kind.orEmpty()}; " +
        "anchorPosition=$revealAnchorPosition"
    } else {
      null
    }
  }

  private data class VisibleAnchor(val key: String, val top: Int)

  private fun captureVisibleAnchor(): VisibleAnchor? {
    if (pendingInitialAnchor != null || adapter.itemCount == 0) return null
    val position = layoutManager.findFirstVisibleItemPosition()
    if (position == RecyclerView.NO_POSITION) return null
    val view = layoutManager.findViewByPosition(position) ?: return null
    val key = adapter.currentList.getOrNull(position)?.key ?: return null
    return VisibleAnchor(key, layoutManager.getDecoratedTop(view))
  }

  private fun restoreVisibleAnchor(anchor: VisibleAnchor) {
    val position = adapter.currentList.indexOfFirst { it.key == anchor.key }
    if (position >= 0) layoutManager.scrollToPositionWithOffset(position, anchor.top)
  }

  private fun postVisibility() {
    if (!active || visibilityPosted) return
    visibilityPosted = true
    recyclerView.post {
      visibilityPosted = false
      emitVisibility()
    }
  }

  private fun emitVisibility() {
    if (!active || adapter.itemCount == 0) return
    val first = layoutManager.findFirstVisibleItemPosition()
    val last = layoutManager.findLastVisibleItemPosition()
    if (first == RecyclerView.NO_POSITION || last == RecyclerView.NO_POSITION) return
    nearLatest = last >= adapter.itemCount - 2
    val firstRow = adapter.currentList[first]
    val lastRow = adapter.currentList[last]
    var latestCreatedAt = ""
    var latestSourceId = ""
    for (position in last downTo first) {
      val row = adapter.currentList[position]
      if (row.sourceType == "message" && parseInstant(row.createdAt) != null) {
        latestCreatedAt = row.createdAt
        latestSourceId = row.sourceId
        break
      }
    }
    onVisibleRangeChanged(
      VisibleRangeEvent(
        firstKey = firstRow.key,
        firstPosition = first,
        lastKey = lastRow.key,
        lastPosition = last,
        latestCreatedAt = latestCreatedAt,
        latestSourceId = latestSourceId,
        nearLatest = nearLatest
      )
    )
    recordTraceCounters()
    if (first <= 4 && olderRequestRowCount != adapter.itemCount) {
      olderRequestRowCount = adapter.itemCount
      onLoadOlder(EmptyEvent(SystemClock.elapsedRealtime().toDouble()))
    }
    if (last >= adapter.itemCount - 5 && !nearLatest && newerRequestRowCount != adapter.itemCount) {
      newerRequestRowCount = adapter.itemCount
      onLoadNewer(EmptyEvent(SystemClock.elapsedRealtime().toDouble()))
    }
  }

  private fun emitMetrics() {
    val pooled = pooledCellCount()
    recordTraceCounters(pooled)
    onMetrics(
      MetricsEvent(
        attachedCells = recyclerView.childCount,
        boundRows = adapter.boundRows,
        createdCells = adapter.createdCells,
        pooledCells = pooled,
        recycledCells = adapter.recycledCells,
        rowCount = adapter.itemCount
      )
    )
  }

  private fun pooledCellCount(): Int {
    var pooled = 0
    for (type in TYPE_INCOMING_TEXT..TYPE_SYSTEM) {
      pooled += recyclerView.recycledViewPool.getRecycledViewCount(type)
    }
    return pooled
  }

  private fun recordTraceCounters(pooledCells: Int = pooledCellCount()) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    Trace.setCounter("MemoryRoomNativeChatAttachedCells", recyclerView.childCount.toLong())
    Trace.setCounter("MemoryRoomNativeChatBoundRows", adapter.boundRows.toLong())
    Trace.setCounter("MemoryRoomNativeChatCreatedCells", adapter.createdCells.toLong())
    Trace.setCounter("MemoryRoomNativeChatPooledCells", pooledCells.toLong())
    Trace.setCounter("MemoryRoomNativeChatRecycledCells", adapter.recycledCells.toLong())
    Trace.setCounter("MemoryRoomNativeChatRowCount", adapter.itemCount.toLong())
  }

  private fun dp(value: Double) = (value * density).roundToInt()
  private fun parseInstant(value: String): Instant? = try {
    Instant.parse(value)
  } catch (_: Throwable) {
    null
  }
}

private class MemoryChatAdapter(
  private val context: Context,
  private val onLongPress: (String, Double, Double, Double, Double) -> Unit,
  private val onPress: (String) -> Unit,
  private val onReply: (String) -> Unit
) : ListAdapter<NativeMemoryChatRow, RecyclerView.ViewHolder>(ROW_DIFF) {
  var boundRows = 0
    private set
  var createdCells = 0
    private set
  var recycledCells = 0
    private set
  private var selectedKeys: Set<String> = emptySet()

  init {
    setHasStableIds(true)
  }

  fun setSelectedKeys(keys: Set<String>) {
    if (keys == selectedKeys) return
    val previous = selectedKeys
    selectedKeys = keys
    (previous + keys).forEach { key ->
      val position = currentList.indexOfFirst { it.key == key }
      if (position >= 0) notifyItemChanged(position, "selection")
    }
  }

  override fun getItemId(position: Int): Long =
    nativeMemoryChatStableId(getItem(position).key)

  override fun getItemViewType(position: Int): Int = when (getItem(position).itemType) {
    "incoming-text" -> TYPE_INCOMING_TEXT
    "outgoing-text" -> TYPE_OUTGOING_TEXT
    "incoming-reply-text" -> TYPE_INCOMING_REPLY
    "outgoing-reply-text" -> TYPE_OUTGOING_REPLY
    "date" -> TYPE_DATE
    "unread" -> TYPE_UNREAD
    else -> TYPE_SYSTEM
  }

  override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
    createdCells++
    return if (viewType >= TYPE_DATE) {
      SystemRowHolder(SystemRowView(context))
    } else {
      MessageRowHolder(
        MessageRowView(context),
        onLongPress,
        onPress,
        onReply
      )
    }
  }

  override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
    boundRows++
    bind(holder, getItem(position))
  }

  override fun onBindViewHolder(
    holder: RecyclerView.ViewHolder,
    position: Int,
    payloads: MutableList<Any>
  ) {
    boundRows++
    bind(holder, getItem(position))
  }

  private fun bind(holder: RecyclerView.ViewHolder, row: NativeMemoryChatRow) {
    val selected = selectedKeys.contains(row.key)
    when (holder) {
      is MessageRowHolder -> holder.bind(row, selected)
      is SystemRowHolder -> holder.bind(row)
    }
  }

  override fun onViewRecycled(holder: RecyclerView.ViewHolder) {
    recycledCells++
    when (holder) {
      is MessageRowHolder -> holder.reset()
      is SystemRowHolder -> holder.reset()
    }
    super.onViewRecycled(holder)
  }

  companion object {
    private val ROW_DIFF = object : DiffUtil.ItemCallback<NativeMemoryChatRow>() {
      override fun areItemsTheSame(
        oldItem: NativeMemoryChatRow,
        newItem: NativeMemoryChatRow
      ) = oldItem.key == newItem.key

      override fun areContentsTheSame(
        oldItem: NativeMemoryChatRow,
        newItem: NativeMemoryChatRow
      ) = nativeMemoryChatFingerprint(oldItem) ==
        nativeMemoryChatFingerprint(newItem)
    }
  }
}

private class MessageRowHolder(
  private val rowView: MessageRowView,
  private val onLongPress: (String, Double, Double, Double, Double) -> Unit,
  private val onPress: (String) -> Unit,
  private val onReply: (String) -> Unit
) : RecyclerView.ViewHolder(rowView) {
  private val reusableState = NativeMemoryChatReusableState()
  private var key = ""
  private var downX = 0f
  private var downY = 0f
  private var replyEligible = false

  init {
    rowView.setOnClickListener { if (key.isNotEmpty()) onPress(key) }
    rowView.setOnLongClickListener {
      if (key.isNotEmpty()) {
        val location = IntArray(2)
        val density = rowView.resources.displayMetrics.density.toDouble()
        rowView.getLocationOnScreen(location)
        onLongPress(
          key,
          rowView.height / density,
          location[0] / density,
          location[1] / density,
          rowView.width / density
        )
      }
      key.isNotEmpty()
    }
    rowView.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.x
          downY = event.y
          replyEligible = true
        }
        MotionEvent.ACTION_MOVE -> {
          if (abs(event.y - downY) > rowView.dp(28.0)) replyEligible = false
        }
        MotionEvent.ACTION_UP -> {
          if (replyEligible && event.x - downX > rowView.dp(56.0) && key.isNotEmpty()) {
            onReply(key)
          }
          replyEligible = false
        }
        MotionEvent.ACTION_CANCEL -> replyEligible = false
      }
      false
    }
  }

  fun bind(row: NativeMemoryChatRow, selected: Boolean) {
    reset()
    reusableState.bind(row, selected)
    key = row.key
    rowView.bind(row, selected)
  }

  fun reset() {
    reusableState.reset()
    key = ""
    replyEligible = false
    rowView.reset()
  }
}

private class SystemRowHolder(private val rowView: SystemRowView) :
  RecyclerView.ViewHolder(rowView) {
  fun bind(row: NativeMemoryChatRow) {
    reset()
    rowView.bind(row)
  }
  fun reset() = rowView.reset()
}

private class MessageRowView(context: Context) : FrameLayout(context) {
  private val density = resources.displayMetrics.density
  private val avatar = TextView(context)
  private val bubble = BoundedLinearLayout(context)
  private val sender = TextView(context)
  private val reply = TextView(context)
  private val textLine = LinearLayout(context)
  private val body = TextView(context)
  private val timestamp = TextView(context)
  private val delivery = TextView(context)

  init {
    isClickable = true
    isLongClickable = true
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    setPadding(dp(10.0), 0, dp(10.0), 0)

    avatar.apply {
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
      typeface = font(Typeface.BOLD)
      background = CircleDrawable(ACCENT)
      visibility = GONE
    }
    addView(avatar, LayoutParams(dp(28.0), dp(28.0)))

    bubble.orientation = LinearLayout.VERTICAL
    bubble.setPadding(dp(12.0), dp(7.0), dp(10.0), dp(6.0))
    addView(bubble, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))

    sender.apply {
      setTextColor(ACCENT)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      typeface = font(Typeface.BOLD)
      visibility = GONE
    }
    bubble.addView(sender)

    reply.apply {
      setBackgroundColor(0x1A9A572D)
      setPadding(dp(8.0), dp(5.0), dp(8.0), dp(5.0))
      setTextColor(TEXT_MUTED)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      maxLines = 3
      visibility = GONE
    }
    bubble.addView(
      reply,
      LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
        bottomMargin = dp(4.0)
      }
    )

    textLine.orientation = LinearLayout.HORIZONTAL
    textLine.gravity = Gravity.BOTTOM
    bubble.addView(textLine)
    body.apply {
      setTextColor(TEXT_PRIMARY)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = font(Typeface.NORMAL)
      setLineSpacing(0f, 1.08f)
    }
    textLine.addView(body, LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    timestamp.apply {
      setTextColor(TEXT_MUTED)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
      typeface = font(Typeface.NORMAL)
      setPadding(dp(7.0), 0, 0, dp(1.0))
      gravity = Gravity.BOTTOM
    }
    textLine.addView(timestamp)

    delivery.apply {
      setTextColor(0xFFB53B31.toInt())
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      typeface = font(Typeface.BOLD)
      text = "Not sent   Retry   Cancel"
      visibility = GONE
    }
    addView(delivery, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
  }

  fun bind(row: NativeMemoryChatRow, selected: Boolean) {
    val mine = row.direction == "outgoing"
    contentDescription = row.accessibilityLabel
    body.text = row.body
    timestamp.text = row.timestampLabel
    sender.text = row.senderLabel
    sender.visibility = if (!mine && row.grouping.showSender) VISIBLE else GONE
    avatar.text = row.senderLabel.trim().take(1).uppercase()
    avatar.visibility = if (!mine && row.grouping.showTail) VISIBLE else GONE
    val preview = row.replyPreview
    if (preview != null) {
      reply.text = "${preview.authorLabel}\n${preview.body}"
      reply.visibility = VISIBLE
    }
    delivery.visibility = if (
      row.deliveryState == "failed" ||
      row.deliveryState == "processing_failed" ||
      row.deliveryState == "rejected"
    ) VISIBLE else GONE
    bubble.background = BubbleDrawable(
      color = if (mine) OUTGOING_BUBBLE else INCOMING_BUBBLE,
      mine = mine,
      selected = selected,
      showTail = row.grouping.showTail
    )

    val bubbleParams = bubble.layoutParams as LayoutParams
    bubbleParams.gravity = if (mine) Gravity.END else Gravity.START
    bubbleParams.leftMargin = if (mine) dp(42.0) else dp(34.0)
    bubbleParams.rightMargin = if (mine) 0 else dp(42.0)
    bubbleParams.topMargin = if (row.grouping.spacing == "grouped") dp(1.5) else dp(6.0)
    bubble.layoutParams = bubbleParams
    bubble.maximumWidthPx = (resources.displayMetrics.widthPixels * 0.79).roundToInt()

    val avatarParams = avatar.layoutParams as LayoutParams
    avatarParams.gravity = Gravity.START or Gravity.BOTTOM
    avatarParams.leftMargin = 0
    avatarParams.bottomMargin = if (delivery.visibility == VISIBLE) dp(28.0) else 0
    avatar.layoutParams = avatarParams

    val deliveryParams = delivery.layoutParams as LayoutParams
    deliveryParams.gravity = Gravity.END or Gravity.BOTTOM
    deliveryParams.topMargin = 0
    deliveryParams.rightMargin = dp(8.0)
    delivery.layoutParams = deliveryParams

    val bottom = if (delivery.visibility == VISIBLE) dp(26.0) else 0
    setPadding(paddingLeft, paddingTop, paddingRight, bottom)
  }

  fun reset() {
    contentDescription = null
    body.text = ""
    timestamp.text = ""
    sender.text = ""
    sender.visibility = GONE
    reply.text = ""
    reply.visibility = GONE
    avatar.text = ""
    avatar.visibility = GONE
    delivery.visibility = GONE
    bubble.background = null
    setPadding(dp(10.0), 0, dp(10.0), 0)
  }

  fun dp(value: Double) = (value * density).roundToInt()

  private fun font(style: Int) = try {
    ReactFontManager.getInstance().getTypeface("DMSans_400Regular", style, context.assets)
  } catch (_: Throwable) {
    Typeface.create("sans-serif", style)
  }
}

private class BoundedLinearLayout(context: Context) : LinearLayout(context) {
  var maximumWidthPx: Int = Int.MAX_VALUE

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val proposed = MeasureSpec.getSize(widthMeasureSpec)
    val mode = MeasureSpec.getMode(widthMeasureSpec)
    val bounded = minOf(proposed, maximumWidthPx)
    val boundedSpec = MeasureSpec.makeMeasureSpec(
      bounded,
      if (mode == MeasureSpec.UNSPECIFIED) MeasureSpec.AT_MOST else mode
    )
    super.onMeasure(boundedSpec, heightMeasureSpec)
  }
}

private class SystemRowView(context: Context) : FrameLayout(context) {
  private val density = resources.displayMetrics.density
  private val label = TextView(context).apply {
    gravity = Gravity.CENTER
    setTextColor(TEXT_MUTED)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
    setPadding(dp(12.0), dp(5.0), dp(12.0), dp(5.0))
  }

  init {
    setPadding(dp(12.0), dp(7.0), dp(12.0), dp(7.0))
    addView(label, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER))
  }

  fun bind(row: NativeMemoryChatRow) {
    label.text = row.body
    contentDescription = row.accessibilityLabel
    if (row.itemType == "unread") {
      label.setTextColor(ACCENT)
      label.typeface = Typeface.DEFAULT_BOLD
      label.background = DividerDrawable(ACCENT)
    } else {
      label.setTextColor(TEXT_MUTED)
      label.typeface = Typeface.DEFAULT
      label.background = null
    }
  }

  fun reset() {
    label.text = ""
    label.background = null
    label.typeface = Typeface.DEFAULT
    contentDescription = null
  }

  private fun dp(value: Double) = (value * density).roundToInt()
}

private class BubbleDrawable(
  private val color: Int,
  private val mine: Boolean,
  private val selected: Boolean,
  private val showTail: Boolean
) : Drawable() {
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = PANEL_BORDER
    style = Paint.Style.STROKE
    strokeWidth = 1f
  }
  private val path = Path()

  override fun draw(canvas: Canvas) {
    val b = bounds
    val radius = 16f
    fill.color = color
    fill.style = Paint.Style.FILL
    val left = if (!mine && showTail) b.left + 7f else b.left.toFloat()
    val right = if (mine && showTail) b.right - 7f else b.right.toFloat()
    val rect = RectF(left, b.top.toFloat(), right, b.bottom.toFloat())
    canvas.drawRoundRect(rect, radius, radius, fill)
    canvas.drawRoundRect(rect, radius, radius, stroke)
    if (showTail) {
      path.reset()
      if (mine) {
        path.moveTo(right - 2f, b.bottom - 14f)
        path.lineTo(b.right.toFloat(), b.bottom.toFloat())
        path.lineTo(right - 10f, b.bottom - 3f)
      } else {
        path.moveTo(left + 2f, b.bottom - 14f)
        path.lineTo(b.left.toFloat(), b.bottom.toFloat())
        path.lineTo(left + 10f, b.bottom - 3f)
      }
      path.close()
      canvas.drawPath(path, fill)
      canvas.drawPath(path, stroke)
    }
    if (selected) {
      fill.color = SELECTED
      canvas.drawRoundRect(rect, radius, radius, fill)
    }
  }

  override fun setAlpha(alpha: Int) {
    fill.alpha = alpha
  }
  override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) {
    fill.colorFilter = colorFilter
  }
  @Deprecated("Deprecated in Java")
  override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
}

private class CircleDrawable(private val color: Int) : Drawable() {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = this@CircleDrawable.color }
  override fun draw(canvas: Canvas) {
    canvas.drawCircle(bounds.exactCenterX(), bounds.exactCenterY(), minOf(bounds.width(), bounds.height()) / 2f, paint)
  }
  override fun setAlpha(alpha: Int) { paint.alpha = alpha }
  override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) { paint.colorFilter = colorFilter }
  @Deprecated("Deprecated in Java")
  override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
}

private class DividerDrawable(private val color: Int) : Drawable() {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = this@DividerDrawable.color
    strokeWidth = 1f
  }
  override fun draw(canvas: Canvas) {
    val y = bounds.exactCenterY()
    canvas.drawLine(bounds.left.toFloat(), y, bounds.right.toFloat(), y, paint)
  }
  override fun setAlpha(alpha: Int) { paint.alpha = alpha }
  override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) { paint.colorFilter = colorFilter }
  @Deprecated("Deprecated in Java")
  override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
}
