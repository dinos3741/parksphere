import React, { createContext, useContext, useState } from 'react';

// Lets a screen (e.g. HomeScreen's "add a spot" action) publish a button for the persistent header
// in RootNavigator to render — the header lives outside the Tab.Navigator, so a child screen can't
// just render into it directly. null means "no action to show here" (e.g. any non-Home tab).
const HeaderActionContext = createContext();

export const HeaderActionProvider = ({ children }) => {
  const [headerAction, setHeaderAction] = useState(null); // { onPress, disabled, mode } | null

  return (
    <HeaderActionContext.Provider value={{ headerAction, setHeaderAction }}>
      {children}
    </HeaderActionContext.Provider>
  );
};

export const useHeaderAction = () => useContext(HeaderActionContext);
