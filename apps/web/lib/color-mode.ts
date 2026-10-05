import { colorModes, type ColorMode } from '@postwerk/core/theme';

/** Light, dark or system — remembered per browser, so each device can differ. */
export const MODE_COOKIE = 'postwerk_mode';

export function parseColorMode(value: string | undefined): ColorMode {
  return colorModes.includes(value as ColorMode) ? (value as ColorMode) : 'system';
}
