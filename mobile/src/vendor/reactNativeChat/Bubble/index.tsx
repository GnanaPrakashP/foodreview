// @ts-nocheck
import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  View,
  Pressable,
  Text } from 'react-native'
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { useChatContext } from '../ChatContext'
import { MessageReply } from '../components/MessageReply'
import { MessageAudio } from '../MessageAudio'
import { MessageImage } from '../MessageImage'
import { MessageText } from '../MessageText'
import { MessageVideo } from '../MessageVideo'
import { IMessage } from '../Models'
import { QuickReplies } from '../QuickReplies'
import { DEFAULT_REACTION_EMOJIS, MessageReactions, ReactionPicker } from '../Reactions'
import { getStyleWithPosition } from '../styles'
import { Time } from '../Time'
import { isSameUser, isSameDay, renderComponentOrElement } from '../utils'
import styles from './styles'
import { BubbleProps, RenderMessageTextProps } from './types'

export * from './types'

interface PickerAnchor {
  pageX: number
  pageY: number
  bubbleWidth: number
  bubbleHeight: number
}

const SCALE_PRESSED = 0.85
const SCALE_DURATION_IN = 400
const SCALE_DURATION_OUT = 200
const SCALE_EASING = Easing.inOut(Easing.quad)

// The long-press/tap reaction machinery lives in its own component so it is
// only constructed when reactions are actually enabled. Held inline in Bubble,
// its animation and picker state were paid by every message row on mount even
// with reactions off — hooks cannot be called conditionally, but a component
// can be rendered conditionally. Per-row mount cost is what makes a cold chat
// list expensive, and unlike re-render cost it cannot be memoized away.
const ReactionsBubble = <TMessage extends IMessage = IMessage>({
  containerStyle,
  context,
  currentMessage,
  onPressMessage,
  position,
  reactions,
  renderBubbleBody,
  renderQuickReplies,
  renderReactionsDisplay,
  wrapperStyleList,
}: {
  containerStyle?: unknown
  context: unknown
  currentMessage?: TMessage
  onPressMessage?: (context: unknown, message?: TMessage) => void
  position: 'left' | 'right'
  reactions: NonNullable<BubbleProps<TMessage>['reactions']>
  renderBubbleBody: () => React.ReactNode
  renderQuickReplies: () => React.ReactNode
  renderReactionsDisplay: () => React.ReactNode
  wrapperStyleList: unknown
}): React.ReactElement => {
  const bubbleContainerRef = useRef<View>(null)

  const [isPickerVisible, setIsPickerVisible] = useState(false)
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>({
    pageX: 0,
    pageY: 0,
    bubbleWidth: 0,
    bubbleHeight: 0,
  })

  const messageScale = useSharedValue(1)

  const bubbleScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: messageScale.value }],
  }))

  const measureBubble = useCallback(() => {
    bubbleContainerRef.current?.measure((_x, _y, width, height, pageX, pageY) => {
      setPickerAnchor({ pageX, pageY, bubbleWidth: width, bubbleHeight: height })
    })
  }, [])

  const handlePress = useCallback(() => {
    onPressMessage?.(context, currentMessage)
  }, [context, currentMessage, onPressMessage])

  const handlePressIn = useCallback(() => {
    messageScale.value = withTiming(SCALE_PRESSED, {
      duration: SCALE_DURATION_IN,
      easing: SCALE_EASING,
      reduceMotion: ReduceMotion.System,
    })
    measureBubble()
  }, [measureBubble, messageScale])

  const handlePressOut = useCallback(() => {
    messageScale.value = withTiming(1, {
      duration: SCALE_DURATION_OUT,
      easing: SCALE_EASING,
      reduceMotion: ReduceMotion.System,
    })
  }, [messageScale])

  const handleLongPress = useCallback(() => {
    setIsPickerVisible(true)
  }, [])

  const renderReactionPickerModal = useCallback(() => {
    const emojis = reactions.emojis ?? DEFAULT_REACTION_EMOJIS

    const pickerProps = {
      visible: isPickerVisible,
      message: currentMessage,
      emojis,
      onSelect: (emoji: string) => reactions?.onReactionPress?.(currentMessage, emoji),
      onDismiss: () => setIsPickerVisible(false),
      position,
      ...pickerAnchor,
      pickerContainerStyle: reactions.pickerContainerStyle,
      pickerEmojiStyle: reactions.pickerEmojiStyle,
    }

    if (reactions.renderReactionPicker)
      return renderComponentOrElement(reactions.renderReactionPicker, pickerProps)

    return <ReactionPicker {...pickerProps} />
  }, [reactions, isPickerVisible, currentMessage, position, pickerAnchor])

  // Swipe is owned by the full-width parent row. Using Pressable for the
  // bubble's hold lifecycle avoids a second nested gesture-handler state
  // machine competing with that pan on Android.
  return (
    <Animated.View style={containerStyle} ref={bubbleContainerRef}>
      <Pressable
        delayLongPress={350}
        onLongPress={handleLongPress}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <Animated.View style={bubbleScaleStyle}>
          <View style={wrapperStyleList}>
            {renderBubbleBody()}
          </View>
        </Animated.View>
      </Pressable>
      {renderQuickReplies()}
      {renderReactionsDisplay()}
      {renderReactionPickerModal()}
    </Animated.View>
  )
}

