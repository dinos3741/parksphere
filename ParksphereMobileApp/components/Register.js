import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, ImageBackground, TouchableOpacity, TouchableWithoutFeedback, Keyboard, Alert, Image, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../utils/apiService';
import logo from '../assets/images/logo.png'; // Import the logo image

WebBrowser.maybeCompleteAuthSession();

const carTypes = ['motorcycle', 'city car', 'hatchback', 'sedan', 'family car', 'SUV', 'van', 'truck'];

const Register = ({ onBack }) => {
  const { login, serverUrl } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [carType, setCarType] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [carColor, setCarColor] = useState('');

  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: '320058445002-lddk8d48h06bei48bh6u08ku97t1i3kd.apps.googleusercontent.com',
    iosClientId: '320058445002-oo08jes63ti9rtqkhpo9d1jfi6fcoo31.apps.googleusercontent.com',
    androidClientId: '320058445002-oo08jes63ti9rtqkhpo9d1jfi6fcoo31.apps.googleusercontent.com',
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      handleGoogleSuccess(id_token);
    }
  }, [response]);

  const handleGoogleSuccess = async (idToken) => {
    if (!plateNumber || !carColor || !carType) {
      Alert.alert('Details Needed', 'Please fill in your plate number, car color, and car type before registering with Google.');
      return;
    }

    try {
      const res = await fetch(`${serverUrl}/api/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idToken,
          plateNumber,
          carColor,
          carType
        }),
      });

      if (res.ok) {
        const data = await res.json();
        login(data);
      } else {
        const errorData = await res.text();
        Alert.alert('Google Registration Failed', errorData);
      }
    } catch (error) {
      console.error('Error during Google registration:', error);
      Alert.alert('Error', 'An error occurred during Google registration.');
    }
  };

  const handleRegister = async () => {
    if (!username || !password || !plateNumber || !carColor || !carType) {
      Alert.alert('Error', 'All fields are required.');
      return;
    }
    try {
      const response = await apiRequest(`${serverUrl}/api/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, plateNumber, carColor, carType }),
      });

      if (response.ok) {
        Alert.alert('Success', 'Registration successful! Please log in.');
        onBack();
      } else {
        const errorData = await response.text();
        Alert.alert('Registration Failed', errorData);
      }
    } catch (error) {
      console.error('Error during registration:', error);
      Alert.alert('Error', 'Could not connect to the server for registration.');
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
              <Text style={styles.loginTitle}>Register</Text>
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.carTypeScrollView}>
                {carTypes.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.carTypeOption,
                      carType === type && styles.selectedCarType,
                    ]}
                    onPress={() => setCarType(type)}
                  >
                    <Text style={[styles.carTypeLabel, carType === type && styles.selectedCarTypeLabel]}>{type}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TextInput
                style={styles.input}
                placeholder="Plate Number"
                placeholderTextColor="#999"
                value={plateNumber}
                onChangeText={setPlateNumber}
                autoCapitalize="characters"
              />
              <TextInput
                style={styles.input}
                placeholder="Car Color"
                placeholderTextColor="#999"
                value={carColor}
                onChangeText={setCarColor}
                autoCapitalize="words"
              />
              <TouchableOpacity style={styles.loginButton} onPress={handleRegister}>
                <Text style={styles.loginButtonText}>Register</Text>
              </TouchableOpacity>

              <View style={styles.separatorContainer}>
                <View style={styles.separatorLine} />
                <Text style={styles.separatorText}>OR</Text>
                <View style={styles.separatorLine} />
              </View>

              <TouchableOpacity
                style={[
                  styles.googleButton,
                  (!plateNumber || !carColor || !carType) && { opacity: 0.5 }
                ]}
                onPress={() => promptAsync()}
                disabled={!request || !plateNumber || !carColor || !carType}
              >
                <Ionicons name="logo-google" size={18} color="#555" style={styles.googleIcon} />
                <Text style={styles.googleButtonText}>Sign up with Google</Text>
              </TouchableOpacity>

              <View style={styles.registerPrompt}>
                <Text style={styles.registerText}>Already have an account?</Text>
                <TouchableOpacity onPress={onBack}>
                  <Text style={styles.registerLink}>Login here</Text>
                </TouchableOpacity>
              </View>
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
  carTypeScrollView: {
    height: 50,
    marginBottom: 12,
  },
  carTypeOption: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e2e2e6',
    borderRadius: 20,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedCarType: {
    backgroundColor: '#512da8',
    borderColor: '#512da8',
  },
  carTypeLabel: {
    color: '#333',
    fontWeight: '600',
  },
  selectedCarTypeLabel: {
    color: '#fff',
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
});

export default Register;
