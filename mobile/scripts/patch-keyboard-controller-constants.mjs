import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const replacements = [
  {
    path: join(root, "node_modules/react-native-keyboard-controller/src/constants.ts"),
    from: `export const KEYBOARD_BORDER_RADIUS =
  KeyboardControllerNative.getConstants().keyboardBorderRadius;
`,
    to: `type KeyboardControllerConstants = {
  keyboardBorderRadius?: number;
};

const getKeyboardControllerConstants = (): KeyboardControllerConstants => {
  const native = KeyboardControllerNative as typeof KeyboardControllerNative &
    KeyboardControllerConstants & {
      getConstants?: () => KeyboardControllerConstants;
    };

  return typeof native.getConstants === "function" ? native.getConstants() : native;
};

export const KEYBOARD_BORDER_RADIUS =
  getKeyboardControllerConstants().keyboardBorderRadius ?? 0;
`,
  },
  {
    path: join(root, "node_modules/react-native-keyboard-controller/lib/module/constants.js"),
    from: `export const KEYBOARD_BORDER_RADIUS = KeyboardControllerNative.getConstants().keyboardBorderRadius;`,
    to: `const getKeyboardControllerConstants = () => typeof KeyboardControllerNative.getConstants === "function" ? KeyboardControllerNative.getConstants() : KeyboardControllerNative;
export const KEYBOARD_BORDER_RADIUS = getKeyboardControllerConstants().keyboardBorderRadius ?? 0;`,
  },
  {
    path: join(root, "node_modules/react-native-keyboard-controller/lib/commonjs/constants.js"),
    from: `const KEYBOARD_BORDER_RADIUS = exports.KEYBOARD_BORDER_RADIUS = _bindings.KeyboardControllerNative.getConstants().keyboardBorderRadius;`,
    to: `const getKeyboardControllerConstants = () => typeof _bindings.KeyboardControllerNative.getConstants === "function" ? _bindings.KeyboardControllerNative.getConstants() : _bindings.KeyboardControllerNative;
const KEYBOARD_BORDER_RADIUS = exports.KEYBOARD_BORDER_RADIUS = getKeyboardControllerConstants().keyboardBorderRadius ?? 0;`,
  },
];

for (const replacement of replacements) {
  let content = readFileSync(replacement.path, "utf8");

  if (content.includes(replacement.to)) {
    continue;
  }

  if (!content.includes(replacement.from)) {
    throw new Error(`Could not patch ${replacement.path}: expected text was not found`);
  }

  content = content.replace(replacement.from, replacement.to);
  writeFileSync(replacement.path, content);
}

console.log("Patched react-native-keyboard-controller constants compatibility.");
