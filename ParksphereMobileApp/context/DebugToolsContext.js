import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DebugToolsContext = createContext();

// Admin-only visibility toggles for the three always-on-Home debug overlays (HMM Engine, Flight
// Recorder, the GPS "fixes" StreamMonitor box) — device-local, not server-synced, same as
// SpotContext's spotRadiusKm. Default to visible (true) so existing admin behavior is unchanged
// until someone actually turns one off.
const STORAGE_KEYS = {
  showHmmEngine: 'debugTools:showHmmEngine',
  showFlightRecorder: 'debugTools:showFlightRecorder',
  showFixesWindow: 'debugTools:showFixesWindow',
};

export const DebugToolsProvider = ({ children }) => {
  const [showHmmEngine, setShowHmmEngineState] = useState(true);
  const [showFlightRecorder, setShowFlightRecorderState] = useState(true);
  const [showFixesWindow, setShowFixesWindowState] = useState(true);

  useEffect(() => {
    const loadPersistedState = async () => {
      try {
        const entries = await AsyncStorage.multiGet(Object.values(STORAGE_KEYS));
        const saved = Object.fromEntries(entries);
        if (saved[STORAGE_KEYS.showHmmEngine] != null) setShowHmmEngineState(saved[STORAGE_KEYS.showHmmEngine] === 'true');
        if (saved[STORAGE_KEYS.showFlightRecorder] != null) setShowFlightRecorderState(saved[STORAGE_KEYS.showFlightRecorder] === 'true');
        if (saved[STORAGE_KEYS.showFixesWindow] != null) setShowFixesWindowState(saved[STORAGE_KEYS.showFixesWindow] === 'true');
      } catch (e) {
        console.error('[DebugToolsContext] Failed to load persisted state:', e);
      }
    };
    loadPersistedState();
  }, []);

  const setShowHmmEngine = useCallback(async (value) => {
    setShowHmmEngineState(value);
    await AsyncStorage.setItem(STORAGE_KEYS.showHmmEngine, String(value));
  }, []);

  const setShowFlightRecorder = useCallback(async (value) => {
    setShowFlightRecorderState(value);
    await AsyncStorage.setItem(STORAGE_KEYS.showFlightRecorder, String(value));
  }, []);

  const setShowFixesWindow = useCallback(async (value) => {
    setShowFixesWindowState(value);
    await AsyncStorage.setItem(STORAGE_KEYS.showFixesWindow, String(value));
  }, []);

  const value = {
    showHmmEngine,
    setShowHmmEngine,
    showFlightRecorder,
    setShowFlightRecorder,
    showFixesWindow,
    setShowFixesWindow,
  };

  return (
    <DebugToolsContext.Provider value={value}>
      {children}
    </DebugToolsContext.Provider>
  );
};

export const useDebugTools = () => useContext(DebugToolsContext);
