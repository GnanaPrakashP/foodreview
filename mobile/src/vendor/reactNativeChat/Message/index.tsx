// @ts-nocheck
import Ionicons from '@expo/vector-icons/Ionicons'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { Avatar } from '../Avatar'
import { Bubble } from '../Bubble'
import { Color } from '../Color'
import { IMessage } from '../Models'
import { SwipeToReplyProps } from '../Reply'
import { getStyleWithPosition } from '../styles'
import { SystemMessage } from '../SystemMessage'
import { isSameUser, renderComponentOrElement } from '../utils'
import styles from './styles'
import { MessageProps } from './types'

export * from './types'

const REPLY_SWIPE_ACTIVATION_DISTANCE = 18
const REPLY_SWIPE_TRIGGER_DISTANCE = 48
const REPLY_SWIPE_MAX_TRANSLATE = 64
const REPLY_SWIPE_VERTICAL_TOLERANCE = 20

interface ReplyIconProps {
  progress: SharedValue<number>
  direction: 'left' | 'right'
  style?: SwipeToReplyProps<IMessage>['actionContainerStyle']
}

const ReplyIcon = ({ progress, direction, style }: ReplyIconProps) => {
  const animatedStyle = useAnimatedStyle(() => {
    'worklet'

    const resolvedProgress = Math.min(Math.max(progress.value, 0), 1)
    const scale = 0.86 + resolvedProgress * 0.14
    const translateX = (1 - resolvedProgress) * (direction === 'left' ? 6 : -6)

    return {
      opacity: resolvedProgress,
      transform: [{ scale }, { translateX }],
    }
  })

  return (
    <Animated.View style={[localStyles.replyIconContainer, animatedStyle, style]}>
      <Ionicons
        color={Color.white}
        name='arrow-undo-outline'
        size={17}
      />
    </Animated.View>
  )
}

// The reply affordance is invisible until a swipe is actually in progress, but
// mounting it eagerly cost every row an Animated.Text plus two worklet nodes
// (the progress useDerivedValue and the icon's useAnimatedStyle) at rest. Both
// now live here, behind the arming flag, so a row that is never swiped never
// builds them. `progress` is still derived from the same shared value, so the
// renderAction contract (progress, translation, position) is unchanged.
const SwipeActionLayer = ({
  direction,
  position,
  renderAction,
  style,
  translation,
}: {
  direction: 'left' | 'right'
  position: 'left' | 'right'
  renderAction?: SwipeToReplyProps<IMessage>['renderAction']
  style?: SwipeToReplyProps<IMessage>['actionContainerStyle']
  translation: SharedValue<number>
}) => {
  const progress = useDerivedValue(() =>
    Math.min(1, Math.abs(translation.value) / REPLY_SWIPE_TRIGGER_DISTANCE)
  )

  if (renderAction)
    return renderAction(progress, translation, position)

  return (
    <ReplyIcon
      progress={progress}
      direction={direction}
      style={style}
    />
  )
}

