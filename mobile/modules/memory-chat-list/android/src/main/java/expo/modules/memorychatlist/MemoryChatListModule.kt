package expo.modules.memorychatlist

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MemoryChatListModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MemoryChatList")

    View(MemoryChatListView::class) {
      Events(
        "onLoadNewer",
        "onLoadOlder",
        "onMessageLongPress",
        "onMessagePress",
        "onMetrics",
        "onRevealStateChanged",
        "onReplySwipe",
        "onVisibleRangeChanged"
      )

      Prop("active") { view, value: Boolean -> view.setActive(value) }
      Prop("bottomClearance") { view, value: Double -> view.setBottomClearance(value) }
      Prop("diagnosticsEnabled") { view, value: Boolean -> view.setDiagnosticsEnabled(value) }
      Prop("initialAnchor") { view, value: NativeMemoryChatAnchor -> view.setInitialAnchor(value) }
      Prop("myUsername") { view, value: String -> view.setMyUsername(value) }
      Prop("rows") { view, value: List<NativeMemoryChatRow> -> view.setRows(value) }
      Prop("scrollCommand") { view, value: NativeMemoryChatScrollCommand -> view.applyScrollCommand(value) }
      Prop("selectedKeys") { view, value: List<String> -> view.setSelectedKeys(value) }
      Prop("topClearance") { view, value: Double -> view.setTopClearance(value) }
      Prop("warmWhileInactive") { view, value: Boolean -> view.setWarmWhileInactive(value) }
    }
  }
}
