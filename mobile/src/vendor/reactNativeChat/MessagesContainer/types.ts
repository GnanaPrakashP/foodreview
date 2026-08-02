// @ts-nocheck
import { RefObject } from 'react'
import {
  FlatList,
  FlatListProps,
  StyleProp,
  ViewStyle,
} from 'react-native'
import Animated, { ScrollEvent } from 'react-native-reanimated'

import { DayProps } from '../Day'
import { LoadEarlierMessagesProps } from '../LoadEarlierMessages'
import { MessageProps } from '../Message'
import { User, IMessage, Reply } from '../Models'
import { ReactionsProps } from '../Reactions'
import { ReplyProps } from '../Reply'
import { TypingIndicatorProps } from '../TypingIndicator/types'

/** Animated FlatList backed by React Native's native vertical scroll view. */
const RNAnimatedFlatList = Animated.createAnimatedComponent(FlatList)

/**
 * Typed AnimatedFlatList component that preserves generic type parameter.
 */
export const AnimatedFlatList = RNAnimatedFlatList as <TMessage>(
  props: FlatListProps<TMessage> & {
    ref?: RefObject<FlatList<TMessage>>
  }
) => React.ReactElement

export type AnimatedListProps<TMessage extends IMessage = IMessage> = Partial<
  Omit<FlatListProps<TMessage>, 'onScroll'> & {
    onScroll?: (event: ScrollEvent) => void
  }
>

export type AnimatedList<TMessage> = FlatList<TMessage>

/**
 * Which list engine backs the message list. FlatList mounts and unmounts rows;
 * FlashList recycles them, which is the point — a fling profile on a populated
 * room put the cost in per-row mount work (Fabric host-node creation and React
 * reconcile), and recycling is what removes it rather than trimming it.
 */
export type MessagesContainerListEngine = 'flatlist' | 'flashlist'

/**
 * listProps is FlatList-shaped, so these have to be dropped before they reach
 * FlashList: FlashList either does not accept them or reads them differently.
 * Virtualization tuning has no FlashList equivalent at all (it uses a pixel
 * drawDistance instead of item batches and windows), and
 * maintainVisibleContentPosition takes a different shape, so it is translated
 * separately rather than forwarded.
 */
export const FLATLIST_ONLY_LIST_PROPS = [
  'initialNumToRender',
  'maxToRenderPerBatch',
  'windowSize',
  'updateCellsBatchingPeriod',
  'removeClippedSubviews',
  'onScrollToIndexFailed',
  'maintainVisibleContentPosition',
  'getItemLayout',
] as const

export interface MessagesContainerProps<TMessage extends IMessage = IMessage>
  extends Omit<TypingIndicatorProps, 'style'> {
  /** Defaults to 'flatlist' so existing hosts are untouched. */
  listEngine?: MessagesContainerListEngine
  /**
   * FlashList only, and effectively required when it is used: FlashList reuses
   * a row instance for the next item of the SAME type, so anything whose
   * subtree differs in shape (media, audio, a dish card, a system row) must
   * report a distinct type or it will be recycled into a mismatched tree.
   */
  getItemType?: (item: TMessage, index: number) => string | number
  /** FlashList-specific props, e.g. drawDistance. Ignored by FlatList. */
  flashListProps?: Record<string, unknown>
  /** Ref for the FlatList message container */
  forwardRef?: RefObject<AnimatedList<TMessage>>
  /** Messages to display */
  messages?: TMessage[]
  /** Format to use for rendering dates; default is 'll' */
  dateFormat?: string
  /** Format to use for rendering relative times */
  dateFormatCalendar?: object
  /** User sending the messages: { _id, name, avatar } */
  user?: User
  /** Additional props for FlatList */
  listProps?: AnimatedListProps<TMessage>
  /** Reverses display order of messages; default is true */
  isInverted?: boolean
  /** Controls whether or not the message bubbles appear at the top of the chat */
  isAlignedTop?: boolean
  /** Enables the isScrollToBottomEnabled Component */
  isScrollToBottomEnabled?: boolean
  /** Scroll to bottom wrapper style */
  scrollToBottomStyle?: StyleProp<ViewStyle>
  /** Scroll to bottom content style */
  scrollToBottomContentStyle?: StyleProp<ViewStyle>
  /** Distance from bottom before showing scroll to bottom button */
  scrollToBottomOffset?: number
  /** Custom component to render when messages are empty */
  renderChatEmpty?: () => React.ReactNode
  /** Custom footer component on the ListView, e.g. 'User is typing...' */
  renderFooter?: (props: MessagesContainerProps<TMessage>) => React.ReactNode
  /** Animated reserve rendered at the visual bottom without relying on contentContainerStyle updates. */
  renderBottomSpacer?: () => React.ReactNode
  /** Animated reserve rendered beyond the oldest message at the visual top. */
  renderTopSpacer?: () => React.ReactNode
  /** Custom message container */
  renderMessage?: (props: MessageProps<TMessage>) => React.ReactElement
  /** Custom day above a message */
  renderDay?: (props: DayProps) => React.ReactNode
  /** Custom "Load earlier messages" button */
  renderLoadEarlier?: (props: LoadEarlierMessagesProps) => React.ReactNode
  /** Custom typing indicator */
  renderTypingIndicator?: () => React.ReactNode
  /** Scroll to bottom custom component */
  scrollToBottomComponent?: () => React.ReactNode
  /** Callback when quick reply is sent */
  onQuickReply?: (replies: Reply[]) => void
  /** Props to pass to the LoadEarlierMessages component. The LoadEarlierMessages button is only visible when isAvailable is true. Includes isAvailable (controls button visibility), isInfiniteScrollEnabled (infinite scroll up when reach the top of messages container, automatically call onPress function if it exists - not yet supported for web), onPress (callback when button is pressed), isLoading (display loading indicator), label (override default "Load earlier messages" text), and styling props (containerStyle, wrapperStyle, textStyle, activityIndicatorStyle, activityIndicatorColor, activityIndicatorSize). */
  loadEarlierMessagesProps?: LoadEarlierMessagesProps
  /** Style for TypingIndicator component */
  typingIndicatorStyle?: StyleProp<ViewStyle>
  /** Enable animated day label that appears on scroll; default is true */
  isDayAnimationEnabled?: boolean
  /** Reply functionality configuration */
  reply?: ReplyProps<TMessage>
  /** Emoji reactions configuration */
  reactions?: ReactionsProps<TMessage>
}

export interface State {
  showScrollBottom: boolean
  hasScrolled: boolean
}

interface ViewLayout {
  x: number
  y: number
  width: number
  height: number
}

export type DaysPositions = { [key: string]: ViewLayout & { createdAt: number } }
