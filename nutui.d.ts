declare module '@nutui/nutui-react-native' {
  import { ComponentType, ReactNode } from 'react';
  import { StyleProp, ViewStyle } from 'react-native';

  export const ConfigProvider: ComponentType<{ theme?: Record<string, unknown>; children?: ReactNode }>;
  export const Avatar: ComponentType<{ size?: string; shape?: string; bgColor?: string; color?: string; source?: unknown; children?: ReactNode; style?: StyleProp<ViewStyle> }>;
  export const Button: ComponentType<{
    type?: string;
    size?: string;
    shape?: string;
    block?: boolean;
    color?: string;
    onPress?: () => void;
    children?: ReactNode;
  }>;
  export const Tag: ComponentType<{ type?: string; round?: boolean; plain?: boolean; children?: ReactNode }>;
  export const Grid: ComponentType<{
    columnNum?: number | string;
    border?: boolean;
    gutter?: number | string;
    center?: boolean;
    square?: boolean;
    iconSize?: number | string;
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
  }>;
  export const GridItem: ComponentType<{
    text?: ReactNode;
    icon?: ReactNode;
    onPress?: () => void;
    children?: ReactNode;
  }>;
  export const Cell: ComponentType<{
    title?: ReactNode;
    subTitle?: ReactNode;
    desc?: string;
    isLink?: boolean;
    center?: boolean;
    iconSlot?: ReactNode;
    onClick?: () => void;
    children?: ReactNode;
  }>;
  export const CellGroup: ComponentType<{ title?: ReactNode; children?: ReactNode }>;
}

declare module '@nutui/nutui-react-native/lib/module/configprovider/styles/themes/default' {
  const theme: Record<string, unknown>;
  export default theme;
}
