import type { NativeStackScreenProps } from '@react-navigation/native-stack';

// The Home tab is a stack so it can push the Submit-match screen.
export type HomeStackParamList = {
  Home: undefined;
  SubmitMatch: undefined;
};

export type HomeStackScreenProps<T extends keyof HomeStackParamList> =
  NativeStackScreenProps<HomeStackParamList, T>;
