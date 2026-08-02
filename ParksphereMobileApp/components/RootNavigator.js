import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Modal, Dimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import { NavigationContainer } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';

import HomeScreen from './HomeScreen';
import ChatTab from './ChatTab';
import SearchScreen from './SearchScreen';
import RequestsScreen from './RequestsScreen';
import UserDetails from './UserDetails';
import AboutScreen from './AboutScreen';

import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useSpots } from '../context/SpotContext';
import { useHeaderAction } from '../context/HeaderActionContext';

const Tab = createBottomTabNavigator();

// Tab bar side margin, computed (not guessed) so "10% narrower" is exact regardless of device
// width: previous margin was 24pt each side; solving (screenWidth - 2*margin) = 0.9 * (screenWidth
// - 2*24) for margin gives screenWidth*0.05 + 21.6.
const TAB_BAR_SIDE_MARGIN = Dimensions.get('window').width * 0.05 + 21.6;

export default function RootNavigator({
  navigationRef,
  socket,
  setActiveScreen,
}) {
  const { currentUser, fetchUserData, getAvatarUri } = useAuth();
  const { totalUnreadMessagesCount } = useChat();
  const { hasNewRequests } = useSpots();
  const { headerAction } = useHeaderAction();
  const [showAboutScreen, setShowAboutScreen] = useState(false);
  // Local copy of the active tab name — the screenListeners callback below already reports this to
  // App.js via the setActiveScreen prop, but this component needs its own copy too, to decide
  // whether to render the Home-only header action button.
  const [activeScreen, setLocalActiveScreen] = useState('Home');

  return (
    <NavigationContainer ref={navigationRef}>
      <View style={styles.fullContainer}>
        <View style={styles.header}>
          <View style={StyleSheet.absoluteFill}>
            <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
            {/* Fading the tint out over the bottom ~30% (instead of a flat fill) is what sells the
                merge with the map below — the solid color stops abruptly, but a tint trailing off
                to fully transparent reads as a soft blend instead of a hard edge. */}
            <LinearGradient
              colors={['rgba(81, 45, 168, 0.3)', 'rgba(81, 45, 168, 0)']}
              locations={[0.7, 1]}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <TouchableOpacity onPress={() => setShowAboutScreen(true)} style={styles.headerLeft}>
            <Image source={require('../assets/images/logo.png')} style={styles.logo} />
            <Text style={styles.appName}>Venio</Text>
          </TouchableOpacity>
          <Modal
            visible={showAboutScreen}
            animationType="slide"
            onRequestClose={() => setShowAboutScreen(false)}
          >
            <AboutScreen onClose={() => setShowAboutScreen(false)} />
          </Modal>
          {/* Replaces the old floating FAB — HomeScreen publishes its "+" action into
              HeaderActionContext since it can't render directly into this header (RootNavigator
              sits outside the Tab.Navigator). Home-only: gated on the active tab, not just on
              headerAction existing, since a screen registering this doesn't necessarily unmount
              when you switch tabs. */}
          {activeScreen === 'Home' && headerAction && (
            <TouchableOpacity
              onPress={headerAction.onPress}
              disabled={headerAction.disabled}
              style={[styles.headerAction, headerAction.disabled && styles.headerActionDisabled]}
            >
              {headerAction.mode === 'arrived' ? (
                <Image source={require('../assets/images/arrived.png')} style={styles.headerActionImage} />
              ) : (
                <Ionicons
                  name={headerAction.mode === 'cancel' ? 'close' : 'add'}
                  size={31}
                  color="#2f276a"
                  // Ionicons glyphs don't have a bold variant to switch to — this shadow trick
                  // thickens the stroke a bit as an approximation of real boldness.
                  style={styles.headerActionIcon}
                />
              )}
            </TouchableOpacity>
          )}
        </View>

        <Tab.Navigator
          screenListeners={{
            state: (e) => {
              const currentScreen = e.data.state.routes[e.data.state.index].name;
              setActiveScreen(currentScreen);
              setLocalActiveScreen(currentScreen);
            },
          }}
          screenOptions={({ route }) => ({
            tabBarIcon: ({ focused, color, size }) => {
              let iconName;
              let showRequestBadge = false;
              let showChatBadge = false;

              if (route.name === 'Home') {
                iconName = 'home-outline';
              } else if (route.name === 'Chat') {
                iconName = 'chatbubbles-outline';
                showChatBadge = totalUnreadMessagesCount > 0;
              } else if (route.name === 'Requests') {
                iconName = 'list-outline';
                if (hasNewRequests) {
                    showRequestBadge = true;
                }
              } else if (route.name === 'Search') {
                iconName = 'search-outline';
              } else if (route.name === 'Profile') {
                // Use the robust URI builder (was the raw avatar_url — broke for local /uploads paths).
                const avatarUri = getAvatarUri(currentUser?.avatar_url, currentUser?.username);
                return <Image source={{ uri: avatarUri }} style={styles.tabBarIcon} />;
              }

              return (
                <View>
                  <Ionicons name={iconName} size={size * 1.1} color={color} />
                  {(showRequestBadge || showChatBadge) && (
                    <View
                      style={{
                        position: 'absolute',
                        right: -6,
                        top: -3,
                        backgroundColor: 'red',
                        borderRadius: 6,
                        width: 12,
                        height: 12,
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    />
                  )}
                </View>
              );
            },
            tabBarActiveTintColor: '#0A84FF', // iOS system blue
            tabBarInactiveTintColor: 'black',
            tabBarLabelStyle: { fontSize: 11 }, // library default is 10 — 10% up
            headerShown: false,
            // Floating pill tab bar (Instagram-style): detached from all four edges via absolute
            // positioning + margins, fully rounded, with a shadow to read as elevated above the
            // screen content rather than docked to the bottom.
            // NOTE: the library's own default style (BottomTabBar.tsx) pins the bar with
            // start/end (RN's logical, writing-direction-aware equivalent of left/right), not
            // left/right themselves. Setting only left/right here doesn't override that default —
            // both land on the node and start/end wins, so the bar silently stayed edge-to-edge
            // no matter the left/right value. Must override with start/end to actually take effect.
            tabBarStyle: {
              position: 'absolute',
              start: TAB_BAR_SIDE_MARGIN,
              end: TAB_BAR_SIDE_MARGIN,
              bottom: 20,
              height: 58, // 64 minus 10%
              // The library's default (non-sidebar) style still applies paddingBottom: insets.bottom
              // (~34pt home-indicator safe area) meant for a bar docked flush to the screen edge.
              // Our pill already floats clear of that edge via `bottom: 20`, so that padding just
              // eats into the 64pt content area — with overflow:'hidden' below (needed to clip the
              // blur to the rounded corners), that shrunk area was clipping the icons' tops once
              // centered. Zero both paddings; the pill supplies its own spacing.
              paddingBottom: 0,
              paddingTop: 0,
              borderRadius: 29, // stays a full pill (half the new height)
              backgroundColor: 'transparent', // tabBarBackground below paints the actual surface
              borderTopWidth: 0,
              overflow: 'hidden', // clip the blur/tint to the pill's rounded corners
              elevation: 8,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 10,
            },
            // Letting the blur pick up color from fullContainer's own background (rather than
            // painting a color directly on the bar) turned out not to render the mauve through in
            // practice — confirmed with a fresh build (About-screen stamp matched the dirty tree)
            // that the gap area was still flat grey, not mauve. Reverted to painting the tint
            // directly on the bar: BlurView for the glass/frosted quality, plus an explicit mauve
            // overlay so the color reads reliably regardless of what's actually behind it.
            tabBarBackground: () => (
              <View style={StyleSheet.absoluteFill}>
                <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
                <View
                  style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(81, 45, 168, 0.25)' }]}
                />
              </View>
            ),
            // The library's default tab item is a flex:1 button with justifyContent:'flex-start'
            // baked into BottomTabItem's internal styles.tabVerticalUiKit — not exposed via
            // tabBarItemStyle (that prop only reaches an outer wrapper View that the flex:1 button
            // fills completely, leaving no room to visibly re-center). Re-implementing the button
            // via tabBarButton is the only override point that can actually reach that inner style.
            tabBarButton: (props) => {
              const flatStyle = StyleSheet.flatten(props.style);
              return (
                <PlatformPressable
                  {...props}
                  style={[flatStyle, { justifyContent: 'center' }]}
                />
              );
            },
          })}
        >
          <Tab.Screen name="Home">
            {(props) => <HomeScreen {...props} socket={socket} />}
          </Tab.Screen>
          <Tab.Screen name="Chat">
            {(props) => (
              <ChatTab 
                {...props} 
                socket={socket} 
              />
            )}
          </Tab.Screen>
          <Tab.Screen name="Requests">
            {(props) => <RequestsScreen {...props} />}
          </Tab.Screen>
          <Tab.Screen name="Search">
            {(props) => <SearchScreen {...props} />}
          </Tab.Screen>
          <Tab.Screen name="Profile">
            {(props) => <UserDetails onProfileUpdate={fetchUserData} />}
          </Tab.Screen>
        </Tab.Navigator>
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  fullContainer: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  header: {
    // Floating overlay (not in normal flow) — so content (the map, on Home) can extend up behind
    // it and actually show through the blur when panned, instead of the header just blurring
    // whatever flat background color happened to be directly behind it. Every other tab's root
    // container has matching paddingTop added so its content doesn't render hidden underneath.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    paddingHorizontal: 20,
    backgroundColor: 'transparent', // the BlurView + tint layer above paints the actual surface
    paddingTop: 60,
    height: 110,
    overflow: 'hidden',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 28,
  },
  appName: {
    // Back to the static SemiBold file — fontWeight on the variable AdventPro-Regular instance
    // wasn't reliably bolding it (came out too thin in practice). A static single-weight TTF
    // renders at its actual weight regardless of fontWeight support, so this is the safe bet.
    fontFamily: 'AdventPro-SemiBold',
    fontSize: 22,
    color: '#2f276a', // sampled directly from the logo's navy circle
    letterSpacing: 0.5,
    marginLeft: 12,
  },
  headerAction: {
    zIndex: 1,
    padding: 6,
  },
  headerActionDisabled: {
    opacity: 0.4,
  },
  headerActionImage: {
    width: 26,
    height: 26,
    resizeMode: 'contain',
  },
  headerActionIcon: {
    textShadowColor: '#2f276a',
    textShadowOffset: { width: 0.6, height: 0.6 },
    textShadowRadius: 0.6,
  },
  tabBarIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
});