export const Bubble = <TMessage extends IMessage = IMessage>(props: BubbleProps<TMessage>): React.ReactElement => {
  const {
    currentMessage,
    nextMessage,
    position,
    containerToNextStyle,
    previousMessage,
    containerToPreviousStyle,
    onQuickReply,
    renderQuickReplySend,
    quickReplyStyle,
    quickReplyTextStyle,
    quickReplyContainerStyle,
    containerStyle,
    wrapperStyle,
    bottomContainerStyle,
    onPressMessage: onPressMessageProp,
    onLongPressMessage: onLongPressMessageProp,
    reactions,
  } = props

  const context = useChatContext()

  const onPress = useCallback(() => {
    onPressMessageProp?.(context, currentMessage)
  }, [onPressMessageProp, context, currentMessage])

  const onLongPress = useCallback(() => {
    onLongPressMessageProp?.(context, currentMessage)
  }, [
    currentMessage,
    context,
    onLongPressMessageProp,
  ])

  const styledBubbleToNext = useMemo(() => {
    if (
      currentMessage &&
      nextMessage &&
      position &&
      isSameUser(currentMessage, nextMessage) &&
      isSameDay(currentMessage, nextMessage)
    )
      return [
        getStyleWithPosition(styles, 'containerToNext', position),
        containerToNextStyle?.[position],
      ]

    return null
  }, [
    currentMessage,
    nextMessage,
    position,
    containerToNextStyle,
  ])

  const styledBubbleToPrevious = useMemo(() => {
    if (
      currentMessage &&
      previousMessage &&
      position &&
      isSameUser(currentMessage, previousMessage) &&
      isSameDay(currentMessage, previousMessage)
    )
      return [
        getStyleWithPosition(styles, 'containerToPrevious', position),
        containerToPreviousStyle?.[position],
      ]

    return null
  }, [
    currentMessage,
    previousMessage,
    position,
    containerToPreviousStyle,
  ])

  const renderQuickReplies = useCallback(() => {
    if (currentMessage?.quickReplies) {
      const {
        /* eslint-disable @typescript-eslint/no-unused-vars */
        containerStyle,
        wrapperStyle,
        /* eslint-enable @typescript-eslint/no-unused-vars */
        ...quickReplyProps
      } = props

      if (props.renderQuickReplies)
        return renderComponentOrElement(props.renderQuickReplies, quickReplyProps)

      return (
        <QuickReplies
          currentMessage={currentMessage}
          onQuickReply={onQuickReply}
          renderQuickReplySend={renderQuickReplySend}
          quickReplyStyle={quickReplyStyle}
          quickReplyTextStyle={quickReplyTextStyle}
          quickReplyContainerStyle={quickReplyContainerStyle}
          nextMessage={nextMessage}
        />
      )
    }

    return null
  }, [
    currentMessage,
    onQuickReply,
    renderQuickReplySend,
    quickReplyStyle,
    quickReplyTextStyle,
    quickReplyContainerStyle,
    nextMessage,
    props,
  ])

  const renderMessageText = useCallback(() => {
    if (currentMessage?.text) {
      const {
        /* eslint-disable @typescript-eslint/no-unused-vars */
        containerStyle,
        wrapperStyle,
        messageTextProps,
        /* eslint-enable @typescript-eslint/no-unused-vars */
        ...messageTextPropsRest
      } = props

      const combinedProps = {
        ...messageTextPropsRest,
        ...messageTextProps,
      } as RenderMessageTextProps<TMessage>

      if (props.renderMessageText)
        return renderComponentOrElement(props.renderMessageText, combinedProps)

      return <MessageText {...combinedProps as any} />
    }

    return null
  }, [props, currentMessage])

  const renderMessageImage = useCallback(() => {
    if (currentMessage?.image) {
      const {
        /* eslint-disable @typescript-eslint/no-unused-vars */
        containerStyle,
        wrapperStyle,
        /* eslint-enable @typescript-eslint/no-unused-vars */
        ...messageImageProps
      } = props

      if (props.renderMessageImage)
        return renderComponentOrElement(props.renderMessageImage, messageImageProps)

      return <MessageImage {...messageImageProps} />
    }

    return null
  }, [props, currentMessage])

  const renderMessageVideo = useCallback(() => {
    if (!currentMessage?.video)
      return null

    const {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      containerStyle,
      wrapperStyle,
      /* eslint-enable @typescript-eslint/no-unused-vars */
      ...messageVideoProps
    } = props

    if (props.renderMessageVideo)
      return renderComponentOrElement(props.renderMessageVideo, messageVideoProps)

    return <MessageVideo />
  }, [props, currentMessage])

  const renderMessageAudio = useCallback(() => {
    if (!currentMessage?.audio)
      return null

    const {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      containerStyle,
      wrapperStyle,
      /* eslint-enable @typescript-eslint/no-unused-vars */
      ...messageAudioProps
    } = props

    if (props.renderMessageAudio)
      return renderComponentOrElement(props.renderMessageAudio, messageAudioProps)

    return <MessageAudio />
  }, [props, currentMessage])

  const renderTicks = useCallback(() => {
    const {
      renderTicks,
      user,
    } = props

    if (renderTicks && currentMessage)
      return renderComponentOrElement(renderTicks, currentMessage)

    if (
      user &&
      currentMessage?.user &&
      currentMessage.user._id !== user._id
    )
      return null

    if (
      currentMessage &&
      (currentMessage.sent || currentMessage.received || currentMessage.pending)
    )
      return (
        <View style={styles.messageStatusContainer}>
          {!!currentMessage.sent && (
            <Text style={[styles.messageStatus, props.tickStyle]}>
              {'✓'}
            </Text>
          )}
          {!!currentMessage.received && (
            <Text style={[styles.messageStatus, props.tickStyle]}>
              {'✓'}
            </Text>
          )}
          {!!currentMessage.pending && (
            <Text style={[styles.messageStatus, props.tickStyle]}>
              {'🕓'}
            </Text>
          )}
        </View>
      )

    return null
  }, [
    props,
    currentMessage,
  ])

  const renderTime = useCallback(() => {
    if (currentMessage?.createdAt) {
      const {
        /* eslint-disable @typescript-eslint/no-unused-vars */
        containerStyle,
        wrapperStyle,
        textStyle,
        /* eslint-enable @typescript-eslint/no-unused-vars */
        ...timeProps
      } = props

      if (props.renderTime)
        return renderComponentOrElement(props.renderTime, timeProps)

      return <Time {...timeProps} />
    }

    return null
  }, [props, currentMessage])

  const renderUsername = useCallback(() => {
    const {
      user,
      renderUsername,
    } = props

    if (props.isUsernameVisible && currentMessage) {
      if (user && currentMessage.user._id === user._id)
        return null

      if (renderUsername)
        return renderComponentOrElement(renderUsername, currentMessage.user)

      return (
        <View style={styles.usernameContainer}>
          <Text
            style={[styles.username, props.usernameStyle]}
          >
            {currentMessage.user.name}
          </Text>
        </View>
      )
    }

    return null
  }, [
    currentMessage,
    props,
  ])

  const renderCustomView = useCallback(() => {
    if (props.renderCustomView)
      return renderComponentOrElement(props.renderCustomView, props)

    return null
  }, [props])

  const renderMessageReply = useCallback(() => {
    if (!currentMessage?.replyMessage)
      return null

    const { messageReply } = props

    const messageReplyProps = {
      replyMessage: currentMessage.replyMessage,
      currentMessage,
      position,
      onPress: messageReply?.onPress,
      containerStyle: position === 'left'
        ? messageReply?.containerStyleLeft ?? messageReply?.containerStyle
        : messageReply?.containerStyleRight ?? messageReply?.containerStyle,
      textStyle: position === 'left'
        ? messageReply?.textStyleLeft ?? messageReply?.textStyle
        : messageReply?.textStyleRight ?? messageReply?.textStyle,
      imageStyle: messageReply?.imageStyle,
    }

    if (messageReply?.renderMessageReply)
      return renderComponentOrElement(messageReply.renderMessageReply, messageReplyProps)

    return <MessageReply {...messageReplyProps} />
  }, [
    props,
    currentMessage,
    position,
  ])

  const renderBubbleContent = useCallback(() => {
    return (
      <>
        {!props.isCustomViewBottom && renderCustomView()}
        {renderMessageReply()}
        {renderMessageImage()}
        {renderMessageVideo()}
        {renderMessageAudio()}
        {renderMessageText()}
        {props.isCustomViewBottom && renderCustomView()}
      </>
    )
  }, [
    renderMessageReply,
    renderCustomView,
    renderMessageImage,
    renderMessageVideo,
    renderMessageAudio,
    renderMessageText,
    props.isCustomViewBottom,
  ])

  const renderBubbleBody = useCallback(() => (
    <>
      {renderBubbleContent()}
      <View
        style={[
          styles.bottom,
          bottomContainerStyle?.[position],
        ]}
      >
        {renderUsername()}
        <View style={styles.messageTimeAndStatusContainer}>
          {renderTime()}
          {renderTicks()}
        </View>
      </View>
    </>
  ), [
    position,
    bottomContainerStyle,
    renderBubbleContent,
    renderUsername,
    renderTime,
    renderTicks,
  ])

  const wrapperStyleList = useMemo(() => [
    getStyleWithPosition(styles, 'wrapper', position),
    styledBubbleToNext,
    styledBubbleToPrevious,
    wrapperStyle?.[position],
  ], [position, styledBubbleToNext, styledBubbleToPrevious, wrapperStyle])

  const renderReactionsDisplay = useCallback(() => {
    const currentReactions = currentMessage?.reactions
    if (!currentReactions || currentReactions.length === 0)
      return null

    const displayProps = {
      message: currentMessage,
      reactions: currentReactions,
      currentUserId: props.user?._id,
      position,
      onReactionPress: (emoji: string) => reactions?.onReactionPress?.(currentMessage, emoji),
      containerStyle: reactions?.containerStyle,
      reactionStyle: reactions?.reactionStyle,
      reactionActiveStyle: reactions?.reactionActiveStyle,
      reactionTextStyle: reactions?.reactionTextStyle,
      reactionCountStyle: reactions?.reactionCountStyle,
    }

    if (reactions?.renderReactions)
      return renderComponentOrElement(reactions.renderReactions, displayProps)

    return <MessageReactions {...displayProps} />
  }, [currentMessage, position, props.user, reactions])

  if (reactions?.isEnabled)
    return (
      <ReactionsBubble
        containerStyle={containerStyle?.[position]}
        context={context}
        currentMessage={currentMessage}
        onPressMessage={onPressMessageProp}
        position={position}
        reactions={reactions}
        renderBubbleBody={renderBubbleBody}
        renderQuickReplies={renderQuickReplies}
        renderReactionsDisplay={renderReactionsDisplay}
        wrapperStyleList={wrapperStyleList}
      />
    )

  // Default path: unchanged behaviour for existing users, preserving
  // touchableProps, native press feedback, and the onLongPressMessage callback.
  return (
    <View style={containerStyle?.[position]}>
      <View style={wrapperStyleList}>
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          {...props.touchableProps}
        >
          {renderBubbleBody()}
        </Pressable>
      </View>
      {renderQuickReplies()}
    </View>
  )
}
