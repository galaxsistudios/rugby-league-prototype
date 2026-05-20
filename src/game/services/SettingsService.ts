import { DEFAULT_SETTINGS, GameSettings } from "../config/settings";

const STORAGE_KEY = "rl27.settings";

export class SettingsService {
  static load(): GameSettings {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return structuredClone(DEFAULT_SETTINGS);
    }

    try {
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      // Migration: profiles saved before placeKickSkill existed used vertical-only by default.
      // If this is a legacy profile, unlock lateral movement so new controls work out of the box.
      const isLegacyProfile = parsed.placeKickSkill === undefined;
      const migratedVerticalOnly = isLegacyProfile ? false : parsed.verticalOnly;

      return {
        ...structuredClone(DEFAULT_SETTINGS),
        ...parsed,
        verticalOnly:
          typeof migratedVerticalOnly === "boolean"
            ? migratedVerticalOnly
            : DEFAULT_SETTINGS.verticalOnly,
        scoring: {
          ...DEFAULT_SETTINGS.scoring,
          ...(parsed.scoring ?? {}),
        },
        audio: {
          ...DEFAULT_SETTINGS.audio,
          ...(parsed.audio ?? {}),
        },
        teams: {
          ...DEFAULT_SETTINGS.teams,
          ...(parsed.teams ?? {}),
        },
        playTheBall: {
          ...DEFAULT_SETTINGS.playTheBall,
          ...(parsed.playTheBall ?? {}),
        },
      };
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  static save(settings: GameSettings): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
}
