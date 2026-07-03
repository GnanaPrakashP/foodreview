// @ts-nocheck
import React, { ReactNode, useCallback } from 'react'
import {
  ImageStyle,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native'
import { ChatAvatar } from './ChatAvatar'
import { IMessage, LeftRightStyle, User } from './Models'
import { isSameUser, isSameDay } from './utils'

interface Styles {
  left: {
    container: ViewStyle
    onTop: ViewStyle
    image: ImageStyle
  }
  right: {
    container: ViewStyle
    onTop: ViewStyle
    image: ImageStyle
  }
}

const styles: Styles = {
  left: StyleSheet.create({
    container: {
      marginRight: 8,
    },
    onTop: {
      alignSelf: 'flex-start',
    },
    image: {
      height: 36,
      width: 36,
      borderRadius: 18,
    },
  }),
  right: StyleSheet.create({
    container: {
      marginLeft: 8,
    },
    onTop: {
      alignSelf: 'flex-start',
    },
    image: {
      height: 36,
      width: 36,
      borderRadius: 18,
    },
  }),
}

export interface AvatarProps<TMessage extends IMessage> {
  currentMessage: TMessage
  previousMessage?: TMessage
  nextMessage?: TMessage
  position: 'left' | 'right'
  isAvatarOnTop?: boolean
  isAvatarVisibleForEveryMessage?: boolean
  avatarImageStyle?: LeftRightStyle<ImageStyle>
  avatarTextStyle?: StyleProp<TextStyle>
  imageStyle?: LeftRightStyle<ImageStyle>
  containerStyle?: LeftRightStyle<ViewStyle>
  textStyle?: TextStyle
  renderAvatar?(props: Omit<AvatarProps<TMessage>, 'renderAvatar'>): ReactNode
  onPressAvatar?: (user: User) => void
  onLongPressAvatar?: (user: User) => void
}

export function Avatar<TMessage extends IMessage = IMessage> (
  props: AvatarProps<TMessage>
) {
  const {
    isAvatarOnTop,
    isAvatarVisibleForEveryMessage,
    containerStyle,
    position,
    currentMessage,
    renderAvatar,
    previousMessage,
    nextMessage,
    avatarImageStyle,
    avatarTextStyle,
    imageStyle,
    onPressAvatar,
    onLongPressAvatar,
  } = props

  const messageToCompare = isAvatarOnTop ? previousMessage : nextMessage

  const renderAvatarComponent = useCallback(() => {
    if (renderAvatar)
      return renderAvatar({
        isAvatarOnTop,
        isAvatarVisibleForEveryMessage,
        containerStyle,
        position,
        currentMessage,
        previousMessage,
        nextMessage,
        avatarImageStyle,
        avatarTextStyle,
        imageStyle,
        onPressAvatar,
        onLongPressAvatar,
      })

    if (currentMessage)
      return (
        <ChatAvatar
          avatarStyle={[
            styles[position].image,
            imageStyle?.[position],
            avatarImageStyle?.[position],
          ]}
          textStyle={avatarTextStyle}
          user={currentMessage.user}
          onPress={() => onPressAvatar?.(currentMessage.user)}
          onLongPress={() => onLongPressAvatar?.(currentMessage.user)}
        />
      )

    return null
  }, [
    renderAvatar,
    isAvatarOnTop,
    isAvatarVisibleForEveryMessage,
    containerStyle,
    position,
    currentMessage,
    previousMessage,
    nextMessage,
    avatarImageStyle,
    avatarTextStyle,
    imageStyle,
    onPressAvatar,
    onLongPressAvatar,
  ])

  if (renderAvatar === null)
    return null

  if (
    !isAvatarVisibleForEveryMessage &&
    currentMessage &&
    messageToCompare &&
    isSameUser(currentMessage, messageToCompare) &&
    isSameDay(currentMessage, messageToCompare)
  )
    return (
      <View
        style={[
          styles[position].container,
          containerStyle?.[position],
        ]}
      >
        <ChatAvatar
          avatarStyle={[
            styles[position].image,
            imageStyle?.[position],
            avatarImageStyle?.[position],
          ]}
        />
      </View>
    )

  return (
    <View
      style={[
        styles[position].container,
        isAvatarOnTop && styles[position].onTop,
        containerStyle?.[position],
      ]}
    >
      {renderAvatarComponent()}
    </View>
  )
}
