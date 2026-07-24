import ExpoModulesCore

// iOS passthrough. iOS keyboard animations are predictable (a single willShow
// curve), so the chat surface keeps using the JS driven-height (park) transform
// there. This view simply hosts its children with no keyboard behaviour, so the
// same JSX can render on both platforms.
class KeyboardInsetView: ExpoView {}
