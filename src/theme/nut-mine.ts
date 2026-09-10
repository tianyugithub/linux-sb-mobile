import nutBase from '@nutui/nutui-react-native/lib/module/configprovider/styles/themes/default';
import { palettes, type ColorScheme, type Palette } from './palette';

function nutTheme(p: Palette) {
  return {
    ...nutBase,
    mode: p.scheme,
    $white: p.surfaceRaised,
    $gray2: p.text,
    $gray6: p.surfaceRaised,
    '$title-color': p.text,
    '$title-color2': p.text,
    '$text-color': p.muted,
    '$cell-color': p.text,
    '$cell-desc-color': p.muted,
    '$cell-after-border-bottom-color': p.line,
    '$cell-group-background-color': p.surfaceRaised,
    '$cell-group-title-color': p.muted,
    '$cell-border-radius': 12,
    '$grid-bg-color': 'transparent',
    '$grid-item-content-bg-color': 'transparent',
    '$grid-item-content-paddingV': 12,
    '$grid-item-text-color': p.text,
    '$grid-item-text-size': 11,
    '$grid-item-text-margin': 6,
  };
}

export function nutThemeFor(scheme: ColorScheme) {
  return nutTheme(palettes[scheme]);
}

export const nutMineTheme = nutTheme(palettes.dark);
