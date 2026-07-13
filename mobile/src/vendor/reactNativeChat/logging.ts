// @ts-nocheck
const styleString = (color: string) => `color: ${color}; font-weight: bold`
const headerLog = '%c[@kesha-antonov/react-native-chat]'

export const warning = (...args: unknown[]) =>
  { if (__DEV__) console.log(headerLog, styleString('orange'), ...args) }

export const error = (...args: unknown[]) =>
  { if (__DEV__) console.log(headerLog, styleString('red'), ...args) }
