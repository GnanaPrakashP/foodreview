// @ts-nocheck
import { createContext, useContext } from 'react'
import { ColorSchemeName } from 'react-native'
import { ActionSheetOptions } from './ActionSheetShim'

export interface IChatContext {
  actionSheet(): {
    showActionSheetWithOptions: (
      options: ActionSheetOptions,
      callback: (buttonIndex?: number) => void | Promise<void>
    ) => void
  }
  getLocale(): string
  getColorScheme(): ColorSchemeName | null | undefined
}

export const ChatContext = createContext<IChatContext>({
  getLocale: () => 'en',
  actionSheet: () => ({
    showActionSheetWithOptions: () => {},
  }),
  getColorScheme: () => null,
})

export const useChatContext = () => useContext(ChatContext)
