import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

// The bottom tabs — the root navigator once signed in.
export type TabParamList = {
  Home: NavigatorScreenParams<HomeStackParamList>;
  Leaderboard: NavigatorScreenParams<LeaderboardStackParamList>;
  Tournaments: NavigatorScreenParams<TournamentsStackParamList>;
  Doubles: NavigatorScreenParams<DoublesStackParamList>;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
};

// A player's profile, which every tab's stack has: tapping a player anywhere
// opens it on top of the current screen (components/PlayerLink.tsx).
export type PlayerProfileParams = { playerId: string; displayName?: string };

// The Home tab is a stack so it can push the Submit-match screen.
export type HomeStackParamList = {
  Home: undefined;
  SubmitMatch: undefined;
  PlayerProfile: PlayerProfileParams;
  HowRatingsWork: undefined;
};

export type HomeStackScreenProps<T extends keyof HomeStackParamList> =
  NativeStackScreenProps<HomeStackParamList, T>;

// The Leaderboard tab is a stack so a row can open a player's profile.
export type LeaderboardStackParamList = {
  Leaderboard: undefined;
  PlayerProfile: PlayerProfileParams;
  HowRatingsWork: undefined;
};

export type LeaderboardStackScreenProps<T extends keyof LeaderboardStackParamList> =
  NativeStackScreenProps<LeaderboardStackParamList, T>;

// The Profile tab is a stack: your profile -> Settings, How ratings work, or
// another player's profile.
export type ProfileStackParamList = {
  Account: undefined;
  Settings: undefined;
  PlayerProfile: PlayerProfileParams;
  HowRatingsWork: undefined;
};

export type ProfileStackScreenProps<T extends keyof ProfileStackParamList> =
  NativeStackScreenProps<ProfileStackParamList, T>;

// The Tournaments tab is a stack: list -> create / detail -> record a bracket match.
export type TournamentsStackParamList = {
  TournamentsList: undefined;
  CreateTournament: undefined;
  TournamentDetail: { tournamentId: string; name?: string };
  RecordTournamentMatch: {
    tournamentMatchId: string;
    tournamentId: string;
    playerAName: string;
    playerBName: string;
    bestOf: number;
  };
  PlayerProfile: PlayerProfileParams;
  HowRatingsWork: undefined;
};

export type TournamentsStackScreenProps<T extends keyof TournamentsStackParamList> =
  NativeStackScreenProps<TournamentsStackParamList, T>;

// The Doubles tab is a stack: the hub -> record a doubles match / how it works.
export type DoublesStackParamList = {
  DoublesHome: undefined;
  RecordDoublesMatch: undefined;
  PlayerProfile: PlayerProfileParams;
  HowRatingsWork: undefined;
};

export type DoublesStackScreenProps<T extends keyof DoublesStackParamList> =
  NativeStackScreenProps<DoublesStackParamList, T>;
