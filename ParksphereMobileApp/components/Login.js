import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, TouchableWithoutFeedback, Keyboard, Alert, Image, ImageBackground, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Picker } from '@react-native-picker/picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../utils/apiService';
import logo from '../assets/images/logo.png'; // Import the logo image

WebBrowser.maybeCompleteAuthSession();

const Login = ({ onRegister }) => {
  const { login, serverUrl } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [carColor, setCarColor] = useState('');
  const [carType, setCarType] = useState('');
  const [carTypes, setCarTypes] = useState([]);
  const [showCarDetailsFields, setShowCarDetailsFields] = useState(false);
  const [tempIdToken, setTempIdToken] = useState(null);
  // Offline mock-mode entry point: only shown on a device that has previously logged in as an
  // admin (cached locally by AuthContext's fetchUserData, survives logout). No network is involved
  // in checking this or in the button itself — the whole point is reaching mock mode when there's
  // no connectivity at all, which the in-profile Mock Mode toggle can't do since reaching the
  // profile screen requires a live online login first.
  const [showOfflineModeButton, setShowOfflineModeButton] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('wasAdmin').then((value) => setShowOfflineModeButton(value === 'true'));
  }, []);

  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: '320058445002-lddk8d48h06bei48bh6u08ku97t1i3kd.apps.googleusercontent.com',
    iosClientId: '320058445002-oo08jes63ti9rtqkhpo9d1jfi6fcoo31.apps.googleusercontent.com',
    androidClientId: '320058445002-oo08jes63ti9rtqkhpo9d1jfi6fcoo31.apps.googleusercontent.com',
  });

  useEffect(() => {
    const fetchCarTypes = async () => {
      try {
        const response = await apiRequest(`${serverUrl}/api/car-types`);
        if (response.ok) {
          const data = await response.json();
          setCarTypes(data);
          if (data.length > 0) setCarType(data[0]);
        }
      } catch (error) {
        console.error('Error fetching car types:', error);
      }
    };
    fetchCarTypes();
  }, [serverUrl]);

  useEffect(() => {
    if (response) {
      console.log('Google Auth Response Type:', response.type);
      if (response.type === 'success') {
        const { id_token } = response.params;
        handleGoogleSuccess(id_token);
      } else if (response.type === 'error') {
        console.error('Google Auth Error:', response.error);
        Alert.alert('Google Login Error', response.error?.message || 'Unknown error');
      } else if (response.type === 'cancel') {
        console.log('Google Auth Cancelled by user');
      }
    }
  }, [response]);

  const handleGoogleSuccess = async (idToken) => {
    try {
      // Disable mock mode BEFORE any request — apiRequest()/fetch below must hit the real server,
      // not get intercepted by a mockModeEnabled flag left over from a prior Demo Login (2026-07-26:
      // this ordering bug silently logged a "real" login in as the demo user/mock token instead).
      await AsyncStorage.setItem('mockModeEnabled', 'false');
      const res = await fetch(`${serverUrl}/api/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idToken,
          plateNumber: plateNumber || null,
          carColor: carColor || null,
          carType: carType || null
        }),
      });

      if (res.ok) {
        const data = await res.json();
        login(data);
      } else if (res.status === 428) { // Precondition Required - missing car details
        setTempIdToken(idToken);
        setShowCarDetailsFields(true);
        Alert.alert('Details Needed', 'Please provide your car details to complete Google login.');
      } else {
        const errorData = await res.text();
        Alert.alert('Google Login Failed', errorData);
      }
    } catch (error) {
      console.error('Error during Google login:', error);
      Alert.alert('Error', 'An error occurred during Google login.');
    }
  };

  const handleOfflineMode = async () => {
    await AsyncStorage.setItem('mockModeEnabled', 'true');
    login({
      token: 'mock-jwt-token-demo',
      userId: -1,
      username: 'demo user',
      carType: 'sedan',
    });
  };

  const handleCarDetailsSubmit = () => {
    if (tempIdToken) {
      handleGoogleSuccess(tempIdToken);
    }
  };

  const handleLogin = async () => {
    try {
      // Disable mock mode BEFORE the request — apiRequest() checks this flag on EVERY call
      // regardless of endpoint, so leaving it set from a prior Demo Login would silently intercept
      // this real login and hand back the mock user/token instead of hitting the real server
      // (2026-07-26: exactly this happened — a real-credentials login logged in as "demo user").
      await AsyncStorage.setItem('mockModeEnabled', 'false');
      const response = await apiRequest(`${serverUrl}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const data = await response.json();
        login(data);
      } else {
        const errorText = await response.text();
        console.error('Login failed:', errorText);
        Alert.alert('Login Failed', 'Invalid username or password.');
      }
    } catch (error) {
      console.error('Error during login:', error);
      Alert.alert('Error', 'Could not connect to the server for login.');
    }
  };

  return (
    <ImageBackground
      source={require('../assets/images/parking_background.png')}
      style={styles.container}
      blurRadius={15}
    >
      <View style={styles.backgroundWash} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View>
            <View style={styles.logoContainer}>
              <Image source={logo} style={styles.logoImage} />
              <Text style={styles.venioTitle}>VENIO</Text>
              <Text style={styles.tagline}>The intelligent way to <Text style={styles.highlight}>arrive and park</Text></Text>
            </View>

            <View style={styles.formContainer}>
              <Text style={styles.loginTitle}>{showCarDetailsFields ? 'Enter Car Details' : 'Login'}</Text>
              {showCarDetailsFields ? (
                <View style={{ width: '100%' }}>
                  <TextInput
                    style={styles.input}
                    placeholder="Plate Number"
                    placeholderTextColor="#999"
                    value={plateNumber}
                    onChangeText={setPlateNumber}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Car Color"
                    placeholderTextColor="#999"
                    value={carColor}
                    onChangeText={setCarColor}
                  />
                  <View style={styles.pickerContainer}>
                    <Picker
                      selectedValue={carType}
                      onValueChange={(itemValue) => setCarType(itemValue)}
                      style={styles.picker}
                    >
                      {carTypes.map((type) => (
                        <Picker.Item key={type} label={type.charAt(0).toUpperCase() + type.slice(1)} value={type} />
                      ))}
                    </Picker>
                  </View>
                  <TouchableOpacity style={styles.loginButton} onPress={handleCarDetailsSubmit}>
                    <Text style={styles.loginButtonText}>Complete Google Login</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => setShowCarDetailsFields(false)}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="Username"
                    placeholderTextColor="#999"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#999"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                  />
                  <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
                    <Text style={styles.loginButtonText}>Login</Text>
                  </TouchableOpacity>

                  {showOfflineModeButton && (
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={handleOfflineMode}
                    >
                      <Text style={styles.secondaryButtonText}>Offline Mode</Text>
                    </TouchableOpacity>
                  )}

                  <View style={styles.separatorContainer}>
                    <View style={styles.separatorLine} />
                    <Text style={styles.separatorText}>OR</Text>
                    <View style={styles.separatorLine} />
                  </View>

                  <TouchableOpacity
                    style={styles.googleButton}
                    onPress={() => promptAsync()}
                    disabled={!request}
                  >
                    <Ionicons name="logo-google" size={18} color="#555" style={styles.googleIcon} />
                    <Text style={styles.googleButtonText}>Sign in with Google</Text>
                  </TouchableOpacity>

                  <View style={styles.registerPrompt}>
                    <Text style={styles.registerText}>Don't have an account?</Text>
                    <TouchableOpacity onPress={onRegister}>
                      <Text style={styles.registerLink}>Register here</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Sits between the blurred photo and the content — a light wash rather than a near-opaque one,
  // so the blur still reads as a soft backdrop instead of disappearing under solid white.
  backgroundWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logoImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 10,
  },
  venioTitle: {
    fontFamily: 'AdventPro-SemiBold',
    fontSize: 28,
    color: '#2f276a',
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  highlight: {
    color: '#512da8',
    fontWeight: '700',
  },
  formContainer: {
    width: '100%',
    alignItems: 'center',
  },
  loginTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#222',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 18,
    marginBottom: 12,
    backgroundColor: '#f0f0f4',
    fontSize: 15.5,
    color: '#222',
  },
  loginButton: {
    width: '100%',
    height: 49,
    backgroundColor: '#512da8',
    borderRadius: 24.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    width: '100%',
    height: 49,
    borderRadius: 24.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#512da8',
  },
  secondaryButtonText: {
    color: '#512da8',
    fontSize: 15,
    fontWeight: '600',
  },
  registerPrompt: {
    marginTop: 20,
    width: '100%',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  registerText: {
    fontSize: 14,
    color: '#666',
  },
  registerLink: {
    fontSize: 14,
    color: '#512da8',
    fontWeight: '600',
    marginLeft: 4,
  },
  separatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
    width: '100%',
  },
  separatorLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e2e2e6',
  },
  separatorText: {
    marginHorizontal: 10,
    color: '#999',
    fontSize: 13,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 49,
    backgroundColor: '#fff',
    borderRadius: 24.5,
    borderWidth: 1,
    borderColor: '#e2e2e6',
  },
  googleIcon: {
    marginRight: 10,
  },
  googleButtonText: {
    color: '#333',
    fontSize: 15,
    fontWeight: '600',
  },
  pickerContainer: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    marginBottom: 12,
    backgroundColor: '#f0f0f4',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  picker: {
    width: '100%',
    height: 48,
  },
});

export default Login;
