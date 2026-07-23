import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const reactNativeRoot = join(process.cwd(), "node_modules", "react-native", "ReactAndroid", "src", "main", "java");

const replacements = [
  {
    path: join(reactNativeRoot, "com/facebook/react/uimanager/JSTouchDispatcher.kt"),
    from: `  public fun onChildStartedNativeGesture(
      androidEvent: MotionEvent,
      eventDispatcher: EventDispatcher
  ) {
    if (childIsHandlingNativeGesture) {
      // This means we previously had another child start handling this native gesture and now a
      // different native parent of that child has decided to intercept the touch stream and handle
      // the gesture itself. Example where this can happen: HorizontalScrollView in a ScrollView.
      return
    }

    dispatchCancelEvent(androidEvent, eventDispatcher)
    childIsHandlingNativeGesture = true
    targetTag = -1
  }
`,
    to: `  public fun onChildStartedNativeGesture(
      androidEvent: MotionEvent,
      eventDispatcher: EventDispatcher
  ) {
    onChildStartedNativeGesture(androidEvent, eventDispatcher, null)
  }

  public fun onChildStartedNativeGesture(
      androidEvent: MotionEvent,
      eventDispatcher: EventDispatcher,
      reactContext: ReactContext?
  ) {
    if (childIsHandlingNativeGesture) {
      // This means we previously had another child start handling this native gesture and now a
      // different native parent of that child has decided to intercept the touch stream and handle
      // the gesture itself. Example where this can happen: HorizontalScrollView in a ScrollView.
      return
    }

    dispatchCancelEvent(androidEvent, eventDispatcher)
    childIsHandlingNativeGesture = true

    // A native scrolling child consumes the remaining gesture events. Sweep the
    // Fabric active-touch tag before clearing it, otherwise removed views wait
    // forever in SurfaceMountingManager.mViewsToDeleteAfterTouchFinishes.
    if (targetTag != -1) {
      val surfaceId = UIManagerHelper.getSurfaceId(viewGroup)
      sweepActiveTouchForTag(surfaceId, targetTag, reactContext)
    }

    targetTag = -1
  }
`
  },
  {
    path: join(reactNativeRoot, "com/facebook/react/runtime/ReactSurfaceView.kt"),
    from: `    jsTouchDispatcher.onChildStartedNativeGesture(ev, eventDispatcher)
`,
    to: `    jsTouchDispatcher.onChildStartedNativeGesture(
        ev, eventDispatcher, surface.reactHost?.currentReactContext)
`
  },
  {
    path: join(reactNativeRoot, "com/facebook/react/ReactRootView.java"),
    from: `      mJSTouchDispatcher.onChildStartedNativeGesture(ev, eventDispatcher);
`,
    to: `      mJSTouchDispatcher.onChildStartedNativeGesture(
          ev, eventDispatcher, getCurrentReactContext());
`
  },
  {
    path: join(reactNativeRoot, "com/facebook/react/views/modal/ReactModalHostView.kt"),
    from: `        jSTouchDispatcher.onChildStartedNativeGesture(ev, eventDispatcher)
`,
    to: `        jSTouchDispatcher.onChildStartedNativeGesture(ev, eventDispatcher, reactContext)
`
  }
];

for (const replacement of replacements) {
  let source = readFileSync(replacement.path, "utf8");

  if (source.includes(replacement.to)) continue;
  if (!source.includes(replacement.from)) {
    throw new Error(
      `[patch-react-native-active-touch-cleanup] Expected source was not found in ${replacement.path}. ` +
        "Review the upstream React Native implementation before changing versions."
    );
  }

  source = source.replace(replacement.from, replacement.to);
  writeFileSync(replacement.path, source);
}

// A React Native composite build is its own Gradle root, so Android's SDK
// lookup does not inherit mobile/android/local.properties. Mirror the local
// developer setting when it exists; hosted builders use ANDROID_HOME instead.
const appLocalProperties = join(process.cwd(), "android", "local.properties");
const reactNativeLocalProperties = join(process.cwd(), "node_modules", "react-native", "local.properties");
if (existsSync(appLocalProperties)) {
  writeFileSync(reactNativeLocalProperties, readFileSync(appLocalProperties, "utf8"));
}

console.log("[patch-react-native-active-touch-cleanup] applied Fabric native-gesture cleanup backport.");
