import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { APP_VERSION, BUILD_LABEL } from '../utils/buildInfo';

const HOW_IT_WORKS = [
  'Venio detects automatically when you park or start driving away — no manual check-ins.',
  "About to leave? Your spot appears on the map for nearby drivers looking to park.",
  "A driver requests it. You accept, and it's held for them while you drive off.",
  'They arrive, you both confirm the handoff — they get the spot, you earn credits.',
];

const AboutScreen = ({ onClose }) => {
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const [copied, setCopied] = useState(false);

  const copyBuild = async () => {
    await Clipboard.setStringAsync(BUILD_LABEL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500); // brief "Copied!" confirmation
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color="#512da8" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>About Venio</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Image source={require('../assets/images/logo.png')} style={styles.logo} />
        <Text style={styles.appName}>Venio</Text>

        <Text style={styles.description}>
          Venio automatically detects when you park and when you're about to leave, so nearby
          drivers can see your spot the moment it opens up — no need to constantly check the app.
          Looking for a spot yourself? Venio shows you real, soon-to-be-free spots around your
          current location.
        </Text>

        <Text style={styles.sectionHeader}>HOW IT WORKS</Text>
        <View style={styles.stepList}>
          {HOW_IT_WORKS.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerText}>© 2025 Konstantinos Dimou</Text>
        {isAdmin ? (
          <TouchableOpacity onPress={copyBuild} activeOpacity={0.6}>
            <Text style={styles.buildText}>{copied ? '✓ Copied!' : BUILD_LABEL}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.buildText}>v{APP_VERSION}</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 60,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e2e6',
  },
  backButton: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#222',
  },
  scrollContent: {
    padding: 20,
    alignItems: 'center',
    paddingBottom: 60,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginTop: 12,
  },
  appName: {
    fontFamily: 'AdventPro-SemiBold',
    fontSize: 22,
    color: '#2f276a',
    marginTop: 10,
    letterSpacing: 0.5,
  },
  description: {
    fontSize: 15,
    color: '#444',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 18,
  },
  sectionHeader: {
    alignSelf: 'flex-start',
    fontSize: 13,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 32,
    marginBottom: 14,
  },
  stepList: {
    width: '100%',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#512da8',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    fontSize: 15,
    color: '#333',
    lineHeight: 21,
    paddingTop: 2,
  },
  footer: {
    paddingVertical: 10,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e2e6',
  },
  footerText: {
    textAlign: 'center',
    fontSize: 12,
    color: '#999',
  },
  buildText: {
    textAlign: 'center',
    fontSize: 11,
    color: '#bbb',
    marginTop: 2,
  },
});

export default AboutScreen;