// Every piece of Reanimated state this row needs lives HERE, not in Message,
// because hooks cannot be conditional: with the shared value, the animated
// style and the Pan gesture declared in Message, a date separator, an unread
// divider, a dish card and a standalone media row each built and serialized a
// gesture they then threw away on the `!isSwipeToReplyEnabled` early return. A
// fling profile put ~9.5% of JS thread time in Reanimated worklet
// serialization (makeMutableNative for the shared value, registerEventHandler
// for the detector, cloneWorklet for the callbacks), all of it per mounted row,
// so rows that cannot swipe now pay none of it.
const SwipeToReplyRow = ({
  actionContainerStyle,
  children,
  currentMessage,
  direction,
  isGestureEnabled,
  onMessageLayout,
  onSwipe,
  position,
  renderAction,
}) => {
  const replySwipeX = useSharedValue(0)
  const replySwipeContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: replySwipeX.value }],
  }), [replySwipeX])
  // Recycling safety. Under FlashList this component instance is REUSED for the
  // next message of the same type instead of being unmounted, so state and the
  // translate survive into a row they do not belong to: a recycled row would
  // keep a previous row's armed reply icon, and could inherit a mid-swipe
  // offset. Resetting during render on identity change is the derived-state
  // pattern and is a no-op under FlatList, where the instance never outlives
  // its message.
  const recycledMessageIdRef = useRef(currentMessage?._id)
  // Arm only after the horizontal pan activates. Arming on finger-down caused
  // a React update while the nested bubble's long-press timer was running,
  // cancelling the message-options gesture. Never disarmed: this remains a
  // one-time cost per row, paid only by rows that are actually swiped.
  const [isSwipeArmed, setIsSwipeArmed] = useState(false)
  if (recycledMessageIdRef.current !== currentMessage?._id) {
    recycledMessageIdRef.current = currentMessage?._id
    replySwipeX.value = 0
    if (isSwipeArmed)
      setIsSwipeArmed(false)
  }
  // The gesture's worklets capture whatever these close over, and a closure is
  // serialized per row rather than served from Reanimated's shareable cache.
  // Reading the message from a ref keeps `currentMessage` — which changes
  // identity on every row — out of the closure, so what crosses to the UI
  // runtime is two stable functions and a couple of primitives.
  const swipeStateRef = useRef({ currentMessage, onSwipe })
  swipeStateRef.current = { currentMessage, onSwipe }
  const armSwipe = useCallback(() => {
    setIsSwipeArmed(current => (current ? current : true))
  }, [])
  const triggerSwipeReply = useCallback(() => {
    const { currentMessage: message, onSwipe: handler } = swipeStateRef.current
    if (handler && message)
      handler(message)
  }, [])
  const isRightward = direction === 'right'
  const replySwipeGesture = useMemo(() => (
    Gesture.Pan()
      .enabled(Boolean(isGestureEnabled && onSwipe))
      .activeOffsetX(
        isRightward
          ? REPLY_SWIPE_ACTIVATION_DISTANCE
          : -REPLY_SWIPE_ACTIVATION_DISTANCE
      )
      .failOffsetY([-REPLY_SWIPE_VERTICAL_TOLERANCE, REPLY_SWIPE_VERTICAL_TOLERANCE])
      .onStart(() => {
        runOnJS(armSwipe)()
      })
      .onUpdate(event => {
        const directionalDistance = isRightward
          ? Math.max(0, event.translationX)
          : Math.min(0, event.translationX)
        replySwipeX.value = isRightward
          ? Math.min(directionalDistance, REPLY_SWIPE_MAX_TRANSLATE)
          : Math.max(directionalDistance, -REPLY_SWIPE_MAX_TRANSLATE)
      })
      // Decide from onFinalize rather than onEnd. At the newest edge of an
      // inverted Android list, the list/composer can cancel an otherwise
      // deliberate pan during gesture arbitration. Cancelled pans skip onEnd
      // but always finalize, which previously made the newest rows animate
      // without ever opening the reply composer.
      .onFinalize(event => {
        const directionalDistance = isRightward
          ? event.translationX
          : -event.translationX
        const deliberateReplySwipe = (
          directionalDistance >= REPLY_SWIPE_TRIGGER_DISTANCE &&
          directionalDistance > Math.abs(event.translationY) * 1.5
        )
        if (deliberateReplySwipe)
          runOnJS(triggerSwipeReply)()
        replySwipeX.value = withTiming(0, {
          duration: 150,
          easing: Easing.out(Easing.cubic),
        })
      })
  ), [
    armSwipe,
    isGestureEnabled,
    isRightward,
    onSwipe,
    replySwipeX,
    triggerSwipeReply,
  ])

  return (
    <View onLayout={onMessageLayout} style={localStyles.swipeContainer}>
      {isSwipeArmed ? (
        <View
          pointerEvents="none"
          style={[
            localStyles.swipeActionLayer,
            isRightward
              ? localStyles.swipeActionLayerLeft
              : localStyles.swipeActionLayerRight,
          ]}
        >
          <SwipeActionLayer
            direction={direction}
            position={position}
            renderAction={renderAction}
            style={actionContainerStyle}
            translation={replySwipeX}
          />
        </View>
      ) : null}
      <GestureDetector gesture={replySwipeGesture} touchAction="pan-y">
        <Animated.View style={[localStyles.swipeContent, replySwipeContentStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

export const Message = <TMessage extends IMessage = IMessage>(props: MessageProps<TMessage>) => {
  const {
    currentMessage,
    renderBubble: renderBubbleProp,
    renderSystemMessage: renderSystemMessageProp,
    onMessageLayout,
    nextMessage,
    position,
    containerStyle,
    user,
    isUserAvatarVisible,
    swipeToReply,
  } = props

  // Extract swipe props
  const isSwipeToReplyEnabled = swipeToReply?.isEnabled ?? false
  const isSwipeToReplyGestureEnabled = swipeToReply?.isGestureEnabled ?? isSwipeToReplyEnabled
  const swipeToReplyDirection = swipeToReply?.direction ?? 'left'
  const onSwipeToReply = swipeToReply?.onSwipe
  const renderSwipeToReplyActionProp = swipeToReply?.renderAction
  const swipeToReplyActionContainerStyle = swipeToReply?.actionContainerStyle
  const renderBubble = useCallback(() => {
    const {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      containerStyle,
      onMessageLayout,
      swipeToReply,
      /* eslint-enable @typescript-eslint/no-unused-vars */
      ...rest
    } = props

    if (renderBubbleProp)
      return renderComponentOrElement(renderBubbleProp, rest)

    return <Bubble {...rest} />
  }, [props, renderBubbleProp])

  const renderSystemMessage = useCallback(() => {
    const {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      containerStyle,
      onMessageLayout,
      swipeToReply,
      /* eslint-enable @typescript-eslint/no-unused-vars */
      ...rest
    } = props

    if (renderSystemMessageProp)
      return renderComponentOrElement(renderSystemMessageProp, rest)

    return <SystemMessage {...rest} />
  }, [props, renderSystemMessageProp])

  const renderAvatar = useCallback(() => {
    if (
      user?._id &&
      currentMessage?.user &&
      user._id === currentMessage.user._id &&
      !isUserAvatarVisible
    )
      return null

    if (currentMessage?.user?.avatar === null)
      return null

    const {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      containerStyle,
      onMessageLayout,
      swipeToReply,
      /* eslint-enable @typescript-eslint/no-unused-vars */
      ...rest
    } = props

    return <Avatar {...rest} />
  }, [
    props,
    user,
    currentMessage,
    isUserAvatarVisible,
  ])

  const sameUser = useMemo(() =>
    isSameUser(currentMessage, nextMessage!)
  , [currentMessage, nextMessage])

  const messageContent = useMemo(() => {
    if (currentMessage?.system)
      return renderSystemMessage()

    return (
      <View
        style={[
          getStyleWithPosition(styles, 'container', position),
          { marginBottom: sameUser ? 2 : 10 },
          !props.isInverted && { marginBottom: 2 },
          containerStyle?.[position],
        ]}
      >
        {position === 'left' && renderAvatar()}
        {renderBubble()}
        {position === 'right' && renderAvatar()}
      </View>
    )
  }, [
    currentMessage?.system,
    renderSystemMessage,
    position,
    sameUser,
    props.isInverted,
    containerStyle,
    renderAvatar,
    renderBubble,
  ])

  if (!currentMessage)
    return null

  // System/disabled rows stay as a single native wrapper.
  if (currentMessage.system || !isSwipeToReplyEnabled)
    return (
      <View onLayout={onMessageLayout}>
        {messageContent}
      </View>
    )

  return (
    <SwipeToReplyRow
      actionContainerStyle={swipeToReplyActionContainerStyle}
      currentMessage={currentMessage}
      direction={swipeToReplyDirection}
      isGestureEnabled={isSwipeToReplyGestureEnabled}
      onMessageLayout={onMessageLayout}
      onSwipe={onSwipeToReply}
      position={position}
      renderAction={renderSwipeToReplyActionProp}
    >
      {messageContent}
    </SwipeToReplyRow>
  )
}

const localStyles = StyleSheet.create({
  swipeContainer: {
    position: 'relative',
    width: '100%',
  },
  swipeContent: {
    width: '100%',
  },
  swipeActionLayer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    top: 0,
    width: REPLY_SWIPE_MAX_TRANSLATE,
  },
  swipeActionLayerLeft: {
    left: 0,
  },
  swipeActionLayerRight: {
    right: 0,
  },
  replyIconContainer: {
    alignItems: 'center',
    backgroundColor: Color.defaultBlue,
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
})
