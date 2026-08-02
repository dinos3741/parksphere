import React, { useRef, useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, PanResponder, Animated, TouchableOpacity, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import Ionicons from '@expo/vector-icons/Ionicons';

// Collapsible admin log panel, styled after iOS Find My's item card: rounded, frosted/translucent,
// a centered drag handle to resize while open, and an X in the top-right to collapse. Collapsed
// state is a separate small handle tab docked to the right edge (not a shrunk version of the same
// panel — its shape changes too much between the two states to animate as one continuous box).
// Both states stay mounted at all times, sliding horizontally in/out from the right edge (where the
// handle lives) so the handle reads as retracting into the panel and back, rather than crossfading.
const DEFAULT_EXPANDED_HEIGHT = 260;
const MIN_EXPANDED_HEIGHT = 120;
const MAX_EXPANDED_HEIGHT = 500;
const SLIDE_DURATION_MS = 250;
const SCREEN_WIDTH = Dimensions.get('window').width;
const HANDLE_HIDE_OFFSET = 60; // > collapsedHandle's 40pt width, so it fully clears the right edge

const Notifications = ({ notifications, onHeightChange }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const animatedHeight = useRef(new Animated.Value(DEFAULT_EXPANDED_HEIGHT)).current;
  const startDragHeight = useRef(DEFAULT_EXPANDED_HEIGHT);
  const panelSlide = useRef(new Animated.Value(0)).current; // 0 = docked, SCREEN_WIDTH = off-screen right
  const handleSlide = useRef(new Animated.Value(HANDLE_HIDE_OFFSET)).current; // 0 = docked, HANDLE_HIDE_OFFSET = off-screen right
  const scrollViewRef = useRef(null);

  // Unread indicator for the collapsed handle: while expanded, "seen" tracks the live count (every
  // new entry is immediately visible, so nothing to flag). While collapsed, anything that arrives
  // past that last-seen count lights the dot; opening the panel marks it all seen again.
  const [hasUnread, setHasUnread] = useState(false);
  const lastSeenCount = useRef(notifications.length);
  useEffect(() => {
    if (isExpanded) {
      lastSeenCount.current = notifications.length;
      setHasUnread(false);
    } else if (notifications.length > lastSeenCount.current) {
      setHasUnread(true);
    }
  }, [notifications.length, isExpanded]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startDragHeight.current = animatedHeight._value;
      },
      onPanResponderMove: (evt, gestureState) => {
        let newHeight = startDragHeight.current - gestureState.dy;
        newHeight = Math.max(MIN_EXPANDED_HEIGHT, Math.min(MAX_EXPANDED_HEIGHT, newHeight));
        animatedHeight.setValue(newHeight);
      },
      onPanResponderRelease: () => {
        const finalHeight = animatedHeight._value;
        if (onHeightChange) onHeightChange(finalHeight);
      },
    })
  ).current;

  const animateTo = (expand) => {
    setIsExpanded(expand);
    Animated.parallel([
      // useNativeDriver: false on both — the expanded panel's Animated.View also has `height`
      // (animatedHeight) in its style, which the native driver can't handle. Mixing a
      // native-driven transform with a JS-driven height on the same view is what throws "style
      // property height is not supported by native animated module"; keeping both JS-driven here
      // avoids the conflict (fine for a small overlay like this — no real perf cost).
      Animated.timing(panelSlide, { toValue: expand ? 0 : SCREEN_WIDTH, duration: SLIDE_DURATION_MS, useNativeDriver: false }),
      Animated.timing(handleSlide, { toValue: expand ? HANDLE_HIDE_OFFSET : 0, duration: SLIDE_DURATION_MS, useNativeDriver: false }),
    ]).start();
    if (onHeightChange) onHeightChange(expand ? animatedHeight._value : 0);
  };

  const collapse = () => animateTo(false);
  const expand = () => animateTo(true);

  return (
    <>
      <Animated.View
        pointerEvents={isExpanded ? 'none' : 'auto'}
        style={[styles.collapsedHandle, { transform: [{ translateX: handleSlide }] }]}
      >
        <TouchableOpacity onPress={expand} style={StyleSheet.absoluteFill} activeOpacity={0.7}>
          <BlurView intensity={70} tint="light" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.tint]} />
          <View style={styles.collapsedHandleContent}>
            <Ionicons name="chevron-back" size={20} color="#333" />
            {hasUnread && <View style={styles.unreadDot} />}
          </View>
        </TouchableOpacity>
      </Animated.View>

      <Animated.View
        pointerEvents={isExpanded ? 'auto' : 'none'}
        style={[styles.notificationArea, { height: animatedHeight, transform: [{ translateX: panelSlide }] }]}
      >
        <BlurView intensity={70} tint="light" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.tint]} />

        <View style={styles.resizeHandle} {...panResponder.panHandlers}>
          <View style={styles.handleIndicator} />
        </View>
        <TouchableOpacity onPress={collapse} style={styles.closeButton}>
          <Ionicons name="close" size={20} color="#333" />
        </TouchableOpacity>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollViewContent}
          contentContainerStyle={styles.scrollContent}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: false })}
        >
          {notifications.map((notification, index) => (
            <Text key={index} style={styles.notificationText}>
              [{notification.timestamp}] {notification.msg}
            </Text>
          ))}
        </ScrollView>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  notificationArea: {
    // Floating overlay, not a flex sibling of the map — otherwise resizing this via the drag
    // handle would shrink/grow the map's own flex:1 box to compensate. This way the map always
    // fills the full screen (even behind the tab bar) and this panel just floats on top of it,
    // reaching the true screen bottom on purpose so it extends behind the translucent tab bar too.
    position: 'absolute',
    bottom: 0,
    left: 10,
    right: 10,
    borderRadius: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    overflow: 'hidden',
  },
  tint: {
    backgroundColor: 'rgba(81, 45, 168, 0.12)', // light mauve — keeps the black log text readable
  },
  resizeHandle: {
    width: '100%',
    height: 30, // large touch target, matches the original
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleIndicator: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(51, 51, 51, 0.4)',
  },
  closeButton: {
    position: 'absolute',
    top: 5,
    right: 7,
    zIndex: 1,
    width: 29, // 10% bigger than the original 26
    height: 29,
    borderRadius: 14.5,
    backgroundColor: 'rgba(0,0,0,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Right-edge handle tab shown while collapsed — flush with the screen edge (only the left side is
  // rounded, so it reads as a tab docked to the edge rather than a floating pill).
  collapsedHandle: {
    position: 'absolute',
    right: 0,
    bottom: 100, // clears the floating tab bar with room to spare
    width: 40,
    height: 70,
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  collapsedHandleContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#ff3b30',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  scrollViewContent: {
    flex: 1,
  },
  scrollContent: {
    padding: 10,
  },
  notificationText: {
    fontSize: 14,
    color: '#000000', // From park-detection
    fontWeight: '600', // From park-detection
    marginBottom: 4,
  },
});

export default React.memo(Notifications);
