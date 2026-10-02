import { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Lets a page (the Dashboard) contribute extra entries to the global settings
// menu, which is rendered once at the App level, outside the Dashboard tree.
const SettingsActionsContext = createContext({ actions: [], setActions: () => {} });

export function SettingsActionsProvider({ children }) {
  const [actions, setActions] = useState([]);
  const value = useMemo(() => ({ actions, setActions }), [actions]);
  return <SettingsActionsContext.Provider value={value}>{children}</SettingsActionsContext.Provider>;
}

export const useSettingsActions = () => useContext(SettingsActionsContext).actions;

// Registers actions while the calling component is mounted.
// Each action: { id, icon, label, onClick }
export function useRegisterSettingsActions(actions, deps) {
  const { setActions } = useContext(SettingsActionsContext);
  useEffect(() => {
    setActions(actions);
    return () => setActions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
