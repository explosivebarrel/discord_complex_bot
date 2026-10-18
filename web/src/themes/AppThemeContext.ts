import { createContext, useContext } from "react";
import { getScheme, type AppThemeScheme, type ThemeId } from "./palettes";

interface AppThemeState {
  scheme: AppThemeScheme;
  setThemeId: (id: ThemeId) => void;
}

export const AppThemeContext = createContext<AppThemeState>({
  scheme: getScheme("dark"),
  setThemeId: () => {},
});

export function useAppTheme(): AppThemeState {
  return useContext(AppThemeContext);
}
