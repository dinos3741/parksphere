import React, { createContext, useContext, useState } from 'react';

const OverlayContext = createContext();

export const OverlayProvider = ({ children }) => {
  const [activeOverlay, setActiveOverlay] = useState('HMM');

  return (
    <OverlayContext.Provider value={{ activeOverlay, setActiveOverlay }}>
      {children}
    </OverlayContext.Provider>
  );
};

export const useOverlay = () => useContext(OverlayContext);
