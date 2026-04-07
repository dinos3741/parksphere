import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, ImageBackground, TouchableOpacity, TouchableWithoutFeedback, Keyboard, Alert, Image, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Picker } from '@react-native-picker/picker';
import logo from '../assets/images/logo.png'; // Import the logo image

WebBrowser.maybeCompleteAuthSession();

const Login = ({ onLogin, onRegister }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [carColor, setCarColor] = useState('');
  const [carType, setCarType] = useState('');
  const [carTypes, setCarTypes] = useState([]);
  const [showCarDetailsFields, setShowCarDetailsFields] = useState(false);
  const [tempIdToken, setTempIdToken] = useState(null);

  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: '320058445002-lddk8d48h06bei48bh6u08ku97t1i3kd.apps.googleusercontent.com',
    iosClientId: '320058445002-lddk8d48h06bei48bh6u08ku97t1i3kd.apps.googleusercontent.com',
    androidClientId: '320058445002-lddk8d48h06bei48bh6u08ku97t1i3kd.apps.googleusercontent.com',
  });

  useEffect(() => {
    const fetchCarTypes = async () => {
      try {
        const response = await fetch(`http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001/api/car-types`);
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
  }, []);

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      handleGoogleSuccess(id_token);
    }
  }, [response]);

  const handleGoogleSuccess = async (idToken) => {
    try {
      const res = await fetch(`http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001/api/auth/google`, {
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
        await AsyncStorage.setItem('userToken', data.token);
        await AsyncStorage.setItem('userId', String(data.userId));
        await AsyncStorage.setItem('username', data.username);
        onLogin(data);
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

  const handleCarDetailsSubmit = () => {
    if (tempIdToken) {
      handleGoogleSuccess(tempIdToken);
    }
  };

  const handleLogin = async () => {
    try {
      const response = await fetch(`http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const data = await response.json();
        await AsyncStorage.setItem('userToken', data.token);
        await AsyncStorage.setItem('userId', String(data.userId));
        await AsyncStorage.setItem('username', data.username);
        onLogin(data);
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
      style={styles.backgroundImage}
      imageStyle={styles.imageStyle}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.loginOverlay}>
          <View style={styles.logoContainer}>
            <Image source={logo} style={styles.logoImage} />
            <Text style={styles.parksphereTitle}>PARKSPHERE</Text>
            <Text style={styles.tagline}>the app you need to <Text style={styles.highlight}>park in the city!</Text></Text>
          </View>
          <View style={styles.loginContainer}>
            <Text style={styles.loginTitle}>{showCarDetailsFields ? 'Enter Car Details' : 'Login'}</Text>
            {showCarDetailsFields ? (
              <View style={{ width: '100%' }}>
                <TextInput
                  style={styles.input}
                  placeholder="Plate Number"
                  placeholderTextColor="#888"
                  value={plateNumber}
                  onChangeText={setPlateNumber}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Car Color"
                  placeholderTextColor="#888"
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
                  style={[styles.loginButton, { backgroundColor: '#6c757d', marginTop: 10 }]} 
                  onPress={() => setShowCarDetailsFields(false)}
                >
                  <Text style={styles.loginButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Username"
                  placeholderTextColor="#888"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#888"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
                <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
                  <Text style={styles.loginButtonText}>Login</Text>
                </TouchableOpacity>
                
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
                  <Image 
                    source={{ uri: 'https://img.icons8.com/color/48/000000/google-logo.png' }} 
                    style={styles.googleIcon} 
                  />
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
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  imageStyle: {
    opacity: 0.6,
  },
  loginOverlay: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 70,
  },
  logoImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 10,
  },
  parksphereTitle: {
    fontFamily: 'AdventPro-SemiBold',
    fontSize: 32,
    color: 'white',
    letterSpacing: 2,
  },
  tagline: {
    fontSize: 16,
    color: 'white',
    marginTop: 5,
  },
  highlight: {
    color: '#4dd0e1',
    fontWeight: 'bold',
  },
  loginContainer: {
    width: '80%',
    maxWidth: 300,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 20,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
    alignItems: 'center',
  },
  loginTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    height: 45,
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    marginBottom: 10,
    backgroundColor: '#fefefe',
    fontSize: 16,
    color: '#333',
  },
  loginButton: {
    width: '100%',
    backgroundColor: '#007bff',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#007bff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  registerPrompt: {
    marginTop: 15,
    width: '100%',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  registerText: {
    fontSize: 14,
    color: '#555',
  },
  registerLink: {
    fontSize: 14,
    color: '#007bff',
    fontWeight: 'bold',
    textDecorationLine: 'underline',
  },
  separatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 15,
    width: '100%',
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  separatorText: {
    marginHorizontal: 10,
    color: '#888',
    fontSize: 14,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    backgroundColor: 'white',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  googleIcon: {
    width: 20,
    height: 20,
    marginRight: 10,
  },
  googleButtonText: {
    color: '#555',
    fontSize: 16,
    fontWeight: '600',
  },
  pickerContainer: {
    width: '100%',
    height: 45,
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 10,
    backgroundColor: '#fefefe',
    justifyContent: 'center',
  },
  picker: {
    width: '100%',
    height: 45,
  },
});

export default Login;
