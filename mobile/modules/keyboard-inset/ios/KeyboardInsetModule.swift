import ExpoModulesCore

public class KeyboardInsetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KeyboardInset")

    View(KeyboardInsetView.self) {
      // Props are accepted but ignored on iOS (passthrough). Keeping them keeps
      // the JS component identical across platforms.
      Prop("active") { (_: KeyboardInsetView, _: Bool) in }
      Prop("closedGap") { (_: KeyboardInsetView, _: Double) in }
      Prop("openGap") { (_: KeyboardInsetView, _: Double) in }
      Prop("debug") { (_: KeyboardInsetView, _: Bool) in }
    }
  }
}
